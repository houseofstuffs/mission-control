/**
 * Compute a product's cost estimate from cached data and WRITE it to Notion —
 * the estimate is a stored, reviewable fact (Estimated Cost / method / count),
 * not a render-time computation. Recomputed whenever an input moves: seed,
 * category change, representative-variant change, cost pull.
 */
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";
import { estimateCost, type CostEstimate } from "@/server/cost-estimate";
import { asCategory } from "@/config/product-categories";
import type { SimpleRecord } from "@/server/notion/props";

/** Probe costs live as JSON on the product; a hand-set Base Cost on the
 *  variant record always wins over the probe's number. */
export function variantCostsFor(product: SimpleRecord): Map<string, number> {
  const out = new Map<string, number>();
  const raw = product.props["Variant Costs (JSON)"];
  if (typeof raw === "string" && raw.trim()) {
    try {
      for (const [variantId, cost] of Object.entries(JSON.parse(raw) as Record<string, number>)) {
        if (typeof cost === "number") out.set(variantId, cost);
      }
    } catch {
      /* unparseable = no probe costs */
    }
  }
  return out;
}

export function costInputsFor(product: SimpleRecord) {
  const probed = variantCostsFor(product);
  return cachedRecords("product_variants")
    .filter((v) => ((v.props["Product"] as string[] | null) ?? []).includes(product.id))
    .map((v) => {
      const hand = v.props["Base Cost"];
      const probedCost = probed.get(String(v.props["Printify Variant ID"] ?? ""));
      return {
        id: v.id,
        size: String(v.props["Size"] ?? "") || null,
        baseCost: typeof hand === "number" ? hand : (probedCost ?? null),
      };
    });
}

export function estimateFor(product: SimpleRecord): CostEstimate {
  return estimateCost(
    costInputsFor(product),
    asCategory(String(product.props["Category"] ?? "")),
    ((product.props["Representative Variant"] as string[] | null) ?? [])[0] ?? null
  );
}

/** Recompute and persist. Returns the estimate it stored. */
export async function computeAndStoreCost(productId: string): Promise<CostEstimate> {
  const product = cachedRecord(productId);
  if (!product || product.dbKey !== "products") {
    throw new Error("Product not found in cache — refresh first.");
  }
  const est = estimateFor(product);
  await updateRecord("products", productId, {
    "Estimated Cost": est.estimatedCost != null ? Math.round(est.estimatedCost * 100) / 100 : null,
    "Estimated Cost Variant Count": est.variantCount,
    "Cost Calc Method": est.method,
  });
  return est;
}
