/**
 * Image-slot seeding and reads. Slots are Notion pages (system of record)
 * related to their listing and, once chosen, a mockup template.
 */
import { cachedRecords, createRecord, updateRecord } from "@/server/notion/store";
import { SINGLE_SEED, MULTI_SEED, type SeedSlot, type ProductLinkRole } from "@/config/images";
import { COLORWAY_SLOTS, type GarmentCompatibility } from "@/config/design-prompt";
import type { SimpleRecord, SimpleValue } from "@/server/notion/props";

/** Product Link Role → the Notion field on Products carrying that reusable graphic. */
const PRODUCT_LINK_FIELD: Record<ProductLinkRole, string> = {
  "Highlights & Sizing": "Highlights & Sizing Graphic Link",
  "Care & Policies": "Care & Policies Graphic Link",
  Colorways: "Colorways Graphic Link",
};

export function slotsForListing(listingId: string): SimpleRecord[] {
  return cachedRecords("image_slots")
    .filter((s) => ((s.props["Listing"] as string[] | null) ?? []).includes(listingId))
    .sort((a, b) => (Number(a.props["Position"]) || 0) - (Number(b.props["Position"]) || 0));
}

/**
 * The tightest garment compatibility across a listing's designs.
 *
 * Any design not yet judged makes the whole listing Unset — one unexamined
 * design is enough to make the colourway plan a guess. Designs that disagree
 * (one dark-only, one light-only) are Unset too: no colourway suits both, and
 * that's a call for a person, not a default.
 */
export function compatForListing(listing: SimpleRecord): GarmentCompatibility {
  const ids = (listing.props["Designs"] as string[] | null) ?? [];
  if (ids.length === 0) return "Unset";
  const designs = cachedRecords("designs").filter((d) => ids.includes(d.id));
  if (designs.length === 0) return "Unset";
  const set = new Set(designs.map((d) => String(d.props["Garment Compatibility"] ?? "") || "Unset"));
  if (set.has("Unset")) return "Unset";
  if (set.has("Dark only") && set.has("Light only")) return "Unset";
  if (set.has("Dark only")) return "Dark only";
  if (set.has("Light only")) return "Light only";
  return "Any";
}

/**
 * Seed the default allocation. Advisory, not locked — every slot editable.
 *
 * Colourway slots are the one part that isn't fixed: a design that only works
 * on dark garments has fewer colourways worth showing, so it gets fewer slots.
 * The freed slots are left EMPTY — never backfilled with another role. Fewer,
 * honest slots beat a padded plan.
 */
export async function seedSlots(
  listingId: string,
  multiVariant: boolean,
  compat: GarmentCompatibility = "Unset",
  /** when known at creation time, auto-fills the three Product-linked slots immediately */
  product?: SimpleRecord | null
): Promise<number> {
  const base: SeedSlot[] = multiVariant ? MULTI_SEED : SINGLE_SEED;
  const allowed = COLORWAY_SLOTS[compat] ?? COLORWAY_SLOTS.Any;
  const family = compat === "Dark only" ? "dark" : compat === "Light only" ? "light" : null;

  let colorwaysKept = 0;
  const seed: SeedSlot[] = [];
  for (const s of base) {
    if (s.label.startsWith("colorway")) {
      if (colorwaysKept >= allowed) continue; // freed — stays empty
      colorwaysKept++;
      seed.push({ ...s, label: family ? `colorway — ${family}` : s.label });
    } else {
      seed.push(s);
    }
  }

  // positions stay contiguous after dropping colourways — a plan with holes
  // in it reads like something went wrong
  let position = 0;
  for (const s of seed) {
    position++;
    const values: Record<string, SimpleValue> = {
      Name: s.label,
      Listing: [listingId],
      Position: position,
      Bucket: s.bucket,
      "Shot Type": s.shotType,
      Status: "Planned",
    };
    if (s.productLink) {
      values["Product Link Role"] = s.productLink;
      const link = product ? String(product.props[PRODUCT_LINK_FIELD[s.productLink]] ?? "").trim() : "";
      if (link) {
        values["Asset Ref"] = link;
        values["Status"] = "Placed";
      }
    }
    await createRecord("image_slots", values);
  }
  return seed.length;
}

/**
 * Re-pulls the three Product-linked slots from the listing's current
 * Product — for when a graphic link gets added or changed after the
 * listing (and its slots) already exist. Never touches a slot whose
 * Product Link Role is blank, and never blanks a slot back out if the
 * Product's field is empty (a manually-placed asset stays put).
 */
export async function refreshFromProduct(listingId: string): Promise<number> {
  const listing = cachedRecords("etsy_listings").find((l) => l.id === listingId);
  const productId = ((listing?.props["Product"] as string[] | null) ?? [])[0];
  const product = productId ? cachedRecords("products").find((p) => p.id === productId) : null;
  if (!product) return 0;

  const slots = slotsForListing(listingId).filter((s) => {
    const role = String(s.props["Product Link Role"] ?? "");
    return role in PRODUCT_LINK_FIELD;
  });

  let updated = 0;
  for (const slot of slots) {
    const role = String(slot.props["Product Link Role"]) as ProductLinkRole;
    const link = String(product.props[PRODUCT_LINK_FIELD[role]] ?? "").trim();
    if (!link) continue; // nothing to pull yet — leave whatever's there
    await updateRecord("image_slots", slot.id, { "Asset Ref": link, Status: "Placed" });
    updated++;
  }
  return updated;
}

/** A slot counts as filled when its image exists: status Made or Placed. */
export function isFilled(slot: SimpleRecord): boolean {
  const st = String(slot.props["Status"] ?? "");
  return st === "Made" || st === "Placed";
}
