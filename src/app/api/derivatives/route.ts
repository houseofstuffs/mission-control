import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, createRecord, updateRecord } from "@/server/notion/store";
import { productLabel } from "@/server/viewmodels";
import { derivativeFor } from "@/server/recompose";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/**
 * Record a recomposed print file — created the moment the FILE exists (the
 * operator saves its link at L1), never speculatively. Upserts on design ×
 * product: re-saving after a master change is how a Stale derivative
 * becomes Made again. Files live in Drive/S3; this stores the link (§3.6).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const design = body.designId ? cachedRecord(String(body.designId)) : null;
    const product = body.productId ? cachedRecord(String(body.productId)) : null;
    if (!design || design.dbKey !== "designs") {
      return NextResponse.json({ error: "Design not found in cache — refresh first" }, { status: 400 });
    }
    if (!product || product.dbKey !== "products") {
      return NextResponse.json({ error: "Product not found in cache — refresh first" }, { status: 400 });
    }
    const fileLink = String(body.fileLink ?? "").trim();
    if (!fileLink) {
      return NextResponse.json(
        { error: "The derivative IS the file — save its Drive/S3 link." },
        { status: 400 }
      );
    }

    const values: Record<string, SimpleValue> = {
      Name: `${design.title || "Untitled"} — ${productLabel(product)} print file`,
      Design: [design.id],
      Product: [product.id],
      "File Link": fileLink,
      "Width px": toNum(body.width),
      "Height px": toNum(body.height),
      Status: "Made",
      "Made At": new Date().toISOString().slice(0, 10),
    };

    const existing = derivativeFor(cachedRecords("design_derivatives"), design.id, product.id);
    // the listing relation accumulates — one derivative can serve several
    // listings of the same design × product
    const listingId = body.listingId ? String(body.listingId) : null;
    const priorListings = (existing?.props["Listing"] as string[] | null) ?? [];
    if (listingId) {
      values["Listing"] = priorListings.includes(listingId) ? priorListings : [...priorListings, listingId];
    }

    const record = existing
      ? await updateRecord("design_derivatives", existing.id, values)
      : await createRecord("design_derivatives", values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
