/**
 * Keyword bucketing + reconciliation (spec: keyword/SEO support).
 *
 * The bucket is COMPUTED — avg searches × competition against the thresholds
 * in src/config/keywords.ts — on every write and on every refresh. A record
 * with Bucket Manual Override checked is never recomputed. Null metrics mean
 * Unknown: unmeasured is not dead, and null is never treated as 0.
 */
import { cachedRecords, updateRecord } from "@/server/notion/store";
import { computeBucket } from "@/config/keywords";
import type { SimpleValue } from "@/server/notion/props";

/**
 * The importer's target shape. Phase 2's eRank/Everbee CSV mapper produces
 * rows of exactly this — manual entry already goes through it, so the
 * importer needs no migration, just a column mapping.
 */
export interface KeywordInput {
  keyword: string;
  avgSearches: number | null;
  avgClicks: number | null;
  etsyCompetition: number | null;
  seasonality?: "Evergreen" | "Seasonal" | "Unknown";
  /** ISO date the numbers were captured; defaults to today for manual entry */
  pulledAt?: string;
  source?: "eRank" | "Everbee" | "Manual";
  notes?: string;
}

/** Notion property values for a keyword input, bucket computed. */
export function keywordValues(input: KeywordInput): Record<string, SimpleValue> {
  return {
    Keyword: input.keyword.trim(),
    "Avg Searches": input.avgSearches,
    "Avg Clicks": input.avgClicks,
    "Etsy Competition": input.etsyCompetition,
    Bucket: computeBucket(input.avgSearches, input.etsyCompetition),
    Seasonality: input.seasonality ?? "Unknown",
    "Pulled At": input.pulledAt ?? new Date().toISOString().slice(0, 10),
    Source: input.source ?? "Manual",
    Notes: input.notes ?? "",
  };
}

/**
 * Recompute every keyword's bucket after a refresh — records edited directly
 * in Notion (or imported) get bucketed without the app having seen the write.
 * Returns how many records were corrected.
 */
export async function reconcileKeywordBuckets(): Promise<number> {
  let fixed = 0;
  for (const k of cachedRecords("keywords")) {
    if (k.props["Bucket Manual Override"]) continue;
    const searches = numOrNull(k.props["Avg Searches"]);
    const competition = numOrNull(k.props["Etsy Competition"]);
    const computed = computeBucket(searches, competition);
    if (String(k.props["Bucket"] ?? "") !== computed) {
      await updateRecord("keywords", k.id, { Bucket: computed });
      fixed++;
    }
  }
  return fixed;
}

function numOrNull(v: SimpleValue): number | null {
  return typeof v === "number" ? v : null;
}
