/**
 * Shipping-cost pull — Printify's catalog carries this per blueprint ×
 * print provider, no connected shop needed (unlike the cost probe). US
 * domestic, first item in the order: the same US/USD-only assumption
 * fees.ts already makes explicit.
 */
import { getShipping } from "./client";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";

export interface ShippingPullResult {
  productName: string;
  cost: number;
  countries: string[];
}

export async function pullShipping(productId: string): Promise<ShippingPullResult> {
  const product = cachedRecord(productId);
  if (!product || product.dbKey !== "products") {
    throw new Error("Product not found in cache — refresh first.");
  }
  const blueprintId = Number(product.props["Printify Blueprint ID"]);
  const providerId = Number(product.props["Printify Print Provider ID"]);
  if (!blueprintId || !providerId) {
    throw new Error("This product has no blueprint/provider IDs — reseed it first.");
  }

  const variantIds = new Set(
    cachedRecords("product_variants")
      .filter((v) => ((v.props["Product"] as string[] | null) ?? []).includes(productId))
      .map((v) => Number(v.props["Printify Variant ID"]))
  );

  const info = await getShipping(blueprintId, providerId);
  // Prefer the US profile that actually covers this product's own variants
  // (some providers split cost by size); fall back to any US profile, then
  // whatever covers the rest of the world — never fail silently to $0.
  const profile =
    info.profiles.find((p) => p.countries.includes("US") && p.variant_ids.some((id) => variantIds.has(id))) ??
    info.profiles.find((p) => p.countries.includes("US")) ??
    info.profiles.find((p) => p.countries.includes("REST_OF_THE_WORLD"));

  if (!profile) {
    throw new Error("Printify returned no shipping profile for this blueprint/provider.");
  }

  const cost = profile.first_item.cost / 100;
  await updateRecord("products", productId, {
    "Estimated Shipping Cost": cost,
    "Shipping Cost Source": "Printify catalog",
    "Shipping Pulled At": new Date().toISOString().slice(0, 10),
  });

  return { productName: product.title, cost, countries: profile.countries };
}
