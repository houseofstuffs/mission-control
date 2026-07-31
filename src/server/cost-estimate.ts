/**
 * Estimated base cost for a product — one number to compare products by,
 * produced by one of three methods. The method is stored next to the number
 * (Cost Calc Method) because they mean different things:
 *
 *   Core size average    apparel. Average the sizes that carry volume —
 *                        S–2XL — because a tee's 4XL costs more and sells a
 *                        fraction as often; a full-run average makes every
 *                        shirt look more expensive than it is in practice.
 *
 *   Representative size  wall_art. Poster sizes are DIFFERENT PRODUCTS at
 *                        different prices, not a range: averaging 8×10 with
 *                        24×36 produces a number no buyer ever pays. One
 *                        variant is chosen as the anchor and its cost IS the
 *                        estimate. Until it's chosen there is no estimate.
 *
 *   Full average         home / misc — no strong size spread, every variant
 *                        counts.
 *
 *   unset category       no estimate at all. Guessing the method is how you
 *                        get a number that looks authoritative and is wrong.
 */
import type { Category } from "@/config/product-categories";

/** The sizes that carry apparel volume. 2XL is the last one at base price. */
export const CORE_SIZES = ["S", "M", "L", "XL", "2XL"];

export type CostCalcMethod = "Core size average" | "Representative size" | "Full average";

export interface CostEstimate {
  estimatedCost: number | null;
  method: CostCalcMethod | null;
  /** variants averaged; 1 for a representative size */
  variantCount: number | null;
  /** set when there's no number: why not, in the words the card shows */
  reason: string | null;
  /** wall_art with no anchor chosen — the card renders the picker */
  needsRepresentative: boolean;
}

export interface CostVariant {
  id: string;
  size: string | null;
  baseCost: number | null;
}

/** "xxl" / " 2xl " / "2XL" all land on the same bucket. */
export function normalizeSize(size: string): string {
  const s = size.trim().toUpperCase().replace(/\s+/g, "");
  const xs = /^(X+)L$/.exec(s); // XL, XXL, XXXL…
  if (xs) return xs[1].length === 1 ? "XL" : `${xs[1].length}XL`;
  return s;
}

const NO_ESTIMATE = {
  estimatedCost: null as null,
  method: null as null,
  variantCount: null as null,
  needsRepresentative: false,
};

export function estimateCost(
  variants: CostVariant[],
  category: Category | null,
  representativeVariantId: string | null
): CostEstimate {
  if (!category) {
    return { ...NO_ESTIMATE, reason: "Set category to estimate cost." };
  }

  const priced = variants.filter((v): v is CostVariant & { baseCost: number } => v.baseCost != null);

  if (category === "wall_art") {
    if (!representativeVariantId) {
      return {
        ...NO_ESTIMATE,
        needsRepresentative: true,
        reason: "Pick the representative size — its cost becomes the estimate.",
      };
    }
    const rep = variants.find((v) => v.id === representativeVariantId);
    if (!rep) {
      return {
        ...NO_ESTIMATE,
        needsRepresentative: true,
        reason: "The representative size no longer exists on this product — pick again.",
      };
    }
    if (rep.baseCost == null) {
      return { ...NO_ESTIMATE, reason: "No cost on the representative size yet — pull costs first." };
    }
    return {
      estimatedCost: rep.baseCost,
      method: "Representative size",
      variantCount: 1,
      reason: null,
      needsRepresentative: false,
    };
  }

  if (category === "apparel") {
    const core = priced.filter((v) => v.size && CORE_SIZES.includes(normalizeSize(v.size)));
    // Apparel with no recognisable core sizes (one-size, odd labels) still
    // deserves a number — recorded honestly as a full average, never passed
    // off as a core-size one.
    if (core.length > 0) return average(core, "Core size average");
    return average(priced, "Full average");
  }

  // home / misc — no strong size spread
  return average(priced, "Full average");
}

function average(variants: Array<{ baseCost: number }>, method: CostCalcMethod): CostEstimate {
  if (variants.length === 0) {
    return {
      ...NO_ESTIMATE,
      // Printify's public catalog carries no costs — they're account-scoped,
      // which is what the probe exists to read.
      reason: "No variant costs yet — pull costs from Printify.",
    };
  }
  const total = variants.reduce((sum, v) => sum + v.baseCost, 0);
  return {
    estimatedCost: total / variants.length,
    method,
    variantCount: variants.length,
    reason: null,
    needsRepresentative: false,
  };
}
