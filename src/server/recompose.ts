/**
 * Recomposition detection — ONE rule, used by the C9 fan-out flag, the L1
 * print-file panel, and the L6 gate, so "needs recompose" can never mean
 * different things on different screens.
 *
 * The master is composed for the primary product's front print area.
 * Another product whose front ratio deviates more than the threshold needs
 * a re-laid-out file, not a scale — letting Printify stretch or crop past
 * that bar prints visibly wrong.
 */
import type { SimpleRecord } from "@/server/notion/props";

export const RECOMPOSE_DEVIATION = 0.12;

/** Ratio of a product's first print area, from its stored Print Areas JSON. */
export function frontRatio(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const areas = JSON.parse(raw) as Array<{ maxWidth?: number; maxHeight?: number }>;
    const a = areas?.[0];
    return a?.maxWidth && a?.maxHeight ? a.maxWidth / a.maxHeight : null;
  } catch {
    return null;
  }
}

/** Does this product's shape demand a recomposed file for this design? */
export function needsRecompose(design: SimpleRecord, product: SimpleRecord): boolean {
  const masterRatio = frontRatio(design.props["Master Canvas (JSON)"]);
  const ratio = frontRatio(product.props["Print Areas (JSON)"]);
  return (
    masterRatio != null &&
    ratio != null &&
    Math.abs(ratio - masterRatio) / masterRatio > RECOMPOSE_DEVIATION
  );
}

/** The derivative record for a design × product pair, if one was ever made. */
export function derivativeFor(
  derivatives: SimpleRecord[],
  designId: string,
  productId: string
): SimpleRecord | null {
  return (
    derivatives.find(
      (d) =>
        ((d.props["Design"] as string[] | null) ?? []).includes(designId) &&
        ((d.props["Product"] as string[] | null) ?? []).includes(productId)
    ) ?? null
  );
}
