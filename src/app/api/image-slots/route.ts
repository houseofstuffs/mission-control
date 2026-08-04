import { NextResponse } from "next/server";
import { cachedRecord, createRecord } from "@/server/notion/store";
import { seedSlots, slotsForListing, compatForListing } from "@/server/imageSlots";
import { MAX_IMAGES } from "@/config/images";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seeding writes 17 throttled pages

/**
 * Seed a listing's slot plan, or add one slot. Seeding only fires on an
 * empty plan — it never overwrites hand-arranged slots.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const listing = cachedRecord(String(body.listingId ?? ""));
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found in cache — refresh first" }, { status: 404 });
    }
    const existing = slotsForListing(listing.id);

    if (body.seed) {
      if (existing.length > 0) {
        return NextResponse.json({ error: "This listing already has slots — seeding never overwrites." }, { status: 400 });
      }
      const productId = ((listing.props["Product"] as string[] | null) ?? [])[0];
      const product = productId ? cachedRecord(productId) : null;
      const count = await seedSlots(
        listing.id,
        Boolean(listing.props["Is Multi Variant"]),
        compatForListing(listing),
        product
      );
      return NextResponse.json({ seeded: count });
    }

    // add a single slot at the next free position
    if (existing.length >= MAX_IMAGES) {
      return NextResponse.json({ error: `Etsy's cap is ${MAX_IMAGES} images.` }, { status: 400 });
    }
    const position =
      Number(body.position) ||
      Math.max(0, ...existing.map((s) => Number(s.props["Position"]) || 0)) + 1;
    const record = await createRecord("image_slots", {
      Name: String(body.label ?? "new slot"),
      Listing: [listing.id],
      Position: Math.min(position, MAX_IMAGES),
      Bucket: body.bucket ? String(body.bucket) : "Sell Design",
      ...(body.productLinkRole ? { "Product Link Role": String(body.productLinkRole) } : {}),
      ...(body.shotType ? { "Shot Type": String(body.shotType) } : {}),
      "Shot Type": body.shotType ? String(body.shotType) : null,
      Status: "Planned",
    });
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
