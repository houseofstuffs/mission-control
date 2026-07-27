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
