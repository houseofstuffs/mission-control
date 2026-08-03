import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import { parseQuad } from "@/config/mockups";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/** Saves the shot's shared crop rectangle, or the hand-set framing-inconsistency flag. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const shot = cachedRecord(id);
    if (!shot || shot.dbKey !== "mockup_shots") {
      return NextResponse.json({ error: "Shot not found in cache — refresh first." }, { status: 404 });
    }
    const body = await req.json();
    const values: Record<string, SimpleValue> = {};

    if (body.cropRect !== undefined) {
      const r = body.cropRect as { x?: unknown; y?: unknown; size?: unknown } | null;
      if (
        !r ||
        typeof r.x !== "number" ||
        typeof r.y !== "number" ||
        typeof r.size !== "number" ||
        r.size <= 0
      ) {
        return NextResponse.json({ error: "Invalid crop rect." }, { status: 400 });
      }
      values["Crop Rect (JSON)"] = JSON.stringify({ x: r.x, y: r.y, size: r.size });
      values["Crop Set At"] = new Date().toISOString().slice(0, 10);
    }
    if (body.printRegionQuad !== undefined) {
      const quad = parseQuad(body.printRegionQuad);
      if (!quad) {
        return NextResponse.json({ error: "Invalid print region — four corners, 0–1 each." }, { status: 400 });
      }
      values["Print Region Quad (JSON)"] = JSON.stringify(quad);
    }
    if (body.driveFolderLink !== undefined) {
      values["Drive Folder Link"] = String(body.driveFolderLink).trim() || null;
    }
    if (body.framingFlagged !== undefined) values["Framing Flagged"] = Boolean(body.framingFlagged);
    if (body.framingNotes !== undefined) values["Framing Notes"] = String(body.framingNotes);

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("mockup_shots", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
