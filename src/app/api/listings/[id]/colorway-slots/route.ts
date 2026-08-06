import { NextResponse } from "next/server";
import { cachedRecord } from "@/server/notion/store";
import { refreshColorwaySlots } from "@/server/imageSlots";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Re-derives the colorway slots from the listing's CURRENT mockup colours
 * — one colour-carrying slot each, legacy colour-less ones repurposed
 * first, filled ones never touched. Safe to run whenever L1's colours
 * change; the report says exactly what moved.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found — refresh first." }, { status: 404 });
    }
    const result = await refreshColorwaySlots(id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
