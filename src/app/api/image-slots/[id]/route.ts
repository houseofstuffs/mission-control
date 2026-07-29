import { NextResponse } from "next/server";
import { cachedRecord, updateRecord, archiveRecord } from "@/server/notion/store";
import { slotsForListing } from "@/server/imageSlots";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/**
 * Slot edits. Choosing a mockup template auto-fills Shot Type from the
 * template (a shot type set before the template was the PLAN; the explicit
 * shotType field in the same request wins as the override).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const slot = cachedRecord(id);
    if (!slot || slot.dbKey !== "image_slots") {
      return NextResponse.json({ error: "Slot not found in cache — refresh first" }, { status: 404 });
    }

    const values: Record<string, SimpleValue> = {};
    if (body.label != null) values["Name"] = String(body.label);
    if (body.bucket != null) values["Bucket"] = String(body.bucket);
    if (body.shotType !== undefined) values["Shot Type"] = body.shotType ? String(body.shotType) : null;
    if (body.status != null) values["Status"] = String(body.status);
    if (body.assetRef !== undefined) values["Asset Ref"] = body.assetRef ? String(body.assetRef) : null;
    if (body.notes != null) values["Notes"] = String(body.notes);

    if (body.mockupTemplateId !== undefined) {
      values["Mockup Template"] = body.mockupTemplateId ? [String(body.mockupTemplateId)] : [];
      // auto-fill shot type from the template unless the caller overrode it
      if (body.mockupTemplateId && body.shotType === undefined) {
        const tpl = cachedRecord(String(body.mockupTemplateId));
        const tplShot = tpl?.props["Shot Type"];
        if (typeof tplShot === "string" && tplShot) values["Shot Type"] = tplShot;
      }
    }

    // reorder: swap positions with the neighbor in that direction
    if (body.move === "up" || body.move === "down") {
      const listingId = ((slot.props["Listing"] as string[] | null) ?? [])[0];
      const siblings = listingId ? slotsForListing(listingId) : [];
      const idx = siblings.findIndex((s) => s.id === slot.id);
      const other = body.move === "up" ? siblings[idx - 1] : siblings[idx + 1];
      if (other) {
        const myPos = Number(slot.props["Position"]) || 0;
        const otherPos = Number(other.props["Position"]) || 0;
        await updateRecord("image_slots", other.id, { Position: myPos });
        values["Position"] = otherPos;
      }
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("image_slots", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const slot = cachedRecord(id);
    if (!slot || slot.dbKey !== "image_slots") {
      return NextResponse.json({ error: "Slot not found in cache — refresh first" }, { status: 404 });
    }
    await archiveRecord("image_slots", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
