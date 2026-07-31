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
      // find it: same blueprint × provider, skipping anything probe-shaped.
      // Everything ELSE in the shop is collected too — a product made with a
      // different print provider (Printify's UI loves "Printify Choice")
      // exists, is visible, and would otherwise be dropped silently, which
      // reads as "the dropdown can't see my product".
      const matches: ShopProduct[] = [];
      const rejected: ShopProduct[] = [];
      for (let page = 1; page <= 4; page++) {
        const batch = await listShopProducts(shop, page);
        for (const p of batch) {
          if (p.title.includes("cost probe")) continue;
          if (p.blueprint_id === blueprintId && p.print_provider_id === providerId) matches.push(p);
          else rejected.push(p);
        }
        if (batch.length < 50) break;
      }
      // name the shapes of what was rejected, so a provider mismatch is
      // visible instead of mysterious. Provider names come from any seeded
      // product sharing the pair; ids otherwise.
      const shapeOf = (p: ShopProduct) => {
        const twin = cachedRecords("products").find(
          (r) =>
            r.props["Printify Blueprint ID"] === p.blueprint_id &&
            r.props["Printify Print Provider ID"] === p.print_provider_id
        );
        const provider = twin
          ? String(twin.props["Print Provider Name"] ?? `provider #${p.print_provider_id}`)
          : `provider #${p.print_provider_id}`;
        return `"${p.title}" (blueprint ${p.blueprint_id} × ${provider})`;
      };
      const otherShapes = rejected.slice(0, 8).map(shapeOf);

      if (matches.length === 0) {
        return NextResponse.json(
          {
            error:
              `No product in your Printify shop matches blueprint ${blueprintId} × provider ${providerId} (this listing's product).` +
              (otherShapes.length
                ? ` Found with a DIFFERENT shape: ${otherShapes.join(" · ")}. A product made with another print provider can't connect — recreate it in Printify with the right provider, or seed that provider as a Product and point the listing at it.`
                : " Create it in Printify first."),
          },
          { status: 404 }
        );
      }
      if (matches.length > 1 || reconnect) {
        // a pick; the chosen id is stored until deliberately changed
        return NextResponse.json({
          candidates: matches.map((m) => ({ id: m.id, title: m.title })),
          note,
          otherShapes,
        });
      }
      shopProduct = matches[0];
      pid = matches[0].id;
    }

    if (!shopProduct) shopProduct = await getShopProduct(shop, pid);

    // Never adopt a product of the wrong shape — an accidental pick of some
    // other blueprint would silently mirror the wrong colour list forever.
    if (shopProduct.blueprint_id !== blueprintId || shopProduct.print_provider_id !== providerId) {
      return NextResponse.json(
        {
          error:
            `"${shopProduct.title}" is blueprint ${shopProduct.blueprint_id} × provider ${shopProduct.print_provider_id}, ` +
            `but this listing's product is blueprint ${blueprintId} × provider ${providerId}. ` +
            `Use "Change product" to pick the right one.`,
        },
        { status: 400 }
      );
    }

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

    return NextResponse.json({ record, colorways, changed, printifyProductId: pid, note });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
