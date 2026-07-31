import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecord } from "@/server/notion/store";

export const dynamic = "force-dynamic";

/**
 * Card-sized thumbnail with a STABLE URL.
 *
 * The snapshot itself lives on Notion's S3 behind a signed URL that rotates
 * on every sync — so the browser can never cache it, and every board visit
 * re-downloads every full 1400px PNG. This route puts a stable address in
 * front: fetch once, shrink to card size, WebP it, and let the browser
 * cache hard. The `v` query param carries the record's last-edited stamp,
 * so a new snapshot mints a new URL and stale cache is impossible.
 */
const EDGE = 640; // 2× the card slot — crisp on retina, tiny on the wire

// tiny in-process cache so a board of N cards costs N Notion fetches per
// deploy, not per viewer-visit. Bounded; evicts oldest.
const memo = new Map<string, Buffer>();
const MEMO_CAP = 80;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const design = cachedRecord(id);
    if (!design || design.dbKey !== "designs") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const snap = design.props["Artwork Snapshot"];
    const url =
      Array.isArray(snap) && snap.length > 0 ? (snap[0] as { url?: string }).url || null : null;
    if (!url) return NextResponse.json({ error: "No snapshot" }, { status: 404 });

    const version = new URL(req.url).searchParams.get("v") ?? design.lastEdited;
    const key = `${id}:${version}`;

    let thumb = memo.get(key);
    if (!thumb) {
      const res = await fetch(url);
      if (!res.ok) {
        // signed URL expired and the cache is stale — a refresh mints new ones
        return NextResponse.json(
          { error: "Snapshot link expired — refresh from Notion." },
          { status: 502, headers: { "Cache-Control": "no-store" } }
        );
      }
      const raw = Buffer.from(await res.arrayBuffer());
      thumb = await sharp(raw)
        .resize(EDGE, EDGE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      if (memo.size >= MEMO_CAP) {
        const oldest = memo.keys().next().value;
        if (oldest) memo.delete(oldest);
      }
      memo.set(key, thumb);
    }

    return new NextResponse(new Uint8Array(thumb), {
      headers: {
        "Content-Type": "image/webp",
        // the URL changes when the artwork does (v param) — safe to pin
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
