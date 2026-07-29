import { NextResponse } from "next/server";
import { cachedRecord, updateRecord, archiveRecord } from "@/server/notion/store";
import { computeBucket } from "@/config/keywords";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/**
 * Keyword edits: metric updates (bucket recomputed unless the manual
 * override is on) and attach/detach against listings, designs, collections.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const kw = cachedRecord(id);
    if (!kw || kw.dbKey !== "keywords") {
      return NextResponse.json({ error: "Keyword not found in cache — refresh first" }, { status: 404 });
    }

    const values: Record<string, SimpleValue> = {};

    // ---- attach / detach ----
    const RELS: Record<string, string> = {
      listing: "Etsy Listings",
      design: "Designs",
      collection: "Collections",
    };
    for (const [kind, prop] of Object.entries(RELS)) {
      const attach = body[`attach${cap(kind)}Id`];
      const detach = body[`detach${cap(kind)}Id`];
      if (attach || detach) {
        const current = (kw.props[prop] as string[] | null) ?? [];
        let next = current;
        if (attach && !current.includes(String(attach))) next = [...current, String(attach)];
        if (detach) next = next.filter((x) => x !== String(detach));
        values[prop] = next;
      }
    }

    // ---- metric / field updates ----
    if ("avgSearches" in body) values["Avg Searches"] = toNum(body.avgSearches);
    if ("avgClicks" in body) values["Avg Clicks"] = toNum(body.avgClicks);
    if ("etsyCompetition" in body) values["Etsy Competition"] = toNum(body.etsyCompetition);
    if (body.seasonality != null) values["Seasonality"] = String(body.seasonality);
    if (body.pulledAt != null) values["Pulled At"] = String(body.pulledAt);
    if (body.notes != null) values["Notes"] = String(body.notes);
    if (body.bucketManualOverride != null) values["Bucket Manual Override"] = Boolean(body.bucketManualOverride);
    // an explicit bucket set implies the operator is overriding
    if (body.bucket != null) values["Bucket"] = String(body.bucket);

    // recompute unless overridden (now or already on the record)
    const overridden =
      body.bucket != null ||
      (body.bucketManualOverride != null ? Boolean(body.bucketManualOverride) : Boolean(kw.props["Bucket Manual Override"]));
    if (!overridden && ("avgSearches" in body || "etsyCompetition" in body)) {
      const searches = "avgSearches" in body ? toNum(body.avgSearches) : numOrNull(kw.props["Avg Searches"]);
      const competition = "etsyCompetition" in body ? toNum(body.etsyCompetition) : numOrNull(kw.props["Etsy Competition"]);
      values["Bucket"] = computeBucket(searches, competition);
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("keywords", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const kw = cachedRecord(id);
    if (!kw || kw.dbKey !== "keywords") {
      return NextResponse.json({ error: "Keyword not found in cache — refresh first" }, { status: 404 });
    }
    await archiveRecord("keywords", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
