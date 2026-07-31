import { NextResponse } from "next/server";
import { createRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import {
  PIPELINE_TYPES,
  BLEND_MODES,
  FIT_MODES,
  SURFACE_TAGS,
  DEFAULT_BLEND,
  DEFAULT_FIT,
  parseQuad,
  type PipelineType,
} from "@/config/mockups";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // up to four file uploads, throttled

/**
 * Mockup template intake — ONE save, validated whole (spec §4).
 *
 * The corner-placement step runs client-side on the local preview before
 * anything is uploaded, so a Simple Placement template can't exist without
 * its quad: the save is blocked, not the record flagged.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v.trim() : "";
    };
    const fileOf = (k: string): File | null => {
      const v = form.get(k);
      return v && typeof v !== "string" && v.size > 0 ? v : null;
    };

    const name = str("name");
    if (!name) return NextResponse.json({ error: "A template name is required." }, { status: 400 });

    const pipelineType = str("pipelineType") as PipelineType;
    if (!PIPELINE_TYPES.includes(pipelineType)) {
      return NextResponse.json({ error: "Pick a pipeline type first — it decides everything after." }, { status: 400 });
    }

    const surface = str("surface");
    if (!SURFACE_TAGS.includes(surface as (typeof SURFACE_TAGS)[number])) {
      return NextResponse.json({ error: "Tag the surface — it filters templates by garment compatibility later." }, { status: 400 });
    }

    const baseImage = fileOf("baseImage");
    const displacementMap = fileOf("displacementMap");
    const shadowLayer = fileOf("shadowLayer");
    const highlightLayer = fileOf("highlightLayer");

    // §4 — hard requirements. Shadow/highlight are never blocked on.
    if (!baseImage) {
      return NextResponse.json({ error: "A base image is required for every template." }, { status: 400 });
    }
    if (pipelineType === "Full Displacement" && !displacementMap) {
      return NextResponse.json({ error: "Full Displacement needs a displacement map." }, { status: 400 });
    }

    const quad = parseQuad(str("quad"));
    if (pipelineType === "Simple Placement" && !quad) {
      return NextResponse.json(
        { error: "Place the four print-area corners before saving." },
        { status: 400 }
      );
    }

    const blend = str("blendMode");
    const fit = str("fitMode");
    const values: Record<string, SimpleValue> = {
      Name: name,
      "Pipeline Type": pipelineType,
      Surface: surface,
      "Blend Mode": BLEND_MODES.includes(blend as (typeof BLEND_MODES)[number]) ? blend : DEFAULT_BLEND,
      Fit: FIT_MODES.includes(fit as (typeof FIT_MODES)[number]) ? fit : DEFAULT_FIT,
    };
    if (str("sourceLink")) values["File Link"] = str("sourceLink");
    if (str("shotType")) values["Shot Type"] = str("shotType");
    if (quad) values["Print Area Quad (JSON)"] = JSON.stringify(quad);

    // uploads last — no orphaned Notion files if validation bounced above
    const uploads: Array<[string, File]> = [["Base Image", baseImage]];
    // a displacement map on a Simple Placement template is stored if sent —
    // switching the pipeline later shouldn't cost a re-upload
    if (displacementMap) uploads.push(["Displacement Map", displacementMap]);
    if (shadowLayer) uploads.push(["Shadow Layer", shadowLayer]);
    if (highlightLayer) uploads.push(["Highlight Layer", highlightLayer]);
    for (const [prop, file] of uploads) {
      const up = await uploadFileToNotion(file);
      values[prop] = [{ name: file.name, uploadId: up.id }];
    }

    const record = await createRecord("mockup_templates", values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
