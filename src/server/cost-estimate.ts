/**
 * Estimated base cost for a product — one number to compare products by,
 * averaged over the variants that actually represent the thing being sold.
 *
 * Which variants those are depends on the category:
 *
 *   apparel — average the CORE SIZES only. A tee's 4XL costs more than its S
 *     and sells a fraction as often; averaging the full size run makes every
 *     shirt look more expensive than it is in practice.
 *
 *   home / wall_art / misc — average everything. Size on these products is a
 *     DIMENSION, not a fit: an 18×24 poster and a 24×36 poster are different
 *     products at different prices, not two points on one garment's range.
 *     Filtering there would throw away half the catalogue.
 *
 *   unset — no estimate. Guessing the averaging rule is how you get a number
 *     that looks authoritative and is quietly wrong.
 */
import type { Category } from "@/config/product-categories";

/** The sizes that carry apparel volume. 2XL is the last one at base price. */
export const CORE_SIZES = ["S", "M", "L", "XL", "2XL"];

export interface CostEstimate {
  /** mean base cost across the counted variants, or null when not computable */
  estimatedCost: number | null;
  /** what the filter did, for display — never silently omitted */
  sizeFilterApplied: string;
  /** how many variants the mean is over */
  sampleSize: number;
  /** set when there's no number: why not, in the words the card shows */
  reason: string | null;
}

export interface CostVariant {
  size: string | null;
  baseCost: number | null;
}

/** "xxl" / " 2xl " / "2XL" all land on the same bucket. */
function normalizeSize(size: string): string {
  const s = size.trim().toUpperCase().replace(/\s+/g, "");
  const xs = /^(X+)L$/.exec(s); // XL, XXL, XXXL…
  if (xs) return xs[1].length === 1 ? "XL" : `${xs[1].length}XL`;
  return s;
}

export function estimateCost(variants: CostVariant[], category: Category | null): CostEstimate {
  if (!category) {
    return {
      estimatedCost: null,
      sizeFilterApplied: "—",
      sampleSize: 0,
      reason: "Set category to estimate cost.",
    };
  }

  const priced = variants.filter((v): v is CostVariant & { baseCost: number } => v.baseCost != null);

  if (category !== "apparel") {
    return finish(priced, "n/a — non-apparel category");
  }

  const core = priced.filter((v) => v.size && CORE_SIZES.includes(normalizeSize(v.size)));
  // A blueprint with no recognisable core sizes (one-size items filed as
  // apparel, unusual size labels) still deserves a number — but the label
  // says which set it came from, so it's never mistaken for a core average.
  if (core.length === 0) {
    return finish(priced, `no ${CORE_SIZES.join("/")} variants — averaged all sizes`);
  }
  return finish(core, `core sizes (${CORE_SIZES.join(", ")})`);
}

function finish(
  variants: Array<{ baseCost: number }>,
  sizeFilterApplied: string
): CostEstimate {
  if (variants.length === 0) {
    return {
      estimatedCost: null,
      sizeFilterApplied,
      sampleSize: 0,
      // Printify's public catalog doesn't carry base costs — they're
      // shop-scoped — so this is the normal state until costs are entered.
      reason: "No variant costs recorded yet.",
    };
  }
  const total = variants.reduce((sum, v) => sum + v.baseCost, 0);
  return {
    estimatedCost: total / variants.length,
    sizeFilterApplied,
    sampleSize: variants.length,
    reason: null,
  };
}
