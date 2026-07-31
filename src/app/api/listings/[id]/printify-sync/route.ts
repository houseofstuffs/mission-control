import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";
import { listShopProducts, getShopProduct, type ShopProduct } from "@/server/printify/client";
import { printifyShopId } from "@/server/printify/probe";
import { markStepsStale } from "@/server/steps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Connect a listing to the REAL Printify product (made by hand in Printify's
 * UI — Printify owns creation, this app never makes one) and mirror its
 * enabled variant colours into Colorways.
 *
 * First call finds the product by blueprint × provider; one match is adopted
 * outright, several come back as candidates for a one-time pick. The chosen
 * ID is stored (external IDs on every synced record — non-negotiable), so
 * every later call is a straight re-sync.
 *
 * Colorways feed L4/L5 — when a re-sync CHANGES them after those steps are
 * done, the steps go stale rather than silently lying.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found in cache — refresh first" }, { status: 404 });
    }
    const productRecId = ((listing.props["Product"] as string[] | null) ?? [])[0];
    const productRec = productRecId ? cachedRecord(productRecId) : null;
    if (!productRec) {
      return NextResponse.json({ error: "This listing has no Product set — pick one first." }, { status: 400 });
    }
    const blueprintId = Number(productRec.props["Printify Blueprint ID"]);
    const providerId = Number(productRec.props["Printify Print Provider ID"]);

    const shop = await printifyShopId();
    let pid = String(body.printifyProductId ?? "") || String(listing.props["Printify Product ID"] ?? "");
    let shopProduct: ShopProduct | null = null;

    if (!pid) {
      // find it: same blueprint × provider, skipping anything probe-shaped
      const matches: ShopProduct[] = [];
      for (let page = 1; page <= 4; page++) {
        const batch = await listShopProducts(shop, page);
        for (const p of batch) {
          if (
            p.blueprint_id === blueprintId &&
            p.print_provider_id === providerId &&
            !p.title.includes("cost probe")
          ) {
            matches.push(p);
          }
        }
        if (batch.length < 50) break;
      }
      if (matches.length === 0) {
        return NextResponse.json(
          { error: "No product in your Printify shop matches this blueprint × provider — create it in Printify first." },
          { status: 404 }
        );
      }
      if (matches.length > 1) {
        // a one-time pick; the chosen id is stored and never asked again
        return NextResponse.json({
          candidates: matches.map((m) => ({ id: m.id, title: m.title })),
        });
      }
      shopProduct = matches[0];
      pid = matches[0].id;
    }

    if (!shopProduct) shopProduct = await getShopProduct(shop, pid);

    // enabled variant ids → colour names, via the seeded variant records
    const enabled = new Set(
      (shopProduct.variants ?? []).filter((v) => v.is_enabled).map((v) => v.id)
    );
    const colorways = Array.from(
      new Set(
        cachedRecords("product_variants")
          .filter(
            (v) =>
              ((v.props["Product"] as string[] | null) ?? []).includes(productRec.id) &&
              enabled.has(Number(v.props["Printify Variant ID"]))
          )
          .map((v) => String(v.props["Color"] ?? "").trim())
          .filter(Boolean)
      )
    ).sort();

    const before = (() => {
      try {
        const parsed = JSON.parse(String(listing.props["Colorways (JSON)"] ?? "[]"));
        return Array.isArray(parsed) ? (parsed as string[]).slice().sort() : [];
      } catch {
        return [];
      }
    })();
    const changed = JSON.stringify(before) !== JSON.stringify(colorways);

    let externalIds: Record<string, unknown> = {};
    try {
      externalIds = JSON.parse(String(listing.props["External IDs (JSON)"] ?? "{}"));
    } catch {
      /* rebuild from scratch */
    }
    externalIds.printifyProductId = pid;

    const record = await updateRecord("etsy_listings", id, {
      "Colorways (JSON)": JSON.stringify(colorways),
      "Printify Product ID": pid,
      "External IDs (JSON)": JSON.stringify(externalIds),
    });

    if (changed) {
      await markStepsStale(id, ["L4", "L5"], "Colorways changed on Printify sync — re-check images and slots.");
    }

    return NextResponse.json({ record, colorways, changed, printifyProductId: pid });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
