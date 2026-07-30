import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import { CATEGORIES } from "@/config/product-categories";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/**
 * Product edits from the dashboard. Category is the one field set here —
 * the auto-map covers most products at seed, and this is how the rest get
 * categorised (and how a bad auto-map gets corrected).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const product = cachedRecord(id);
    if (!product || product.dbKey !== "products") {
      return NextResponse.json({ error: "Product not found in cache — refresh first" }, { status: 404 });
    }

    const values: Record<string, SimpleValue> = {};

    if (body.category !== undefined) {
      const value = body.category ? String(body.category) : "";
      if (value && !CATEGORIES.includes(value as (typeof CATEGORIES)[number])) {
        return NextResponse.json({ error: `Unknown category "${value}"` }, { status: 400 });
      }
      values["Category"] = value || null;
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("products", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
