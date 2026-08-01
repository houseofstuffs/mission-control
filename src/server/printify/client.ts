/**
 * Printify catalog client — server-side only; the token never reaches the
 * browser. Phase 1 uses only the public catalog endpoints (blueprints,
 * print providers, variants). Printify OWNS listing creation (spec §2.3);
 * this app never creates Printify products — it reads reference data.
 */

const BASE = "https://api.printify.com/v1";

function headers(): HeadersInit {
  const token = process.env.PRINTIFY_API_TOKEN;
  if (!token) {
    throw new Error("PRINTIFY_API_TOKEN is not set. Copy .env.example to .env.local and fill it in.");
  }
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function printifyConfigured(): boolean {
  return Boolean(process.env.PRINTIFY_API_TOKEN);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Printify ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/* ---------- catalog types (fields we use) ---------- */

export interface Blueprint {
  id: number;
  title: string;
  brand: string;
  model: string;
  images: string[];
  /** Printify's vendor copy — HTML; present on the single-blueprint endpoint */
  description?: string;
}

export interface PrintProvider {
  id: number;
  title: string;
}

export interface VariantPlaceholder {
  position: string; // "front", "back", ...
  width: number; // px at print resolution
  height: number;
}

export interface CatalogVariant {
  id: number;
  title: string;
  options: { color?: string; size?: string; [k: string]: string | undefined };
  placeholders: VariantPlaceholder[];
}

export async function listBlueprints(): Promise<Blueprint[]> {
  return get<Blueprint[]>("/catalog/blueprints.json");
}

export async function getBlueprint(id: number): Promise<Blueprint> {
  return get<Blueprint>(`/catalog/blueprints/${id}.json`);
}

export async function listProviders(blueprintId: number): Promise<PrintProvider[]> {
  return get<PrintProvider[]>(`/catalog/blueprints/${blueprintId}/print_providers.json`);
}

export async function listVariants(
  blueprintId: number,
  providerId: number
): Promise<CatalogVariant[]> {
  const res = await get<{ variants: CatalogVariant[] }>(
    `/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json?show-out-of-stock=1`
  );
  return res.variants ?? [];
}

/**
 * Variant base costs live on the shipping/variant pricing endpoint per shop
 * in some Printify plans; the public catalog variant payload carries `cost`
 * only when a shop context exists. We read `cost` when present and fall back
 * to null — costs can be filled after connecting the shop.
 */
export interface VariantWithCost extends CatalogVariant {
  cost?: number; // cents
}

/**
 * Shipping rates for every variant of a blueprint × print provider pair —
 * a catalog endpoint like blueprints/variants, so no connected shop needed.
 * `first_item` is what one unit costs to ship; `additional_items` is the
 * marginal cost of each further unit in the same order.
 */
export interface ShippingProfile {
  variant_ids: number[];
  first_item: { cost: number; currency: string }; // cents
  additional_items: { cost: number; currency: string }; // cents
  countries: string[]; // ISO codes, plus "REST_OF_THE_WORLD"
}

export interface ShippingInfo {
  handling_time: { value: number; unit: string };
  profiles: ShippingProfile[];
}

export async function getShipping(blueprintId: number, providerId: number): Promise<ShippingInfo> {
  return get<ShippingInfo>(`/catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping.json`);
}

/* ---------- shop-scoped calls (the cost probe) ---------- */

async function send<T>(method: "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Printify ${res.status} on ${method} ${path}: ${text.slice(0, 300)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function listShops(): Promise<Array<{ id: number; title: string }>> {
  return get<Array<{ id: number; title: string }>>("/shops.json");
}

export async function uploadImageBase64(fileName: string, base64: string): Promise<{ id: string }> {
  return send<{ id: string }>("POST", "/uploads/images.json", {
    file_name: fileName,
    contents: base64,
  });
}

export interface ShopProductVariantCost {
  id: number;
  cost: number; // cents, account-priced — this is where plan discounts land
}

export async function createShopProduct(
  shopId: number,
  payload: unknown
): Promise<{ id: string; variants: ShopProductVariantCost[] }> {
  return send<{ id: string; variants: ShopProductVariantCost[] }>(
    "POST",
    `/shops/${shopId}/products.json`,
    payload
  );
}

export async function deleteShopProduct(shopId: number, productId: string): Promise<void> {
  await send<unknown>("DELETE", `/shops/${shopId}/products/${productId}.json`);
}

/* ---------- reading REAL shop products (the ones made in Printify's UI) ---------- */

export interface ShopProduct {
  id: string;
  title: string;
  blueprint_id: number;
  print_provider_id: number;
  variants: Array<{ id: number; is_enabled: boolean }>;
}

export async function listShopProducts(shopId: number, page = 1): Promise<ShopProduct[]> {
  const res = await get<{ data?: ShopProduct[] }>(
    `/shops/${shopId}/products.json?limit=50&page=${page}`
  );
  return res.data ?? [];
}

export async function getShopProduct(shopId: number, productId: string): Promise<ShopProduct> {
  return get<ShopProduct>(`/shops/${shopId}/products/${productId}.json`);
}
