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

/** the most colorway slots a seed will mint — past this, colours share */
export const MAX_COLORWAY_SLOTS = 6;

/** The listing's mockup colours — the SAME set the generate plan uses. */
export function listingColours(listing: SimpleRecord | undefined | null): string[] {
  const parse = (raw: unknown): string[] => {
    try {
      const p = JSON.parse(String(raw ?? "[]"));
      return Array.isArray(p) ? p.map(String).map((c) => c.trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  };
  const mockup = parse(listing?.props["Mockup Colors (JSON)"]);
  return mockup.length > 0 ? mockup : parse(listing?.props["Colorways (JSON)"]);
}

/**
 * Seed the default allocation. Advisory, not locked — every slot editable.
 *
 * Colourway slots are COLOUR-EXPLICIT when the listing already knows its
 * mockup colours: one slot per colour ("colorway — espresso"), each
 * carrying the colour so Send can match a render to ITS slot instead of
 * any generic one. Capped at MAX_COLORWAY_SLOTS. When no colours are known
 * yet, the old compatibility-based count stands in, and the refresh action
 * upgrades the plan once colours land at L1.
 */
export async function seedSlots(
  listingId: string,
  multiVariant: boolean,
  compat: GarmentCompatibility = "Unset",
  /** when known at creation time, auto-fills the three Product-linked slots immediately */
  product?: SimpleRecord | null
): Promise<number> {
  const base: SeedSlot[] = multiVariant ? MULTI_SEED : SINGLE_SEED;
  const listing = cachedRecords("etsy_listings").find((l) => l.id === listingId);
  const colours = listingColours(listing).slice(0, MAX_COLORWAY_SLOTS);
  const allowed = colours.length > 0 ? colours.length : (COLORWAY_SLOTS[compat] ?? COLORWAY_SLOTS.Any);
  const family = compat === "Dark only" ? "dark" : compat === "Light only" ? "light" : null;

  let colorwaysKept = 0;
  const seed: Array<SeedSlot & { colour?: string }> = [];
  for (const s of base) {
    // Exact label, and never a Product-linked slot. A prefix test here
    // ("colorway") also swallowed the "colorways" GRAPHIC CARD at the end
    // of the template: by the time the loop reached it the photo quota was
    // spent, so the one slot that pulls the Product's colorways graphic was
    // dropped from every listing.
    if (!s.productLink && s.label === "colorway") {
      if (colorwaysKept >= allowed) continue; // freed — stays empty
      const colour = colours[colorwaysKept];
      colorwaysKept++;
      seed.push(
        colour
          ? { ...s, label: `colorway — ${colour.toLowerCase()}`, colour }
          : { ...s, label: family ? `colorway — ${family}` : s.label }
      );
    } else {
      seed.push(s);
    }
  }
  // colours beyond the base plan's colorway block still get their slot,
  // up to the cap — appended right after the last colorway position
  while (colorwaysKept < colours.length) {
    const colour = colours[colorwaysKept];
    const lastIdx = seed.map((s) => s.label.startsWith("colorway")).lastIndexOf(true);
    seed.splice(lastIdx + 1, 0, {
      position: 0,
      label: `colorway — ${colour.toLowerCase()}`,
      bucket: "Sell Design",
      shotType: "Flat Lay",
      colour,
    });
    colorwaysKept++;
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
    if (s.colour) values["Colour"] = s.colour;
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
 * Brings the colorway slots in line with the listing's CURRENT mockup
 * colours — for colours added (or renamed) at L1 after the plan was
 * seeded. Empty legacy colorway slots ("colorway — dark", colour-less)
 * are repurposed first; missing colours append new slots after that.
 * A slot holding an asset is never renamed, never deleted — the operator
 * deletes what they don't need.
 */
export async function refreshColorwaySlots(listingId: string): Promise<{
  added: number;
  migrated: number;
  already: number;
  totalSlots: number;
  overCap: boolean;
}> {
  const listing = cachedRecords("etsy_listings").find((l) => l.id === listingId);
  const wanted = listingColours(listing).slice(0, MAX_COLORWAY_SLOTS);
  const norm = (c: string) => c.trim().toLowerCase();
  const slots = slotsForListing(listingId);

  const isColorway = (s: SimpleRecord) =>
    !String(s.props["Product Link Role"] ?? "").trim() &&
    (String(s.props["Colour"] ?? "").trim() !== "" || (s.title || "").toLowerCase().startsWith("colorway"));
  const colorways = slots.filter(isColorway);
  const have = new Set(colorways.map((s) => norm(String(s.props["Colour"] ?? ""))).filter(Boolean));

  const missing = wanted.filter((c) => !have.has(norm(c)));
  const already = wanted.length - missing.length;

  // repurpose the empty colour-less ones first — the legacy "colorway —
  // dark" pair becomes real colours instead of clutter
  const reusable = colorways.filter((s) => !String(s.props["Colour"] ?? "").trim() && !isFilled(s));
  let migrated = 0;
  let added = 0;
  let position = Math.max(0, ...slots.map((s) => Number(s.props["Position"]) || 0));
  const newIds: string[] = [];
  for (const colour of missing) {
    const reuse = reusable[migrated];
    if (reuse) {
      await updateRecord("image_slots", reuse.id, {
        Name: `colorway — ${colour.toLowerCase()}`,
        Colour: colour,
      });
      migrated++;
    } else {
      position++;
      const created = await createRecord("image_slots", {
        Name: `colorway — ${colour.toLowerCase()}`,
        Listing: [listingId],
        Position: position,
        Bucket: "Sell Design",
        "Shot Type": "Flat Lay",
        Status: "Planned",
        Colour: colour,
      });
      newIds.push(created.id);
      added++;
    }
  }

  // KEEP THE RUN CONTIGUOUS: colorway slots group at the first colorway's
  // position, in their existing relative order, everything else closing
  // around them — a new pepper at position 16 with its siblings at 3-4
  // splits the run across the colour grid. Reordering only writes the
  // positions that changed; assets and titles are untouched.
  const after = slotsForListing(listingId);
  const cw = after.filter((s) => isColorway(s) || newIds.includes(s.id));
  const firstIdx = after.findIndex((s) => cw.some((c) => c.id === s.id));
  if (firstIdx >= 0) {
    const rest = after.filter((s) => !cw.some((c) => c.id === s.id));
    const ordered = [...rest.slice(0, firstIdx), ...cw, ...rest.slice(firstIdx)];
    for (let i = 0; i < ordered.length; i++) {
      if ((Number(ordered[i].props["Position"]) || 0) !== i + 1) {
        await updateRecord("image_slots", ordered[i].id, { Position: i + 1 });
      }
    }
  }

  const totalSlots = slots.length + added;
  return { added, migrated, already, totalSlots, overCap: totalSlots > 20 };
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
