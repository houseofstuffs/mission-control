import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";
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

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("etsy_listings", id, values);
    // colourways feed L4/L5 — changing them after those steps are done makes
    // the images a lie until re-checked. Stale, never silent.
    if (colorwaysChanged) {
      await markStepsStale(id, ["L4", "L5"], "Colorways changed — re-check images and slots.");
    }
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
