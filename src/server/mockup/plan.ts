/**
 * The listing's mockup plan — ONE derivation, two consumers. The L4 panel
 * renders this plan and the generate job executes it; computing it twice
 * was how "the grid shows 6 but the job made 5" would eventually happen.
 *
 * A tile is variant × listing (a variant already IS one colour):
 *   colours   = (Mockup Colors, else Colorways) ∩ Available product variants
 *   variants  = colour ∈ colours
 *               ∧ (shortlist empty ∨ shot ∈ shortlist ∨ shot-less)
 * One variant per colour is guaranteed upstream by the import's duplicate
 * guard; pre-guard doubles would render twice, which the dedupe cleanup
 * resolves — this module doesn't silently drop them.
 */
import { cachedRecord, cachedRecords } from "@/server/notion/store";
import type { SimpleRecord } from "@/server/notion/props";

export interface PlanTile {
  variantId: string;
  variantName: string;
  shotType: string;
  colour: string;
}

export interface MockupPlan {
  /** the listing colours mockups are generated for (display-cased) */
  colours: string[];
  tiles: PlanTile[];
}

const norm = (c: string) => c.trim().toLowerCase();

function jsonList(v: unknown): string[] {
  try {
    const parsed = JSON.parse(String(v ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function listingMockupPlan(rec: SimpleRecord): MockupPlan {
  const productId = ((rec.props["Product"] as string[] | null) ?? [])[0];

  const sold = jsonList(rec.props["Colorways (JSON)"]);
  const mockupColors = jsonList(rec.props["Mockup Colors (JSON)"]);
  const wanted = mockupColors.length > 0 ? mockupColors : sold;

  const availableVariantColours = new Set(
    (productId ? cachedRecords("product_variants") : [])
      .filter((v) => ((v.props["Product"] as string[] | null) ?? []).includes(productId ?? "") && v.props["Available"])
      .map((v) => norm(String(v.props["Color"] ?? "")))
      .filter(Boolean)
  );
  const colours = wanted.filter((c) => availableVariantColours.has(norm(c)));
  const colourSet = new Set(colours.map(norm));

  const shortlist = new Set((rec.props["Template Shortlist"] as string[] | null) ?? []);

  const tiles: PlanTile[] = [];
  for (const t of cachedRecords("mockup_templates")) {
    const shotId = ((t.props["Shot"] as string[] | null) ?? [])[0] ?? null;
    if (shortlist.size > 0 && shotId !== null && !shortlist.has(shotId)) continue;
    const own = String(t.props["Garment Color"] ?? "").trim();
    // a colour-tagged variant IS one colour; a neutral one (hand intake)
    // composites onto every listing colour
    const tileColours = own ? (colourSet.has(norm(own)) ? [own] : []) : colours;
    for (const colour of tileColours) {
      tiles.push({
        variantId: t.id,
        variantName: t.title || "Untitled variant",
        shotType: String(t.props["Shot Type"] ?? ""),
        colour,
      });
    }
  }
  return { colours, tiles };
}

/** The generated record for one tile, if a render ever happened. */
export function generatedFor(listingId: string, variantId: string): SimpleRecord | null {
  return (
    cachedRecords("generated_mockups").find(
      (g) =>
        ((g.props["Listing"] as string[] | null) ?? []).includes(listingId) &&
        ((g.props["Variant"] as string[] | null) ?? []).includes(variantId) &&
        Array.isArray(g.props["Image"]) &&
        (g.props["Image"] as unknown[]).length > 0
    ) ?? null
  );
}

/**
 * Per-colour design overrides — normalized colour → master link. Colours
 * absent from the map use the design's Master PNG Link. Printify prints
 * per-variant art within one listing, so this is a correctness feature,
 * not a convenience: a dark-colour override makes that colour's mockups
 * match what the buyer actually receives.
 */
export function perColourArt(rec: SimpleRecord): Record<string, string> {
  try {
    const parsed = JSON.parse(String(rec.props["Per-Colour Art (JSON)"] ?? "{}"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [colour, link] of Object.entries(parsed)) {
      if (typeof link === "string" && link.trim()) out[norm(colour)] = link.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** The design master PNG's source link for a listing, plus its design id. */
export function masterPngLink(rec: SimpleRecord): { link: string; designId: string } | null {
  const designId = ((rec.props["Designs"] as string[] | null) ?? [])[0];
  const design = designId ? cachedRecord(designId) : null;
  const link = String(design?.props["Master PNG Link"] ?? "").trim();
  return link && designId ? { link, designId } : null;
}
