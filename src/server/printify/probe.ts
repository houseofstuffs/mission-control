/**
 * Cost probe — the only way to read REAL costs for this account.
 *
 * Printify's public catalog carries no costs; pricing is account-scoped,
 * and that's also exactly where plan discounts (Premium) are applied. So:
 * create a throwaway product in the shop, read the per-variant costs off
 * the response, delete it. The probe product never publishes anywhere —
 * Printify only pushes to a sales channel on an explicit publish call.
 *
 * Printify caps a product at 100 variants, so big catalogs probe in chunks
 * and the cost maps merge.
 */
import sharp from "sharp";
import {
  listShops,
  uploadImageBase64,
  createShopProduct,
  deleteShopProduct,
} from "./client";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";
import { getMeta, setMeta } from "@/server/cache/db";
import { computeAndStoreCost } from "@/server/productCost";
import type { CostEstimate } from "@/server/cost-estimate";

const CHUNK = 100; // Printify's variants-per-product cap
const PROBE_TITLE = "STUFFS cost probe — auto-deleted";

export async function printifyShopId(): Promise<number> {
  const cached = getMeta("printify_shop_id");
  if (cached) return Number(cached);
  const shops = await listShops();
  if (shops.length === 0) {
    throw new Error("No Printify shop on this account — connect one before pulling costs.");
  }
  setMeta("printify_shop_id", String(shops[0].id));
  return shops[0].id;
}

/** A plain white square, uploaded once ever, reused by every probe. */
async function probeImageId(): Promise<string> {
  const cached = getMeta("printify_probe_image_id");
  if (cached) return cached;
  const png = await sharp({
    create: { width: 1200, height: 1200, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const upload = await uploadImageBase64("stuffs-cost-probe.png", png.toString("base64"));
  setMeta("printify_probe_image_id", upload.id);
  return upload.id;
}

export interface PullResult {
  productName: string;
  variantsPriced: number;
  estimate: CostEstimate;
}

/** Probe one product's costs and store them on its record. */
export async function pullCosts(productId: string): Promise<PullResult> {
  const product = cachedRecord(productId);
  if (!product || product.dbKey !== "products") {
    throw new Error("Product not found in cache — refresh first.");
  }
  const blueprintId = Number(product.props["Printify Blueprint ID"]);
  const providerId = Number(product.props["Printify Print Provider ID"]);
  if (!blueprintId || !providerId) {
    throw new Error("This product has no blueprint/provider IDs — reseed it first.");
  }

  const variantIds = cachedRecords("product_variants")
    .filter((v) => ((v.props["Product"] as string[] | null) ?? []).includes(productId))
    .map((v) => Number(v.props["Printify Variant ID"]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (variantIds.length === 0) {
    throw new Error("No variants in the cache for this product — refresh first.");
  }

  // the print area position must be one the blueprint actually has
  let position = "front";
  try {
    const areas = JSON.parse(String(product.props["Print Areas (JSON)"] ?? "[]"));
    if (Array.isArray(areas) && areas[0]?.position) position = String(areas[0].position);
  } catch {
    /* front is the overwhelming default */
  }

  const shop = await printifyShopId();
  const image = await probeImageId();

  const costs: Record<string, number> = {}; // printify variant id → dollars
  for (let i = 0; i < variantIds.length; i += CHUNK) {
    const chunk = variantIds.slice(i, i + CHUNK);
    const created = await createShopProduct(shop, {
      title: PROBE_TITLE,
      description: "Temporary product used to read account-level costs. Safe to delete.",
      blueprint_id: blueprintId,
      print_provider_id: providerId,
      variants: chunk.map((id) => ({ id, price: 99900, is_enabled: true })),
      print_areas: [
        {
          variant_ids: chunk,
          placeholders: [
            { position, images: [{ id: image, x: 0.5, y: 0.5, scale: 1, angle: 0 }] },
          ],
        },
      ],
    });
    try {
      for (const v of created.variants ?? []) {
        if (typeof v.cost === "number") costs[String(v.id)] = v.cost / 100;
      }
    } finally {
      // never leave probe products behind — one retry, then surface it
      try {
        await deleteShopProduct(shop, created.id);
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
        await deleteShopProduct(shop, created.id);
      }
    }
  }

  const values = Object.values(costs);
  if (values.length === 0) {
    throw new Error("The probe product came back without costs — check the Printify account.");
  }

  await updateRecord("products", productId, {
    "Variant Costs (JSON)": JSON.stringify(costs),
    "Base Cost Min": Math.min(...values),
    "Base Cost Max": Math.max(...values),
    "Cost Source": "Probe",
    "Cost Pulled At": new Date().toISOString().slice(0, 10),
  });
  const estimate = await computeAndStoreCost(productId);

  return { productName: product.title, variantsPriced: values.length, estimate };
}
