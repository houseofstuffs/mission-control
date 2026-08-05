import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecord } from "@/server/notion/store";
import { getValidAccessToken, connectionStatus } from "@/server/drive/connection";
import { fetchFileBytes } from "@/server/drive/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** file id out of a Drive share link, or null */
function driveFileId(link: string): string | null {
  const m = link.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})/) ?? link.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

/**
 * The variant's ORIGINAL source photo, downscaled for the Adjust-crop
 * editor. The stored Base Image is already cropped — dragging a crop box
 * needs the frame the crop came from. Real source dimensions ride along
 * as headers because the preview is resized and the min-crop feasibility
 * check must run against true pixels.
 *
 * Legacy variants (imported before source tracking) have no stored file
 * id — ?link= lets the operator supply the source's Drive link, and the
 * recrop save then persists it.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const variant = cachedRecord(id);
    if (!variant || variant.dbKey !== "mockup_templates") {
      return NextResponse.json({ error: "Variant not found — refresh first." }, { status: 404 });
    }
    const url = new URL(req.url);
    const linkParam = url.searchParams.get("link") ?? "";
    const stored = String(variant.props["Source Drive File"] ?? "").trim();
    const fileId = stored || (linkParam ? driveFileId(linkParam) : null);
    if (!fileId) {
      // a typed error the UI branches on — this variant predates source
      // tracking, so the editor asks for the link instead of failing
      return NextResponse.json(
        { error: "No source reference stored for this variant.", needsSource: true },
        { status: 409 }
      );
    }
    if (!connectionStatus().connected) {
      return NextResponse.json(
        { error: "Google Drive isn't connected — connect it (Library page) to load the source photo." },
        { status: 400 }
      );
    }
    const token = await getValidAccessToken();
    const { bytes } = await fetchFileBytes(fileId, token);
    const buf = Buffer.from(bytes);
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) {
      return NextResponse.json({ error: "The source file isn't a readable image." }, { status: 400 });
    }
    // editor-sized: the crop box needs the frame, not the pixels
    const preview = await sharp(buf)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    // where the crop box should START: the rect behind the variant's
    // current framing, else the shot's shared rect — "nudge from here",
    // never a from-scratch re-derivation
    let startRect = String(variant.props["Source Crop Rect (JSON)"] ?? "").trim();
    if (!startRect) {
      const shotId = ((variant.props["Shot"] as string[] | null) ?? [])[0];
      const shot = shotId ? cachedRecord(shotId) : null;
      startRect = String(shot?.props["Crop Rect (JSON)"] ?? "").trim();
    }
    return new NextResponse(new Uint8Array(preview), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "x-source-width": String(w),
        "x-source-height": String(h),
        "x-source-file-id": fileId,
        ...(startRect ? { "x-source-crop-rect": startRect } : {}),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
