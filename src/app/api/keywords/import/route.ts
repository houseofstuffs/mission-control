import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, createRecord, updateRecord } from "@/server/notion/store";
import { parseKeywordCsv, parseCsvText } from "@/server/keywordCsv";
import { looksLikeListingCsv, parseListingCsv, momentumTooltip } from "@/server/listingCsv";
import { keywordValues } from "@/server/keywords";
import { computeBucket } from "@/config/keywords";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export interface ImportConflict {
  id: string;
  keyword: string;
  existing: { avgSearches: number | null; avgClicks: number | null; competition: number | null; bucket: string };
  incoming: { avgSearches: number | null; avgClicks: number | null; competition: number | null; bucket: string };
}

/**
 * eRank/Everbee CSV import — the Phase 2 placeholder made real, writing
 * through the same shapes as manual entry (KeywordInput → keywordValues).
 *
 * Two file kinds share this door, detected by header shape:
 *   - KEYWORD exports (a Keyword column + metrics) → rows into the bank,
 *     linked to the listing's DESIGN so they feed the recommendation pool.
 *     NEVER attached to the listing itself: attachment is the operator's
 *     hand-picked shortlist (~13), and a 900-row export is research, not a
 *     shortlist. Dedupe is by keyword TEXT (case-insensitive). Metrics on
 *     an existing row are only written when they fill a blank or match
 *     what's there — a row whose numbers DISAGREE comes back as a conflict
 *     for the operator to resolve, never a silent overwrite.
 *   - LISTING-RESEARCH exports (per-listing sales + age, no Keyword
 *     column) → aggregated into a momentum read on ONE keyword; the
 *     client supplies keywordId, or gets needsKeyword back and asks.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const csv = String(body.csv ?? "");
    const listingId = body.listingId ? String(body.listingId) : null;
    if (!csv.trim()) {
      return NextResponse.json({ error: "Empty file — export the keyword list as CSV first." }, { status: 400 });
    }

    const table = parseCsvText(csv);
    if (table.length >= 1 && looksLikeListingCsv(table[0])) {
      const parsed = parseListingCsv(csv);
      if (!body.keywordId) {
        // the export doesn't say which search it came from — ask
        return NextResponse.json({
          kind: "listing",
          needsKeyword: true,
          source: parsed.source,
          listingCount: parsed.detail.listingCount,
        });
      }
      const kw = cachedRecord(String(body.keywordId));
      if (!kw || kw.dbKey !== "keywords") {
        return NextResponse.json({ error: "Keyword not found in cache — refresh first" }, { status: 404 });
      }
      await updateRecord("keywords", kw.id, {
        Momentum: parsed.momentum,
        "Momentum Detail (JSON)": JSON.stringify(parsed.detail),
      });
      return NextResponse.json({
        kind: "listing",
        keyword: kw.title,
        momentum: parsed.momentum,
        tooltip: momentumTooltip(parsed.detail),
        listingCount: parsed.detail.listingCount,
        source: parsed.source,
      });
    }

    const parsed = parseKeywordCsv(csv);
    const bank = cachedRecords("keywords");
    const byName = new Map(bank.map((k) => [k.title.trim().toLowerCase(), k]));

    // the research lands on the DESIGN — every listing of this design
    // (and every future fan-out) recommends from the same pool
    const listing = listingId ? cachedRecord(listingId) : null;
    const designId = listing ? (((listing.props["Designs"] as string[] | null) ?? [])[0] ?? null) : null;

    let created = 0;
    let linked = 0;
    let unchanged = 0;
    const conflicts: ImportConflict[] = [];

    for (const row of parsed.rows) {
      const existing = byName.get(row.keyword.trim().toLowerCase());

      if (!existing) {
        const values = keywordValues(row);
        if (designId) values["Designs"] = [designId];
        const rec = await createRecord("keywords", values);
        byName.set(row.keyword.trim().toLowerCase(), rec);
        created++;
        continue;
      }

      const values: Record<string, SimpleValue> = {};

      // link to the design regardless of the metric question — same
      // keyword text is the same keyword; a relation isn't an overwrite
      if (designId) {
        const rels = (existing.props["Designs"] as string[] | null) ?? [];
        if (!rels.includes(designId)) {
          values["Designs"] = [...rels, designId];
          linked++;
        }
      }

      const cur = {
        avgSearches: numOrNull(existing.props["Avg Searches"]),
        avgClicks: numOrNull(existing.props["Avg Clicks"]),
        competition: numOrNull(existing.props["Etsy Competition"]),
      };
      const differs =
        disagrees(cur.avgSearches, row.avgSearches) ||
        disagrees(cur.avgClicks, row.avgClicks) ||
        disagrees(cur.competition, row.etsyCompetition);

      if (differs) {
        conflicts.push({
          id: existing.id,
          keyword: existing.title,
          existing: { ...cur, bucket: String(existing.props["Bucket"] ?? "Unknown") },
          incoming: {
            avgSearches: row.avgSearches,
            avgClicks: row.avgClicks,
            competition: row.etsyCompetition,
            bucket: computeBucket(row.avgSearches, row.etsyCompetition),
          },
        });
      } else {
        // agreement or blanks — fill blanks, refresh the pull date
        const fills: Record<string, SimpleValue> = {};
        if (cur.avgSearches == null && row.avgSearches != null) fills["Avg Searches"] = row.avgSearches;
        if (cur.avgClicks == null && row.avgClicks != null) fills["Avg Clicks"] = row.avgClicks;
        if (cur.competition == null && row.etsyCompetition != null) fills["Etsy Competition"] = row.etsyCompetition;
        if (Object.keys(fills).length > 0) {
          fills["Pulled At"] = new Date().toISOString().slice(0, 10);
          fills["Source"] = parsed.source;
          if (!existing.props["Bucket Manual Override"]) {
            fills["Bucket"] = computeBucket(
              cur.avgSearches ?? row.avgSearches,
              cur.competition ?? row.etsyCompetition
            );
          }
          Object.assign(values, fills);
        }
      }

      if (Object.keys(values).length > 0) {
        await updateRecord("keywords", existing.id, values);
      } else if (!differs) {
        unchanged++;
      }
    }

    // log the file against the design so the panel can say how much
    // research has already been folded in (and not re-import blindly)
    if (designId) {
      const design = cachedRecord(designId);
      let log: Array<{ file: string; source: string; rows: number; at: string }> = [];
      try {
        const prior = JSON.parse(String(design?.props["Keyword Imports (JSON)"] ?? "[]"));
        if (Array.isArray(prior)) log = prior;
      } catch {
        /* unreadable history starts over rather than blocking the import */
      }
      log.push({
        file: String(body.fileName ?? "").trim() || "keyword export",
        source: parsed.source,
        rows: parsed.rows.length,
        at: new Date().toISOString().slice(0, 10),
      });
      // keep the tail bounded — the count is the point, not the archive
      await updateRecord("designs", designId, {
        "Keyword Imports (JSON)": JSON.stringify(log.slice(-40)),
      });
    }

    return NextResponse.json({
      kind: "keywords",
      source: parsed.source,
      total: parsed.rows.length,
      created,
      linked,
      unchanged,
      skipped: parsed.skipped,
      conflicts,
      // no design = nowhere to aim the research; rows are in the bank only
      noDesign: !designId,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/** conflict = both sides have a number and they differ; a blank never conflicts */
function disagrees(existing: number | null, incoming: number | null): boolean {
  return existing != null && incoming != null && existing !== incoming;
}
