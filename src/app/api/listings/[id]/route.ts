import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/** Listing field edits from the dashboard — currently the L2 tag composer. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found in cache — refresh first" }, { status: 404 });
    }

    const values: Record<string, SimpleValue> = {};
    if (body.tags != null) values["Tags"] = String(body.tags);
    if (body.title != null) values["Title"] = String(body.title);
    if (body.isMultiVariant != null) values["Is Multi Variant"] = Boolean(body.isMultiVariant);
    // the colourways this listing sells — template offers filter against it
    if (body.colorways !== undefined) {
      const list = Array.isArray(body.colorways)
        ? body.colorways.map((c: unknown) => String(c).trim()).filter(Boolean)
        : [];
      values["Colorways (JSON)"] = JSON.stringify(list);
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("etsy_listings", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
