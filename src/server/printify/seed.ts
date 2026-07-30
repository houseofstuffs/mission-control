/**
 * Printify product seed — Phase 1 item 5.
 *
 * Creates (or updates) one Product record + its Variant records in Notion
 * from a blueprint × print-provider pair, then mirrors into the cache.
 * Products are keyed blueprint × provider, never product type (spec §3.3).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getBlueprint, listVariants, type VariantWithCost } from "./client";
import { computeMasterCanvas } from "./canvas";
import { cachedRecords, createRecord, updateRecord } from "@/server/notion/store";
import { categoryFromTitle } from "@/config/product-categories";
import type { SimpleValue } from "@/server/notion/props";

export interface SeedResult {
  productPageId: string;
  productName: string;
  variantCount: number;
  updated: boolean;
}

export async function seedProduct(
  blueprintId: number,
  providerId: number,
  providerName: string
): Promise<SeedResult> {
  const blueprint = await getBlueprint(blueprintId);
  const variants = (await listVariants(blueprintId, providerId)) as VariantWithCost[];
  if (variants.length === 0) {
    throw new Error("Printify returned no variants for this blueprint/provider pair.");
  }

  const canvas = computeMasterCanvas(variants);
  const costs = variants.map((v) => (typeof v.cost === "number" ? v.cost / 100 : null)).filter(
    (c): c is number => c != null
  );

  const name = `${blueprint.title} — ${providerName}`;
  // Auto-map the category from the blueprint title. A miss leaves it unset and
  // the card asks for it — never a guess, because the category decides how
  // cost is averaged.
  const category = categoryFromTitle(blueprint.title);
  const values: Record<string, SimpleValue> = {
    Name: name,
    "Printify Blueprint ID": blueprintId,
    "Printify Print Provider ID": providerId,
    "Blueprint Title": blueprint.title,
    "Blueprint Brand": blueprint.brand ?? "",
    "Blueprint Model": blueprint.model ?? "",
    "Print Provider Name": providerName,
    "Physical/Digital": "Physical",
    "Print Areas (JSON)": JSON.stringify(canvas.areas),
    "Max Print Width px": canvas.maxWidth,
    "Max Print Height px": canvas.maxHeight,
    "Aspect Ratios": canvas.areas.map((a) => `${a.position}: ${a.ratioLabel}`).join(" · "),
    "Recomposition Flag": canvas.recompositionFlag,
    Currency: "USD",
    "Variant Count": variants.length,
    Status: "Active",
    "Synced At": new Date().toISOString(),
  };
  // The public catalog has no base costs (they're shop-scoped). Only write
  // cost fields when Printify supplies them — never blank out values entered
  // by hand in Notion.
  if (costs.length > 0) {
    values["Base Cost Min"] = Math.min(...costs);
    values["Base Cost Max"] = Math.max(...costs);
  }

  // Upsert on blueprint × provider — reseeding refreshes specs, and NEVER
  // touches Vendor Text Raw / Shop Voice Text (the two copy fields, §3.3).
  const existing = cachedRecords("products").find(
    (p) =>
      p.props["Printify Blueprint ID"] === blueprintId &&
      p.props["Printify Print Provider ID"] === providerId
  );

  // Never overwrite a category that's already there — like the two copy
  // fields, a hand-set value outranks anything derived. Reseeding a product
  // categorised by hand leaves it alone; one that's still unset gets another
  // shot at the auto-map (the keyword list may have been tuned since).
  if (category && !existing?.props["Category"]) {
    values["Category"] = category;
  }

  let productPageId: string;
  if (existing) {
    await updateRecord("products", existing.id, values);
    productPageId = existing.id;
  } else {
    const created = await createRecord("products", values);
    productPageId = created.id;
  }

  // Variants: upsert by Printify Variant ID within this product.
  const existingVariants = cachedRecords("product_variants").filter((v) =>
    (v.props["Product"] as string[] | null)?.includes(productPageId)
  );
  const byVariantId = new Map(existingVariants.map((v) => [v.props["Printify Variant ID"], v]));

  for (const variant of variants) {
    const vValues: Record<string, SimpleValue> = {
      Name: variant.title,
      Product: [productPageId],
      "Printify Variant ID": variant.id,
      Color: variant.options?.color ?? null,
      Size: variant.options?.size ?? null,
      "Base Cost": typeof variant.cost === "number" ? variant.cost / 100 : null,
      Currency: "USD",
      Available: true,
      "Placeholders (JSON)": JSON.stringify(variant.placeholders ?? []),
    };
    const prior = byVariantId.get(variant.id);
    if (prior) {
      await updateRecord("product_variants", prior.id, vValues);
    } else {
      await createRecord("product_variants", vValues);
    }
  }

  return {
    productPageId,
    productName: name,
    variantCount: variants.length,
    updated: Boolean(existing),
  };
}
