import { NextResponse } from "next/server";
import { cachedRecord } from "@/server/notion/store";
import { refreshFromProduct } from "@/server/imageSlots";

export const dynamic = "force-dynamic";

/** Re-pulls the Product-linked slots (sizing/care/colorways) from the listing's current Product — for when a graphic link is added or changed after the listing already exists. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found in cache — refresh first" }, { status: 404 });
    }
    const updated = await refreshFromProduct(id);
    return NextResponse.json({ updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
