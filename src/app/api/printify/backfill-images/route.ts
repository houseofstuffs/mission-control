import { NextResponse } from "next/server";
import { cachedRecords, updateRecord } from "@/server/notion/store";
import { getBlueprint } from "@/server/printify/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // one Printify lookup + one Notion write per product

/**
 * Backfill Blueprint Image on products seeded before thumbnails existed.
 * Reads the blueprint ID already on each record — no reseeding, nothing
 * else touched. Products that already have an image are skipped, so this
 * is safe to run any number of times.
 */
export async function POST() {
  try {
    const missing = cachedRecords("products").filter(
      (p) =>
        !String(p.props["Blueprint Image"] ?? "").trim() &&
        typeof p.props["Printify Blueprint ID"] === "number"
    );

    let filled = 0;
    const skipped: string[] = [];
    for (const product of missing) {
      const blueprint = await getBlueprint(Number(product.props["Printify Blueprint ID"]));
      const image = blueprint.images?.[0];
      if (!image) {
        skipped.push(product.title);
        continue;
      }
      await updateRecord("products", product.id, { "Blueprint Image": image });
      filled++;
    }
    return NextResponse.json({ filled, skipped, alreadyDone: missing.length === 0 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
