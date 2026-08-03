import { NextResponse } from "next/server";
import { createRecord } from "@/server/notion/store";
import { parseQuad } from "@/config/mockups";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

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
 * sample, before any colour exists; the sample itself is discarded, only
 * its geometry survives.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name the template — e.g. \"CC1466 Flat Lay\"." }, { status: 400 });

    const values: Record<string, SimpleValue> = { Name: name };

    if (body.cropRect !== undefined) {
      const rect = parseCropRect(body.cropRect);
      if (!rect) return NextResponse.json({ error: "Invalid crop rect." }, { status: 400 });
      values["Crop Rect (JSON)"] = JSON.stringify(rect);
      values["Crop Set At"] = new Date().toISOString().slice(0, 10);
    }
    if (body.printRegionQuad !== undefined) {
      const quad = parseQuad(body.printRegionQuad);
      if (!quad) return NextResponse.json({ error: "Invalid print region — four corners, 0–1 each." }, { status: 400 });
      values["Print Region Quad (JSON)"] = JSON.stringify(quad);
    }
    if (body.driveFolderLink !== undefined && String(body.driveFolderLink).trim()) {
      values["Drive Folder Link"] = String(body.driveFolderLink).trim();
    }

    const record = await createRecord("mockup_shots", values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
