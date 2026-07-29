import { NextResponse } from "next/server";
import { createRecord } from "@/server/notion/store";
import { keywordValues, type KeywordInput } from "@/server/keywords";

export const dynamic = "force-dynamic";

/**
 * Manual keyword entry (Phase 1). The body maps 1:1 onto KeywordInput — the
 * Phase 2 CSV importer feeds the same shape, so this route is the importer's
 * write path too. Bucket is computed here; nulls stay null.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.keyword?.trim()) {
      return NextResponse.json({ error: "A keyword is required." }, { status: 400 });
    }
    const input: KeywordInput = {
      keyword: String(body.keyword),
      avgSearches: toNum(body.avgSearches),
      avgClicks: toNum(body.avgClicks),
      etsyCompetition: toNum(body.etsyCompetition),
      seasonality: body.seasonality || undefined,
      pulledAt: body.pulledAt || undefined,
      source: body.source || undefined,
      notes: body.notes || undefined,
    };
    const values = keywordValues(input);
    // attach on create — the L2 panel adds keywords in listing context
    if (body.listingId) values["Etsy Listings"] = [String(body.listingId)];
    if (body.designId) values["Designs"] = [String(body.designId)];
    if (body.collectionId) values["Collections"] = [String(body.collectionId)];

    const record = await createRecord("keywords", values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** "" and undefined → null; never coerce absent metrics to 0. */
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
