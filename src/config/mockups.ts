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
/**
 * Print (DTG) is the default and the honest one: real DTG lays a white
 * underbase, so design colours stay TRUE on any garment and the fabric
 * shows through only as subtle texture. Multiply — the old default — is a
 * light-garment trick that tints the art with the shirt: the first real
 * generate turned an off-white margarita glass brown on Espresso and
 * invisible on Black. Multiply stays available for deliberately-vintage
 * looks on light garments; Normal is a flat paste-over with no texture.
 */
export const BLEND_MODES = ["Print (DTG)", "Multiply", "Normal"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];
export const DEFAULT_BLEND: BlendMode = "Print (DTG)";

/**
 * How strongly the garment's weave shows through the print in Print (DTG)
 * mode. 0 = flat sticker, 1 = fully fabric-modulated. ~0.25 reads as ink
 * on fabric without shifting the design's colour identity.
 */
export const FABRIC_TEXTURE_STRENGTH = 0.25;

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

/**
 * How a DESIGN sits inside the print region — the third, listing-scoped
 * adjustment in the family:
 *   crop      = the photo's framing        (variant, shared, persisted)
 *   quad      = the garment's printable zone (template)
 *   placement = how THIS design sits in that zone (listing/design)
 * scale is a factor about the region's centre; dx/dy are fractions of the
 * region's width/height; rot in degrees, clockwise. Applied at render
 * time inside the quad plane, clipped to the region like real DTG.
 */
export interface ArtPlacement {
  scale: number;
  dx: number;
  dy: number;
  rot: number;
}
export const IDENTITY_PLACEMENT: ArtPlacement = { scale: 1, dx: 0, dy: 0, rot: 0 };

export function clampPlacement(p: Partial<ArtPlacement> | null | undefined): ArtPlacement {
  const n = (v: unknown, lo: number, hi: number, dflt: number) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
  };
  return {
    scale: n(p?.scale, 0.2, 3, 1),
    dx: n(p?.dx, -0.75, 0.75, 0),
    dy: n(p?.dy, -0.75, 0.75, 0),
    rot: n(p?.rot, -180, 180, 0),
  };
}

export const isIdentityPlacement = (p: ArtPlacement) =>
  Math.abs(p.scale - 1) < 0.005 && Math.abs(p.dx) < 0.005 && Math.abs(p.dy) < 0.005 && Math.abs(p.rot) < 0.05;

/** The listing's stored placement: one default + per-variant exceptions. */
export interface PlacementMap {
  default: ArtPlacement | null;
  perVariant: Record<string, ArtPlacement>;
}

export function parsePlacementMap(raw: unknown): PlacementMap {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { default: null, perVariant: {} };
    const o = parsed as { default?: unknown; perVariant?: Record<string, unknown> };
    const perVariant: Record<string, ArtPlacement> = {};
    if (o.perVariant && typeof o.perVariant === "object" && !Array.isArray(o.perVariant)) {
      for (const [id, v] of Object.entries(o.perVariant)) {
        if (v && typeof v === "object") {
          const c = clampPlacement(v as Partial<ArtPlacement>);
          if (!isIdentityPlacement(c)) perVariant[id] = c;
        }
      }
    }
    const dflt = o.default && typeof o.default === "object" ? clampPlacement(o.default as Partial<ArtPlacement>) : null;
    return { default: dflt && !isIdentityPlacement(dflt) ? dflt : null, perVariant };
  } catch {
    return { default: null, perVariant: {} };
  }
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

/**
 * The byte budget for any one image bound for Notion.
 *
 * Notion's free plan rejects uploads over 5 MiB, and that cap binds before
 * Next.js's ~10 MiB request-body wall does. A real recovery run proved it:
 * three busy photos encoded to 5.3–5.6 MiB — comfortably under the old
 * 8 MiB budget, dead on arrival at Notion. 4.8 MiB leaves margin for the
 * odd encoder wobble. Every encoder that produces a Notion-bound image —
 * client crop, server import job, the route's layer compressor — reads
 * this one number.
 */
export const UPLOAD_BUDGET_BYTES = Math.floor(4.8 * 1024 * 1024);

/** A fresh shot crop starts centred, sized to whatever fits — the guard corrects it if it's infeasible. */
export const DEFAULT_CROP_RECT = { x: 0.15, y: 0.15, size: 0.7 };

/* ---------- colour-grid composite tunables ---------- */

/**
 * How a render meets its grid cell — the crop-tightness dial:
 *   Fit        — the whole square render scaled into the cell, nothing
 *                shaved. Cells sit in a centred band on the background.
 *   Tall crop  — cells ~1.5× taller than wide; crops in for a closer
 *                look but keeps the garment whole. (Single-row layouts
 *                only get taller cells — multi-row layouts have no
 *                headroom, so Tall degenerates toward Fit there.)
 *   Full bleed — edge-to-edge cover crop, no gutters (the original).
 * Default is Fit: the 3×1 cover-crop shaved real garments in testing.
 */
export const GRID_CELL_MODES = ["fit", "tall", "cover"] as const;
export type GridCellMode = (typeof GRID_CELL_MODES)[number];
export const DEFAULT_GRID_CELL_MODE: GridCellMode = "fit";

/**
 * Background behind Fit/Tall grids — the operator's cream, matching the
 * shop's graphic cards so the gallery reads as one system. A setting on
 * purpose: rebrand means changing it HERE, not hunting a hard-code.
 */
export const GRID_BACKGROUND = "#FBF6EC";

/** Gutter between cells / margin around the grid, in px at the 2000px output. */
export const GRID_GUTTER = 28;
export const GRID_MARGIN = 60;

/* ---------- artwork-detail composite ---------- */

/**
 * The two backgrounds the artwork-detail shot offers — the operator picks
 * per design (dark-built art reads differently on light). Settings, not
 * hard-codes; the light one matches the graphic cards' eggshell.
 */
export const ARTWORK_BACKGROUNDS = { dark: "#000000", light: "#FBF6EC" } as const;
export type ArtworkBackground = keyof typeof ARTWORK_BACKGROUNDS;

/** Breathing room around the artwork's bounding box in its square, as a fraction of art width. */
export const ARTWORK_PAD_FRAC = 0.04;

/* ---------- render tunables ---------- */

/** Long edge the render works at — Etsy wants ~2000px; bigger is wasted work. */
export const RENDER_MAX_EDGE = 2000;

/**
 * Displacement strength as a fraction of the base's long edge — how far a
 * full-black→full-white swing in the map pushes a pixel. 0.006 ≈ 12px at
 * 2000px: visible fabric ripple without tearing type apart.
 */
export const DISPLACEMENT_STRENGTH = 0.006;
