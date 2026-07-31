import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";
import {
  listShopProducts,
  getShopProduct,
  getBlueprint,
  listVariants,
  type ShopProduct,
} from "@/server/printify/client";
import { printifyShopId } from "@/server/printify/probe";
import { markStepsStale } from "@/server/steps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Connect a listing to the REAL Printify product (made by hand in Printify's
 * UI — Printify owns creation, this app never makes one) and mirror its
 * enabled variant colours into Colorways.
 *
 * Matching is by GARMENT, not by raw blueprint id: Printify's catalog holds
 * duplicate blueprint entries for the same physical product (all "Comfort
 * Colors 1466", different catalog ids), so a product created from a sibling
 * entry — same brand + model, same print provider — is the same garment and
 * connects fine. Colour mapping goes through the live catalog when the
 * blueprint ids differ, because variant ids don't carry across entries.
 *
 * Colorways feed L4/L5 — when a sync CHANGES them after those steps are
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
    const wantBrand = String(productRec.props["Blueprint Brand"] ?? "").trim().toLowerCase();
    const wantModel = String(productRec.props["Blueprint Model"] ?? "").trim().toLowerCase();

    // Same garment? Exact blueprint match, or a sibling catalog entry with
    // the same brand + model on the same provider.
    const blueprintMemo = new Map<number, { brand: string; model: string } | null>();
    async function sameGarment(p: ShopProduct): Promise<boolean> {
      if (p.print_provider_id !== providerId) return false;
      if (p.blueprint_id === blueprintId) return true;
      if (!wantBrand || !wantModel) return false;
      if (!blueprintMemo.has(p.blueprint_id)) {
        try {
          const bp = await getBlueprint(p.blueprint_id);
          blueprintMemo.set(p.blueprint_id, {
            brand: (bp.brand ?? "").trim().toLowerCase(),
            model: (bp.model ?? "").trim().toLowerCase(),
          });
        } catch {
          blueprintMemo.set(p.blueprint_id, null);
        }
      }
      const bp = blueprintMemo.get(p.blueprint_id);
      return Boolean(bp && bp.brand === wantBrand && bp.model === wantModel);
    }

    const shop = await printifyShopId();
    // reconnect = deliberate re-pick: ignore the stored ID and show matches
    const reconnect = Boolean(body.reconnect);
    let pid = reconnect
      ? String(body.printifyProductId ?? "")
      : String(body.printifyProductId ?? "") || String(listing.props["Printify Product ID"] ?? "");
    let shopProduct: ShopProduct | null = null;
    let note: string | null = null;

    // A stored ID can go stale — the product deleted in Printify. Detect it,
    // clear the connection, and fall through to a fresh search instead of
    // mirroring a ghost.
    if (pid && !body.printifyProductId) {
      try {
        shopProduct = await getShopProduct(shop, pid);
      } catch (err) {
        if (/Printify 404 /.test((err as Error).message)) {
          await updateRecord("etsy_listings", id, { "Printify Product ID": null });
          pid = "";
          shopProduct = null;
          note = "The connected Printify product no longer exists — pick its replacement.";
        } else {
          throw err;
        }
      }
    }

    if (!pid) {
      const matches: ShopProduct[] = [];
      const rejected: ShopProduct[] = [];
      for (let page = 1; page <= 4; page++) {
        const batch = await listShopProducts(shop, page);
        for (const p of batch) {
          if (p.title.includes("cost probe")) continue;
          if (await sameGarment(p)) matches.push(p);
          else rejected.push(p);
        }
        if (batch.length < 50) break;
      }
      if (matches.length === 0) {
        const shapes = rejected
          .slice(0, 3)
          .map((p) => `"${p.title}" (blueprint ${p.blueprint_id} × provider #${p.print_provider_id})`);
        return NextResponse.json(
          {
            error:
              `No product in your Printify shop is this garment (${productRec.title}).` +
              (shapes.length ? ` Closest non-matches: ${shapes.join(" · ")}.` : " Create it in Printify first."),
          },
          { status: 404 }
        );
      }
      if (matches.length > 1 || reconnect) {
        // a pick; the chosen id is stored until deliberately changed
        return NextResponse.json({
          candidates: matches.map((m) => ({ id: m.id, title: m.title })),
          note,
        });
      }
      shopProduct = matches[0];
      pid = matches[0].id;
    }

    if (!shopProduct) shopProduct = await getShopProduct(shop, pid);

    // Never adopt a different garment — an accidental pick would silently
    // mirror the wrong colour list forever.
    if (!(await sameGarment(shopProduct))) {
      return NextResponse.json(
        {
          error:
            `"${shopProduct.title}" (blueprint ${shopProduct.blueprint_id} × provider #${shopProduct.print_provider_id}) ` +
            `isn't this listing's garment (${productRec.title}). Use "Change product" to pick the right one.`,
        },
        { status: 400 }
      );
    }

    // enabled variant ids → colour names. Cached variant records cover the
    // seeded blueprint; a sibling catalog entry has different variant ids,
    // so those map through the live catalog instead.
    const enabled = new Set(
      (shopProduct.variants ?? []).filter((v) => v.is_enabled).map((v) => v.id)
    );
    let colorways: string[];
    if (shopProduct.blueprint_id === blueprintId) {
      colorways = Array.from(
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
    } else {
      const live = await listVariants(shopProduct.blueprint_id, shopProduct.print_provider_id);
      colorways = Array.from(
        new Set(
          live
            .filter((v) => enabled.has(v.id))
            .map((v) => (v.options?.color ?? "").trim())
            .filter(Boolean)
        )
      ).sort();
    }

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

    return NextResponse.json({ record, colorways, changed, printifyProductId: pid, note });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
