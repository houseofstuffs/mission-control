import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import { slotsForListing } from "@/server/imageSlots";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Bulk reorder from a drag-drop: the client sends the slots in their new
 * display order and positions renumber 1..N. A dropped slot can cross
 * buckets, so one optional bucket change rides along. Only rows whose
 * position (or bucket) actually changed are written — a 20-slot plan
 * where one slot moved is 1-2 writes, not 20.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found — refresh first." }, { status: 404 });
    }
    const body = await req.json();
    const orderedIds: string[] = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [];
    const bucketChange = body.bucketChange as { slotId?: string; bucket?: string } | undefined;

    const slots = slotsForListing(id);
    const byId = new Map(slots.map((s) => [s.id, s]));
    if (orderedIds.length !== slots.length || orderedIds.some((sid) => !byId.has(sid))) {
      // name the diff — "doesn't match" cost three debugging rounds when
      // the real story was one stray slot the client never sent
      const sent = new Set(orderedIds);
      const missing = slots.filter((s) => !sent.has(s.id)).map((s) => `"${s.title || s.id}"`);
      const unknown = orderedIds.filter((sid) => !byId.has(sid));
      const parts = [
        `client sent ${orderedIds.length} slots, the listing has ${slots.length}`,
        ...(missing.length ? [`missing: ${missing.join(", ")}`] : []),
        ...(unknown.length ? [`${unknown.length} sent id(s) aren't this listing's`] : []),
      ];
      return NextResponse.json(
        { error: `The order list doesn't match this listing's slots (${parts.join("; ")}) — refresh and retry.` },
        { status: 409 }
      );
    }

    let writes = 0;
    for (let i = 0; i < orderedIds.length; i++) {
      const slot = byId.get(orderedIds[i])!;
      const values: Record<string, SimpleValue> = {};
      if ((Number(slot.props["Position"]) || 0) !== i + 1) values["Position"] = i + 1;
      if (bucketChange?.slotId === slot.id && bucketChange.bucket && String(slot.props["Bucket"] ?? "") !== bucketChange.bucket) {
        values["Bucket"] = bucketChange.bucket;
      }
      if (Object.keys(values).length > 0) {
        await updateRecord("image_slots", slot.id, values);
        writes++;
      }
    }
    return NextResponse.json({ ok: true, writes });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
