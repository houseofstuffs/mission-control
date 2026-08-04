import { NextResponse } from "next/server";
import sharp from "sharp";
import { createRecord, cachedRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import {
  PIPELINE_TYPES,
  BLEND_MODES,
  FIT_MODES,
  SURFACE_TAGS,
  DEFAULT_BLEND,
  DEFAULT_FIT,
  MOCKUP_CROP_SIZE,
  UPLOAD_BUDGET_BYTES,
  parseQuad,
  type PipelineType,
} from "@/config/mockups";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // up to four file uploads, throttled

/**
 * Layers are photos, and PNG is the wrong codec for photos: a 2000px base
 * shot lands ~8MB as PNG and Notion's free plan caps uploads at 5MB. WebP
 * keeps alpha where a layer has it and photo-compression where it doesn't —
 * 2000px comes out a few hundred KB, safely under the cap. Render quality
 * is untouched at these settings; the master artwork never passes through
 * here anyway.
 *
 * Base Image gets a bigger cap than the other layers: a shot-batch crop
 * (src/lib/mockupCrop.ts) hands this route an already-standardized
 * MOCKUP_CROP_SIZE square, and re-shrinking it back to 2000px here would
 * silently undo the whole point of cropping against the full-resolution
 * original client-side.
 */
async function compressLayer(file: File, maxEdge = 2000): Promise<File> {
  const raw = Buffer.from(await file.arrayBuffer());
  const encode = (quality: number) =>
    sharp(raw)
      .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
  // step quality down until Notion will take it — a busy 4000² photo can
  // exceed the cap even as WebP, and this re-encode must never hand
  // uploadFileToNotion something it already knows will bounce
  let quality = maxEdge > 2000 ? 90 : 82;
  let out = await encode(quality);
  while (out.length > UPLOAD_BUDGET_BYTES && quality > 50) {
    quality -= 8;
    out = await encode(quality);
  }
  return new File([out], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
}

/**
 * Mockup template intake — ONE save, validated whole (spec §4).
 *
 * The corner-placement step runs client-side on the local preview before
 * anything is uploaded, so a Simple Placement template can't exist without
 * its quad: the save is blocked, not the record flagged.
 */
export async function POST(req: Request) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch (err) {
      // Next.js rejects a request body over ~10MB by failing the multipart
      // parse, so the only symptom of "too big" is a message that says
      // "malformed". Clients keep uploads under MAX_UPLOAD_BYTES; if one
      // still lands here, name the real cause rather than repeat undici's.
      const raw = (err as Error).message ?? "";
      if (raw.includes("FormData")) {
        return NextResponse.json(
          {
            error:
              "The upload was too large for the server to accept (the limit is about 10MB per request). " +
              "This is a size problem, not a corrupt file — re-crop a smaller region or use a smaller source photo.",
          },
          { status: 413 }
        );
      }
      throw err;
    }
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
      "Blend Mode": BLEND_MODES.includes(blend as (typeof BLEND_MODES)[number]) ? blend : DEFAULT_BLEND,
      Fit: FIT_MODES.includes(fit as (typeof FIT_MODES)[number]) ? fit : DEFAULT_FIT,
    };
    // Optional: one template serves every colourway of its product — the
    // photo LAYOUT is the template, garment colour is a per-render variable.
    // Kept as metadata for templates that genuinely are colour-locked.
    if (SURFACE_TAGS.includes(str("surface") as (typeof SURFACE_TAGS)[number])) {
      values["Surface"] = str("surface");
    }
    if (str("garmentColor")) values["Garment Color"] = str("garmentColor");
    if (str("sourceLink")) values["File Link"] = str("sourceLink");
    if (str("shotType")) values["Shot Type"] = str("shotType");
    if (quad) values["Print Area Quad (JSON)"] = JSON.stringify(quad);

    // batch shot-crop uploads (src/components/MockupTemplates.tsx's
    // MockupShotIntake) attach the resulting colour variant to its shot
    const shotId = str("shotId");
    if (shotId) {
      const shot = cachedRecord(shotId);
      if (!shot || shot.dbKey !== "mockup_shots") {
        return NextResponse.json({ error: "That shot wasn't found — refresh and try again." }, { status: 400 });
      }
      values["Shot"] = [shotId];
    }

    // uploads last — no orphaned Notion files if validation bounced above
    const uploads: Array<[string, File]> = [["Base Image", baseImage]];
    // a displacement map on a Simple Placement template is stored if sent —
    // switching the pipeline later shouldn't cost a re-upload
    if (displacementMap) uploads.push(["Displacement Map", displacementMap]);
    if (shadowLayer) uploads.push(["Shadow Layer", shadowLayer]);
    if (highlightLayer) uploads.push(["Highlight Layer", highlightLayer]);
    for (const [prop, file] of uploads) {
      // a shot-batch Base Image is already cropped to the standard square at
      // full resolution — only that one file gets the bigger cap
      const maxEdge = shotId && prop === "Base Image" ? MOCKUP_CROP_SIZE : 2000;
      const up = await uploadFileToNotion(await compressLayer(file, maxEdge));
      values[prop] = [{ name: file.name, uploadId: up.id }];
    }

    const record = await createRecord("mockup_templates", values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
