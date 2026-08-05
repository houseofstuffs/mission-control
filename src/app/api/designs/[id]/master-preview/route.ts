import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecord } from "@/server/notion/store";
import { fetchMaster } from "@/server/mockup/generateJob";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The design's REAL master, downscaled with its alpha intact — what the
 * Place preview composites, because it's what the renderer composites.
 * The C2 snapshot thumb is a flattened concept picture: previewing with
 * it painted transparency as solid black and hid where the art ends.
 *
 * Headers carry the print-truth numbers the placement readout needs:
 * the file's full canvas dimensions, and the bounding box of its VISIBLE
 * content (alpha > 3%) — a 4200×4800 file with an empty bottom prints
 * smaller art than its canvas suggests, and that difference should be a
 * number on screen, not a surprise on a shirt.
 */
const memo = new Map<string, { body: Buffer; headers: Record<string, string> }>();
const MEMO_CAP = 12;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const design = cachedRecord(id);
    if (!design || design.dbKey !== "designs") {
      return NextResponse.json({ error: "Design not found — refresh first." }, { status: 404 });
    }
    const link = String(design.props["Master PNG Link"] ?? "").trim();
    if (!link) {
      return NextResponse.json({ error: "The design has no Master PNG Link — save it at C7." }, { status: 404 });
    }
    const key = `${id}:${design.lastEdited}`;
    let hit = memo.get(key);
    if (!hit) {
      const buf = await fetchMaster(link);
      const meta = await sharp(buf).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      if (!w || !h) {
        return NextResponse.json({ error: "The master isn't a readable image." }, { status: 400 });
      }
      // content bounds from a downscaled alpha scan — exact enough (±1%
      // of an edge) for a readout, cheap enough to do on every re-mint
      const SCAN = 400;
      const scan = await sharp(buf)
        .resize(SCAN, SCAN, { fit: "inside", withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let minX = scan.info.width, maxX = -1, minY = scan.info.height, maxY = -1;
      for (let y = 0; y < scan.info.height; y++) {
        for (let x = 0; x < scan.info.width; x++) {
          if (scan.data[(y * scan.info.width + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const sx = w / scan.info.width;
      const sy = h / scan.info.height;
      const content =
        maxX >= 0
          ? {
              left: Math.round(minX * sx),
              top: Math.round(minY * sy),
              width: Math.round((maxX - minX + 1) * sx),
              height: Math.round((maxY - minY + 1) * sy),
            }
          : { left: 0, top: 0, width: w, height: h };
      const body = await sharp(buf)
        .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 }) // webp keeps alpha — that's the whole point
        .toBuffer();
      hit = {
        body,
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, max-age=600",
          "x-master-width": String(w),
          "x-master-height": String(h),
          "x-content-left": String(content.left),
          "x-content-top": String(content.top),
          "x-content-width": String(content.width),
          "x-content-height": String(content.height),
        },
      };
      if (memo.size >= MEMO_CAP) {
        const oldest = memo.keys().next().value;
        if (oldest) memo.delete(oldest);
      }
      memo.set(key, hit);
    }
    return new NextResponse(new Uint8Array(hit.body), { headers: hit.headers });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
