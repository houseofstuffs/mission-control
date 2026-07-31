import { NextResponse } from "next/server";
import { cachedRecords, createRecord, updateRecord } from "@/server/notion/store";
import { parseKeywordCsv } from "@/server/keywordCsv";
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
 * Dedupe is by keyword TEXT (case-insensitive): a keyword that already
 * exists is attached to the listing, never duplicated. Metrics on an
 * existing row are only written when they fill a blank or match what's
 * there — a row whose numbers DISAGREE with the import comes back as a
 * conflict for the operator to resolve, never a silent overwrite.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const csv = String(body.csv ?? "");
    const listingId = body.listingId ? String(body.listingId) : null;
    if (!csv.trim()) {
      return NextResponse.json({ error: "Empty file — export the keyword list as CSV first." }, { status: 400 });
    }

    const parsed = parseKeywordCsv(csv);
    const bank = cachedRecords("keywords");
    const byName = new Map(bank.map((k) => [k.title.trim().toLowerCase(), k]));

    let created = 0;
    let attached = 0;
    let unchanged = 0;
    const conflicts: ImportConflict[] = [];

    for (const row of parsed.rows) {
      const existing = byName.get(row.keyword.trim().toLowerCase());

      if (!existing) {
        const values = keywordValues(row);
        if (listingId) values["Etsy Listings"] = [listingId];
        const rec = await createRecord("keywords", values);
        byName.set(row.keyword.trim().toLowerCase(), rec);
        created++;
        continue;
      }

      const values: Record<string, SimpleValue> = {};

      // attach to the listing regardless of the metric question — same
      // keyword text is the same keyword; attachment isn't an overwrite
      if (listingId) {
        const rels = (existing.props["Etsy Listings"] as string[] | null) ?? [];
        if (!rels.includes(listingId)) {
          values["Etsy Listings"] = [...rels, listingId];
          attached++;
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

    return NextResponse.json({
      source: parsed.source,
      total: parsed.rows.length,
      created,
      attached,
      unchanged,
      skipped: parsed.skipped,
      conflicts,
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
