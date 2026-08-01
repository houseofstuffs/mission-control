/**
 * Card-sized thumbnails for Notion-hosted files, behind STABLE urls.
 *
 * Notion file links are signed and rotate on every sync, so the browser can
 * never cache them and every page visit re-downloads full-size files. Routes
 * built on this helper put a stable address in front: fetch once, shrink to
 * card size, WebP, cache hard client-side (the caller's `v` param carries a
 * version stamp, so a changed file mints a new url).
 */
import sharp from "sharp";
import type { SimpleRecord } from "@/server/notion/props";

const EDGE = 640; // 2× a card slot — crisp on retina, tiny on the wire

// in-process memo: N fetches per deploy, not per visit. Bounded, oldest out.
const memo = new Map<string, Buffer>();
const MEMO_CAP = 120;

export function firstFileUrl(record: SimpleRecord, prop: string): string | null {
  const v = record.props[prop];
  if (!Array.isArray(v) || v.length === 0) return null;
  return (v[0] as { url?: string })?.url || null;
}

export class ThumbSourceExpiredError extends Error {}

export async function thumbFor(record: SimpleRecord, prop: string, version: string): Promise<Buffer> {
  const key = `${record.id}:${prop}:${version}`;
  const hit = memo.get(key);
  if (hit) return hit;

  const url = firstFileUrl(record, prop);
  if (!url) throw new Error(`No file in "${prop}".`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new ThumbSourceExpiredError("File link expired — refresh from Notion.");
  }
  const raw = Buffer.from(await res.arrayBuffer());
  const thumb = await sharp(raw)
    .resize(EDGE, EDGE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  if (memo.size >= MEMO_CAP) {
    const oldest = memo.keys().next().value;
    if (oldest) memo.delete(oldest);
  }
  memo.set(key, thumb);
  return thumb;
}

/**
 * Same as thumbFor, but self-heals an expired signed URL: one re-fetch of
 * the record from Notion (fresh URL), one retry, before giving up. Notion's
 * file links go stale roughly an hour after the record was last synced —
 * this means the operator doesn't have to notice and hit Refresh by hand
 * just to see a thumbnail again.
 */
export async function thumbForFresh(
  dbKey: string,
  record: SimpleRecord,
  prop: string,
  version: string
): Promise<Buffer> {
  try {
    return await thumbFor(record, prop, version);
  } catch (err) {
    if (!(err instanceof ThumbSourceExpiredError)) throw err;
    const { refreshRecord } = await import("@/server/notion/store");
    const fresh = await refreshRecord(dbKey, record.id);
    return thumbFor(fresh, prop, version);
  }
}

/** Standard response headers: pin hard — the url changes when the file does. */
export const THUMB_HEADERS = {
  "Content-Type": "image/webp",
  "Cache-Control": "public, max-age=604800, immutable",
} as const;
