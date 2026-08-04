import { NextResponse } from "next/server";
import { cachedRecord, createRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { parseQuad } from "@/config/mockups";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // one small sample upload at most

/** A crop rect is {x, y, size}, all finite, size positive. */
function parseCropRect(raw: unknown): { x: number; y: number; size: number } | null {
  const r = raw as { x?: unknown; y?: unknown; size?: unknown } | null;
  if (!r || typeof r.x !== "number" || typeof r.y !== "number" || typeof r.size !== "number" || r.size <= 0) {
    return null;
  }
  return { x: r.x, y: r.y, size: r.size };
}

/**
 * Creates a template (the framing record variants attach to). The two-phase
 * flow defines the whole geometry here — crop AND print region — from one
 * sample, before any colour exists. The sample's GEOMETRY is what matters;
 * its preview-sized crop is kept only as the card thumbnail.
 *
 * Multipart, not JSON: the thumbnail rides along in the same request, so a
 * template can never exist half-made (record saved, thumbnail failed).
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v.trim() : "";
    };

    const name = str("name");
    if (!name) return NextResponse.json({ error: "Name the template — e.g. \"CC1466 Flat Lay\"." }, { status: 400 });

    const values: Record<string, SimpleValue> = { Name: name };

    if (str("cropRect")) {
      const rect = parseCropRect(JSON.parse(str("cropRect")));
      if (!rect) return NextResponse.json({ error: "Invalid crop rect." }, { status: 400 });
      values["Crop Rect (JSON)"] = JSON.stringify(rect);
      values["Crop Set At"] = new Date().toISOString().slice(0, 10);
    }
    if (str("printRegionQuad")) {
      const quad = parseQuad(str("printRegionQuad"));
      if (!quad) return NextResponse.json({ error: "Invalid print region — four corners, 0–1 each." }, { status: 400 });
      values["Print Region Quad (JSON)"] = JSON.stringify(quad);
    }
    if (str("driveFolderLink")) values["Drive Folder Link"] = str("driveFolderLink");
    // which garment this shoot is OF — L4's picker filters on it; unset
    // means the template shows for every listing
    if (str("productId")) {
      const product = cachedRecord(str("productId"));
      if (!product || product.dbKey !== "products") {
        return NextResponse.json({ error: "Unknown product — refresh and retry." }, { status: 400 });
      }
      values["Product"] = [product.id];
    }

    const sample = form.get("sampleImage");
    if (sample && typeof sample !== "string" && sample.size > 0) {
      const up = await uploadFileToNotion(sample);
      values["Sample Image"] = [{ name: sample.name, uploadId: up.id }];
    }

    const record = await createRecord("mockup_shots", values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
