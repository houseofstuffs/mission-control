/**
 * Mockup template pipelines — the two ways an artwork lands on a photo.
 *
 * SIMPLE PLACEMENT: perspective-warp the artwork into a hand-placed quad,
 * composite with a blend mode. What you can do with any flat product photo.
 *
 * FULL DISPLACEMENT: warp the artwork through a displacement map so it
 * follows fabric folds, then multiply shadows / screen highlights back over
 * it — the layers a purchased PSD mockup usually ships with. Shadow and
 * highlight are OPTIONAL: many sources don't include them, and a template
 * without them renders fine, silently.
 *
 * The pipeline is chosen ONCE, at intake. Render reads it off the record —
 * never a per-render decision.
 */

export const PIPELINE_TYPES = ["Simple Placement", "Full Displacement"] as const;
export type PipelineType = (typeof PIPELINE_TYPES)[number];

/** Simple Placement's composite step. Multiply sinks ink into fabric; normal for stickers/frames. */
export const BLEND_MODES = ["Multiply", "Normal"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];
export const DEFAULT_BLEND: BlendMode = "Multiply";

/**
 * How artwork meets the print area when their ratios disagree — a property
 * of the template's footprint, chosen at intake:
 *   Fit inside — whole artwork visible at its own ratio, leftover
 *                transparent. Garment print areas shown whole.
 *   Fill area  — artwork covers the area edge-to-edge, overflow cropped
 *                equally. Die-cuts, full-bleed frames, wraps.
 *   Fill width from top — artwork spans the area's width, anchored at
 *                the top, bottom cropped by the box. Folded garments and
 *                any layout where the lower print disappears below a fold.
 * None of them ever stretches the artwork.
 */
export const FIT_MODES = ["Fit inside", "Fill area", "Fill width from top"] as const;
export type FitMode = (typeof FIT_MODES)[number];
export const DEFAULT_FIT: FitMode = "Fit inside";

/**
 * What the photo shows — filters which templates get offered for a design's
 * garment compatibility (dark-only art never gets a white-tee template).
 */
export const SURFACE_TAGS = ["Dark garment", "Light garment", "Any garment", "Non-garment surface"] as const;
export type SurfaceTag = (typeof SURFACE_TAGS)[number];

/**
 * Print-area quad — four corners in NORMALIZED base-image coordinates
 * (0–1, so the quad survives any resize), order TL → TR → BR → BL.
 */
export type Quad = [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
];

export function parseQuad(raw: unknown): Quad | null {
  let value = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || value.length !== 4) return null;
  const pts = value.map((p) => ({ x: Number(p?.x), y: Number(p?.y) }));
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  if (pts.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return null;
  // Degenerate quads (all corners in a heap) warp to nothing — require some area.
  const area =
    Math.abs(
      pts[0].x * (pts[1].y - pts[3].y) +
        pts[1].x * (pts[2].y - pts[0].y) +
        pts[2].x * (pts[3].y - pts[1].y) +
        pts[3].x * (pts[0].y - pts[2].y)
    ) / 2;
  if (area < 0.005) return null;
  return pts as Quad;
}

/** Fresh templates start from a centred rectangle the corner UI drags from. */
export const DEFAULT_QUAD: Quad = [
  { x: 0.3, y: 0.3 },
  { x: 0.7, y: 0.3 },
  { x: 0.7, y: 0.7 },
  { x: 0.3, y: 0.7 },
];

/**
 * Standard output crop for a mockup shot batch — one square framing
 * decision per shot, reused by every colour variant and every render
 * forever after (src/lib/mockupCrop.ts). 1:1 so it works as a listing
 * thumbnail directly, no letterboxing.
 *
 * The SIZE is adaptive between the floor and the cap, because a tight
 * garment crop out of a big photo still yields far fewer pixels than the
 * photo's own dimensions suggest: a 6830×5464 shot cropped to the garment
 * gives ~2,500px, not 4,000. Demanding the cap outright blocked saves on
 * perfectly usable sources. Upscaling is never the answer — a crop that
 * can't reach the floor is genuinely too small and gets flagged.
 */
export const MOCKUP_CROP_SIZE = 4000;
/** Below this the crop isn't worth keeping — flagged, and the save is blocked. */
export const MOCKUP_CROP_MIN = 2000;

/** A fresh shot crop starts centred, sized to whatever fits — the guard corrects it if it's infeasible. */
export const DEFAULT_CROP_RECT = { x: 0.15, y: 0.15, size: 0.7 };

/* ---------- render tunables ---------- */

/** Long edge the render works at — Etsy wants ~2000px; bigger is wasted work. */
export const RENDER_MAX_EDGE = 2000;

/**
 * Displacement strength as a fraction of the base's long edge — how far a
 * full-black→full-white swing in the map pushes a pixel. 0.006 ≈ 12px at
 * 2000px: visible fabric ripple without tearing type apart.
 */
export const DISPLACEMENT_STRENGTH = 0.006;
