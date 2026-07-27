/**
 * Master-canvas math (spec §5.1).
 *
 * Primary product = a commercial choice. Master canvas = a technical
 * constraint set by the most demanding print area in the line — "largest"
 * means pixel dimensions at print DPI, which Printify's placeholders already
 * express in px. Aspect ratio is the generation constraint; pixel dimensions
 * are the export constraint.
 */
import type { CatalogVariant } from "./client";

export interface PrintAreaSummary {
  position: string;
  maxWidth: number;
  maxHeight: number;
  /** width / height, rounded */
  ratio: number;
  ratioLabel: string;
}

export interface MasterCanvasSpec {
  maxWidth: number;
  maxHeight: number;
  areas: PrintAreaSummary[];
  /** positions whose ratio differs enough from the primary area to need
   * recomposition rather than scaling (a mug wrap is not a scaled shirt) */
  recomposePositions: string[];
  recompositionFlag: boolean;
}

/** Ratios differing by more than this fraction need recomposition, not scaling. */
const RECOMPOSE_THRESHOLD = 0.12;

function ratioLabel(w: number, h: number): string {
  if (!w || !h) return "—";
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  // round to a friendly ratio using a coarse grid to avoid 4013:2971 labels
  const scale = 100;
  const rw = Math.round((w / h) * scale);
  const g = gcd(rw, scale);
  return `${rw / g}:${scale / g}`;
}

export function computeMasterCanvas(variants: CatalogVariant[]): MasterCanvasSpec {
  const byPosition = new Map<string, { maxWidth: number; maxHeight: number }>();
  for (const variant of variants) {
    for (const ph of variant.placeholders ?? []) {
      const cur = byPosition.get(ph.position) ?? { maxWidth: 0, maxHeight: 0 };
      cur.maxWidth = Math.max(cur.maxWidth, ph.width);
      cur.maxHeight = Math.max(cur.maxHeight, ph.height);
      byPosition.set(ph.position, cur);
    }
  }

  const areas: PrintAreaSummary[] = [...byPosition.entries()].map(([position, dims]) => ({
    position,
    maxWidth: dims.maxWidth,
    maxHeight: dims.maxHeight,
    ratio: dims.maxHeight ? dims.maxWidth / dims.maxHeight : 0,
    ratioLabel: ratioLabel(dims.maxWidth, dims.maxHeight),
  }));

  // Primary area = the largest by pixel area; usually "front".
  const primary =
    areas.find((a) => a.position === "front") ??
    areas.slice().sort((a, b) => b.maxWidth * b.maxHeight - a.maxWidth * a.maxHeight)[0];

  const recomposePositions = primary
    ? areas
        .filter(
          (a) =>
            a.position !== primary.position &&
            a.ratio > 0 &&
            primary.ratio > 0 &&
            Math.abs(a.ratio - primary.ratio) / primary.ratio > RECOMPOSE_THRESHOLD
        )
        .map((a) => a.position)
    : [];

  return {
    maxWidth: Math.max(0, ...areas.map((a) => a.maxWidth)),
    maxHeight: Math.max(0, ...areas.map((a) => a.maxHeight)),
    areas,
    recomposePositions,
    recompositionFlag: recomposePositions.length > 0,
  };
}
