import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecord } from "@/server/notion/store";
import { fetchMaster } from "@/server/mockup/generateJob";

export const dynamic = "force-dynamic";

/**
 * A slot's Asset Ref, as an image the carousel can actually show.
 *
 * Internal refs (our own /api/generated-mockups/... route) just redirect —
 * that route already re-mints Notion URLs. The case this exists for is the
 * EXTERNAL ref: a graphic-card slot holding a hand-pasted Drive share
 * link. Put that straight in an <img> and Drive serves its HTML viewer
 * page — a blank thumb. fetchMaster knows how to get the real bytes
 * (Drive API when connected, direct fetch otherwise, HTML-viewer
 * detection either way); we resize to the asked-for size and cache.
 *
 * Scoped to a slot id on purpose: this is NOT a generic URL proxy. It
 * only ever fetches the link stored on the named slot record.
 */

const SIZES = new Set([320, 1200]);
const memo = new Map<string, { ref: string; bytes: Buffer }>();

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const slot = cachedRecord(id);
    if (!slot || slot.dbKey !== "image_slots") {
      return NextResponse.json({ error: "Slot not found — refresh first." }, { status: 404 });
    }
    const ref = String(slot.props["Asset Ref"] ?? "").trim();
    if (!ref) return NextResponse.json({ error: "This slot has no asset." }, { status: 404 });

    // our own routes handle themselves — don't proxy the proxy
    if (ref.startsWith("/")) {
      return NextResponse.redirect(new URL(ref, req.url), { headers: { "Cache-Control": "private, max-age=600" } });
    }

    const wanted = Number(new URL(req.url).searchParams.get("size"));
    const size = SIZES.has(wanted) ? wanted : 1200;
    const key = `${id}:${size}`;
    const hit = memo.get(key);
    if (hit && hit.ref === ref) {
      return new NextResponse(new Uint8Array(hit.bytes), {
        headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=600" },
      });
    }

    const master = await fetchMaster(ref);
    const bytes = await sharp(master)
      .resize(size, size, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    if (memo.size > 80) memo.delete(memo.keys().next().value as string);
    memo.set(key, { ref, bytes });
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=600" },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
