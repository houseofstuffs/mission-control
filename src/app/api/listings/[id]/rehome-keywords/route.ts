import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** per call — ~1000 mis-attached rows need chunking, the client loops */
const CHUNK = 100;

/**
 * Cleanup for over-attached listings: earlier imports attached every CSV
 * row to the listing. Attachment should mean the operator's hand-picked
 * shortlist, so this MOVES every attached keyword that isn't in the
 * listing's Tags over to the Design pool — still recommendable, no longer
 * cluttering the record. Nothing is deleted from the bank.
 *
 * Processes up to CHUNK per call and reports what's left; the client
 * keeps calling until remaining is 0.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found in cache — refresh first" }, { status: 404 });
    }
    const designId = ((listing.props["Designs"] as string[] | null) ?? [])[0] ?? null;
    const keepNames = new Set(
      String(listing.props["Tags"] ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    );

    const targets = cachedRecords("keywords").filter(
      (k) =>
        ((k.props["Etsy Listings"] as string[] | null) ?? []).includes(id) &&
        !keepNames.has(k.title.trim().toLowerCase())
    );

    const batch = targets.slice(0, CHUNK);
    for (const k of batch) {
      const values: Record<string, SimpleValue> = {
        "Etsy Listings": (((k.props["Etsy Listings"] as string[] | null) ?? [])).filter((x) => x !== id),
      };
      if (designId) {
        const designs = (k.props["Designs"] as string[] | null) ?? [];
        if (!designs.includes(designId)) values["Designs"] = [...designs, designId];
      }
      await updateRecord("keywords", k.id, values);
    }

    return NextResponse.json({
      moved: batch.length,
      remaining: targets.length - batch.length,
      kept: keepNames.size,
      toDesign: Boolean(designId),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
