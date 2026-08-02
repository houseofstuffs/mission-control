import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import { CATEGORIES } from "@/config/product-categories";
import { computeAndStoreCost } from "@/server/productCost";
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

    // wall_art's cost anchor — must be one of THIS product's variants
    if (body.representativeVariantId !== undefined) {
      if (body.representativeVariantId) {
        const variant = cachedRecord(String(body.representativeVariantId));
        const belongs =
          variant?.dbKey === "product_variants" &&
          ((variant.props["Product"] as string[] | null) ?? []).includes(id);
        if (!belongs) {
          return NextResponse.json(
            { error: "That variant doesn't belong to this product — refresh and retry." },
            { status: 400 }
          );
        }
        values["Representative Variant"] = [variant.id];
      } else {
        values["Representative Variant"] = [];
      }
    }

    // the shop-voice boilerplate — operator-approved text, stamped when saved
    if (body.shopVoiceText !== undefined) {
      const text = String(body.shopVoiceText).trim();
      if (!text) {
        return NextResponse.json({ error: "Boilerplate can't be saved empty." }, { status: 400 });
      }
      values["Shop Voice Text"] = text;
      values["Voice Generated At"] = new Date().toISOString().slice(0, 10);
    }

    // reusable per-blueprint graphic cards — L5 auto-fills the matching
    // named slot from these; blank is a valid value (clears the link)
    const GRAPHIC_FIELDS: Record<string, string> = {
      highlightsSizingGraphicLink: "Highlights & Sizing Graphic Link",
      carePoliciesGraphicLink: "Care & Policies Graphic Link",
      colorwaysGraphicLink: "Colorways Graphic Link",
    };
    for (const [key, field] of Object.entries(GRAPHIC_FIELDS)) {
      if (body[key] !== undefined) values[field] = String(body[key]).trim() || null;
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    let record = await updateRecord("products", id, values);
    // both fields feed the estimate — recompute so the stored number never
    // disagrees with the inputs sitting next to it
    if (body.category !== undefined || body.representativeVariantId !== undefined) {
      await computeAndStoreCost(id);
      record = cachedRecord(id) ?? record;
    }
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
