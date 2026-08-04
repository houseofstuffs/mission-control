import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";
import { markStepsStale } from "@/server/steps";
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
    // Name = the record's internal label (renameable anytime, IDs carry all
    // relations). Title = the Etsy-facing listing title written at L2 with
    // its own <15-words gate. Two different fields on purpose.
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "A listing needs a name." }, { status: 400 });
      values["Name"] = name;
    }
    if (body.tags != null) values["Tags"] = String(body.tags);
    if (body.title != null) values["Title"] = String(body.title);
    if (body.isMultiVariant != null) values["Is Multi Variant"] = Boolean(body.isMultiVariant);
    // L3's shipping half — an attestation, stamped when it's given and
    // cleared (date included) when it's withdrawn
    if (body.shippingProfileConfirmed !== undefined) {
      const on = Boolean(body.shippingProfileConfirmed);
      values["Shipping Profile Confirmed"] = on;
      values["Shipping Confirmed At"] = on ? new Date().toISOString().slice(0, 10) : null;
    }
    // L3 — the price decision, and the cost snapshot it's judged against
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price <= 0) {
        return NextResponse.json({ error: "Price must be a positive number." }, { status: 400 });
      }
      values["Price"] = price;
    }
    // Cost At Creation is a SNAPSHOT (§3.4) — this is the one deliberate
    // way to retake it, from the product's stored estimate. Never a live
    // lookup, and it refuses when there's no estimate to take.
    if (body.resnapshotCost) {
      const productId = ((listing.props["Product"] as string[] | null) ?? [])[0];
      const product = productId ? cachedRecord(productId) : null;
      const estimate = typeof product?.props["Estimated Cost"] === "number" ? product.props["Estimated Cost"] : null;
      if (estimate == null) {
        return NextResponse.json(
          { error: "The product has no cost estimate to snapshot — pull costs on the Products page first." },
          { status: 400 }
        );
      }
      values["Cost At Creation"] = estimate;
      values["Cost Snapshot At"] = new Date().toISOString().slice(0, 10);
      if (!String(listing.props["Cost Basis"] ?? "").trim()) {
        values["Cost Basis"] = "Printify Standard";
      }
    }

    // shortlist dismissals — keyword ids ✕'d out of consideration at L2
    if (body.dismissedKeywords !== undefined) {
      const list = Array.isArray(body.dismissedKeywords)
        ? body.dismissedKeywords.map((x: unknown) => String(x)).filter(Boolean)
        : [];
      values["Dismissed Keywords (JSON)"] = JSON.stringify(list);
    }
    // L2 copy fields — drafts land here only after the operator saves them
    if (body.descriptionHook != null) values["Description Hook"] = String(body.descriptionHook);
    if (body.bodyCopy != null) values["Body Copy"] = String(body.bodyCopy);
    if (body.attributes !== undefined) {
      const list = Array.isArray(body.attributes)
        ? body.attributes
            .map((a: unknown) => {
              const o = a as { name?: unknown; value?: unknown };
              return { name: String(o?.name ?? "").trim(), value: String(o?.value ?? "").trim() };
            })
            .filter((a: { name: string; value: string }) => a.name && a.value)
        : [];
      values["Attributes (JSON)"] = JSON.stringify(list);
    }
    // the colourways this listing sells — template offers filter against it
    let colorwaysChanged = false;
    if (body.colorways !== undefined) {
      const list = Array.isArray(body.colorways)
        ? body.colorways.map((c: unknown) => String(c).trim()).filter(Boolean)
        : [];
      values["Colorways (JSON)"] = JSON.stringify(list);
      try {
        const prior = JSON.parse(String(listing.props["Colorways (JSON)"] ?? "[]"));
        colorwaysChanged =
          JSON.stringify((Array.isArray(prior) ? prior : []).slice().sort()) !==
          JSON.stringify(list.slice().sort());
      } catch {
        colorwaysChanged = true;
      }
    }

    // L4's template assignment — which mockup templates this listing uses.
    // Changing it after L5 placed variants from the old set makes those
    // placements suspect, so it staleness-marks like a colourway change.
    let shortlistChanged = false;
    if (body.templateShortlist !== undefined) {
      const list = Array.isArray(body.templateShortlist)
        ? body.templateShortlist.map((x: unknown) => String(x)).filter(Boolean)
        : [];
      const shots = new Set(cachedRecords("mockup_shots").map((s) => s.id));
      const unknown = list.filter((x: string) => !shots.has(x));
      if (unknown.length > 0) {
        return NextResponse.json({ error: "Unknown template in shortlist — refresh and retry." }, { status: 400 });
      }
      values["Template Shortlist"] = list;
      const prior = ((listing.props["Template Shortlist"] as string[] | null) ?? []).slice().sort();
      shortlistChanged = JSON.stringify(prior) !== JSON.stringify(list.slice().sort());
    }

    // the subset of colourways this listing actually generates mockups for
    let mockupColorsChanged = false;
    if (body.mockupColors !== undefined) {
      const list = Array.isArray(body.mockupColors)
        ? body.mockupColors.map((c: unknown) => String(c).trim()).filter(Boolean)
        : [];
      values["Mockup Colors (JSON)"] = JSON.stringify(list);
      try {
        const prior = JSON.parse(String(listing.props["Mockup Colors (JSON)"] ?? "[]"));
        mockupColorsChanged =
          JSON.stringify((Array.isArray(prior) ? prior : []).slice().sort()) !==
          JSON.stringify(list.slice().sort());
      } catch {
        mockupColorsChanged = true;
      }
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("etsy_listings", id, values);
    // colourways feed L4/L5 — changing them after those steps are done makes
    // the images a lie until re-checked. Stale, never silent.
    if (colorwaysChanged || mockupColorsChanged) {
      await markStepsStale(id, ["L4", "L5"], "Colorways changed — re-check images and slots.");
    }
    if (shortlistChanged) {
      await markStepsStale(id, ["L5"], "Template shortlist changed — re-check slot placements.");
    }
    // Saving tags syncs keyword ATTACHMENTS to the committed selection —
    // the visibility publish gate reads the relation, and attachment means
    // "on this listing's shortlist". Only names crossing the old/new tag
    // boundary are touched (≤ a couple dozen writes); legacy residue is
    // the rehome route's job, not a save side-effect.
    if (body.tags != null) {
      const norm = (s: string) => s.trim().toLowerCase();
      const oldTags = new Set(
        String(listing.props["Tags"] ?? "").split(",").map(norm).filter(Boolean)
      );
      const newTags = new Set(String(body.tags).split(",").map(norm).filter(Boolean));
      for (const k of cachedRecords("keywords")) {
        const name = norm(k.title);
        if (!name) continue;
        const rels = (k.props["Etsy Listings"] as string[] | null) ?? [];
        const has = rels.includes(id);
        if (newTags.has(name) && !has) {
          await updateRecord("keywords", k.id, { "Etsy Listings": [...rels, id] });
        } else if (!newTags.has(name) && has && oldTags.has(name)) {
          await updateRecord("keywords", k.id, { "Etsy Listings": rels.filter((x) => x !== id) });
        }
      }
    }
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
