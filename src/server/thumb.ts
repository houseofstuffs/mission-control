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

/** Standard response headers: pin hard — the url changes when the file does. */
export const THUMB_HEADERS = {
  "Content-Type": "image/webp",
  "Cache-Control": "public, max-age=604800, immutable",
} as const;
