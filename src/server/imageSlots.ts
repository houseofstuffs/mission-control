/**
 * Image-slot seeding and reads. Slots are Notion pages (system of record)
 * related to their listing and, once chosen, a mockup template.
 */
import { cachedRecords, createRecord } from "@/server/notion/store";
import { SINGLE_SEED, MULTI_SEED, type SeedSlot } from "@/config/images";
import type { SimpleRecord } from "@/server/notion/props";

export function slotsForListing(listingId: string): SimpleRecord[] {
  return cachedRecords("image_slots")
    .filter((s) => ((s.props["Listing"] as string[] | null) ?? []).includes(listingId))
    .sort((a, b) => (Number(a.props["Position"]) || 0) - (Number(b.props["Position"]) || 0));
}

/** Seed the default allocation. Advisory, not locked — every slot editable. */
export async function seedSlots(listingId: string, multiVariant: boolean): Promise<number> {
  const seed: SeedSlot[] = multiVariant ? MULTI_SEED : SINGLE_SEED;
  for (const s of seed) {
    await createRecord("image_slots", {
      Name: s.label,
      Listing: [listingId],
      Position: s.position,
      Bucket: s.bucket,
      "Shot Type": s.shotType,
      Status: "Planned",
    });
  }
  return seed.length;
}

/** A slot counts as filled when its image exists: status Made or Placed. */
export function isFilled(slot: SimpleRecord): boolean {
  const st = String(slot.props["Status"] ?? "");
  return st === "Made" || st === "Placed";
}
