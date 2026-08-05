/**
 * The geometry that ties a variant's cropped frame back to its source
 * photo. Shared by the recrop route (quad re-mapping) and the source
 * route (ghost print-region overlay) — one set of maths, because a
 * remap that disagrees with the overlay it was previewed against is
 * worse than no overlay.
 */
import { parseQuad, type Quad } from "@/config/mockups";
import type { SimpleRecord } from "@/server/notion/props";
import { cachedRecord } from "@/server/notion/store";

export type Rect = { x: number; y: number; size: number };

export function parseRect(raw: unknown): Rect | null {
  try {
    const p = JSON.parse(String(raw ?? ""));
    if (p && typeof p.x === "number" && typeof p.y === "number" && typeof p.size === "number") return p;
  } catch {
    /* not set */
  }
  return null;
}

/** the crop's pixel frame — EXACTLY the maths the crop itself uses */
export function frame(rect: Rect, w: number, h: number) {
  const side = Math.min(Math.round(rect.size * Math.min(w, h)), w, h);
  const left = Math.round(Math.min(Math.max(rect.x * w, 0), Math.max(w - side, 0)));
  const top = Math.round(Math.min(Math.max(rect.y * h, 0), Math.max(h - side, 0)));
  return { left, top, side };
}

export const quadsEqual = (a: Quad, b: Quad) =>
  a.every((p, i) => Math.abs(p.x - b[i].x) < 0.002 && Math.abs(p.y - b[i].y) < 0.002);

/**
 * The print region a variant's CURRENT quad describes, as a pair the
 * remap can trust: the quad plus the rect whose framing it's expressed
 * in. A quad still equal to the SHOT's uses the shot's own quad+rect —
 * always internally consistent, even for variants re-cropped before
 * remapping existed. A hand-tweaked quad pairs with the variant's
 * stored rect, the framing it was tweaked on. Null = no baseline.
 */
export function quadBaseline(variant: SimpleRecord): { quad: Quad; rect: Rect } | null {
  const variantQuad = parseQuad(String(variant.props["Print Area Quad (JSON)"] ?? ""));
  if (!variantQuad) return null;
  const storedRect = parseRect(variant.props["Source Crop Rect (JSON)"]);
  const shotId = ((variant.props["Shot"] as string[] | null) ?? [])[0];
  const shot = shotId ? cachedRecord(shotId) : null;
  const shotQuad = shot ? parseQuad(String(shot.props["Print Region Quad (JSON)"] ?? "")) : null;
  const shotRect = shot ? parseRect(shot.props["Crop Rect (JSON)"]) : null;
  if (shotQuad && shotRect && quadsEqual(variantQuad, shotQuad)) return { quad: shotQuad, rect: shotRect };
  if (storedRect) return { quad: variantQuad, rect: storedRect };
  return null;
}

/** frame-normalized quad → SOURCE-image-normalized quad (glued to the garment) */
export function quadToSourceCoords(quad: Quad, rect: Rect, w: number, h: number): Quad {
  const f = frame(rect, w, h);
  return quad.map((p) => ({
    x: (f.left + p.x * f.side) / w,
    y: (f.top + p.y * f.side) / h,
  })) as Quad;
}

/**
 * Re-expresses a quad drawn on the OLD framing in the NEW framing, by way
 * of source pixels. Clamped to [0,1]; reports whether clamping actually
 * moved anything (the print region fell partly outside the new frame).
 */
export function remapQuad(
  quad: Quad,
  from: Rect,
  to: Rect,
  w: number,
  h: number
): { quad: Quad; clipped: boolean } | null {
  const f1 = frame(from, w, h);
  const f2 = frame(to, w, h);
  if (!f1.side || !f2.side) return null;
  let clipped = false;
  const mapped = quad.map((p) => {
    const sx = f1.left + p.x * f1.side;
    const sy = f1.top + p.y * f1.side;
    const nx = (sx - f2.left) / f2.side;
    const ny = (sy - f2.top) / f2.side;
    const cx = Math.min(1, Math.max(0, nx));
    const cy = Math.min(1, Math.max(0, ny));
    if (Math.abs(cx - nx) > 0.001 || Math.abs(cy - ny) > 0.001) clipped = true;
    return { x: cx, y: cy };
  }) as Quad;
  // a quad that clamps into a sliver is no quad at all
  return parseQuad(mapped) ? { quad: mapped, clipped } : null;
}
