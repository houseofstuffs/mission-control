/**
 * Listing-research CSV → per-keyword momentum.
 *
 * Everbee Product Analytics and eRank top-listing exports carry per-listing
 * lifetime sales, monthly sales and listing age — the ingredients for "is
 * this market selling NOW". The aggregate lands on ONE keyword (the search
 * the export was pulled for) as a momentum label + detail JSON; the raw
 * listing rows are never stored.
 *
 * Same dirty-data rules as the keyword importer: absent or unparseable →
 * null, never 0; too few usable rows → Unknown, never a guessed label.
 */
import { parseCsvText, norm, parseMetric } from "./keywordCsv";
import { computeMomentum, type Momentum } from "@/config/momentum";

interface ListingRow {
  monthly: number | null;
  total: number | null;
  ageMonths: number | null;
}

export interface MomentumDetail {
  recentShare: number | null;
  monthlySales: number | null;
  lifetimeSales: number | null;
  medianAgeMonths: number | null;
  listingCount: number;
  usableListings: number;
  source: string;
  computedAt: string;
}

export interface ParsedListingCsv {
  source: string;
  momentum: Momentum;
  detail: MomentumDetail;
}

const MONTHLY_HEADERS = new Set([
  "estmonthlysales", "monthlysales", "mosales", "estmosales", "avgmonthlysales",
  "salespermonth", "estsales", // eRank's "Est. Sales" is a monthly estimate
]);
const TOTAL_HEADERS = new Set(["totalsales", "esttotalsales", "lifetimesales", "sales"]);
const AGE_HEADERS = new Set([
  "listingage", "listingageinmonths", "ageinmonths", "age",
  "listingagedays", "listingageindays", "agedays", "ageindays",
]);
const CREATED_HEADERS = new Set(["creationdate", "listedon", "dateadded", "datelisted", "createdat"]);

/** any sales/age column and no keyword column = a listing export, not a keyword one */
export function looksLikeListingCsv(headerRow: string[]): boolean {
  const headers = headerRow.map(norm);
  const hasListingMarker = headers.some(
    (h) => MONTHLY_HEADERS.has(h) || TOTAL_HEADERS.has(h) || AGE_HEADERS.has(h) || CREATED_HEADERS.has(h)
  );
  const hasKeywordColumn = headers.some((h) => h === "keyword" || h === "keywords");
  return hasListingMarker && !hasKeywordColumn;
}

export function parseListingCsv(text: string): ParsedListingCsv {
  const table = parseCsvText(text);
  if (table.length < 2) {
    throw new Error("The listing CSV needs a header row and at least one listing row.");
  }
  const headers = table[0].map(norm);
  const col = (names: Set<string>) => headers.findIndex((h) => names.has(h));
  const monthlyCol = col(MONTHLY_HEADERS);
  const totalCol = col(TOTAL_HEADERS);
  const ageCol = col(AGE_HEADERS);
  const createdCol = col(CREATED_HEADERS);
  const ageInDays = ageCol !== -1 && /day/.test(table[0][ageCol].toLowerCase());

  if (monthlyCol === -1 && totalCol === -1) {
    throw new Error(
      "No sales columns found — expected monthly and/or total sales headers (Everbee Product Analytics or eRank listing export)."
    );
  }

  // Everbee speaks months and monthly estimates; eRank speaks days. Loose on
  // purpose — it labels the source, it doesn't gate the math.
  const source = ageInDays || headers.includes("hearts") ? "eRank" : "Everbee";

  const now = Date.now();
  const rows: ListingRow[] = table.slice(1).map((line) => {
    let ageMonths = ageCol === -1 ? null : parseMetric(line[ageCol]);
    if (ageMonths != null && ageInDays) ageMonths = ageMonths / 30.44;
    if (ageMonths == null && createdCol !== -1) {
      const t = Date.parse(line[createdCol] ?? "");
      if (!Number.isNaN(t) && t < now) ageMonths = (now - t) / (30.44 * 86_400_000);
    }
    return {
      monthly: monthlyCol === -1 ? null : parseMetric(line[monthlyCol]),
      total: totalCol === -1 ? null : parseMetric(line[totalCol]),
      ageMonths,
    };
  });

  // recent sales per listing: everything a young listing ever sold is
  // recent; an older listing contributes monthly × 12, capped at lifetime
  let sumRecent = 0;
  let sumTotal = 0;
  let usable = 0;
  for (const r of rows) {
    if (r.total == null) continue;
    let recent: number | null = null;
    if (r.ageMonths != null && r.ageMonths <= 12) recent = r.total;
    else if (r.monthly != null) recent = Math.min(r.total, r.monthly * 12);
    if (recent == null) continue;
    sumRecent += recent;
    sumTotal += r.total;
    usable++;
  }
  const recentShare = usable > 0 && sumTotal > 0 ? sumRecent / sumTotal : null;

  const ages = rows.map((r) => r.ageMonths).filter((a): a is number => a != null).sort((a, b) => a - b);
  const medianAgeMonths = ages.length > 0 ? ages[Math.floor(ages.length / 2)] : null;

  const monthlyVals = rows.map((r) => r.monthly).filter((m): m is number => m != null);
  const totalVals = rows.map((r) => r.total).filter((t): t is number => t != null);

  const detail: MomentumDetail = {
    recentShare,
    monthlySales: monthlyVals.length > 0 ? Math.round(monthlyVals.reduce((a, b) => a + b, 0)) : null,
    lifetimeSales: totalVals.length > 0 ? Math.round(totalVals.reduce((a, b) => a + b, 0)) : null,
    medianAgeMonths: medianAgeMonths == null ? null : Math.round(medianAgeMonths),
    listingCount: rows.length,
    usableListings: usable,
    source,
    computedAt: new Date().toISOString().slice(0, 10),
  };
  return { source, momentum: computeMomentum(recentShare, medianAgeMonths, usable), detail };
}

/** the chip tooltip — built server-side so every surface says it the same way */
export function momentumTooltip(detail: MomentumDetail): string {
  const parts: string[] = [];
  if (detail.recentShare != null) {
    parts.push(`${Math.round(detail.recentShare * 100)}% of tracked sales in the last 12 mo`);
  }
  if (detail.monthlySales != null) parts.push(`~${detail.monthlySales}/mo now`);
  if (detail.lifetimeSales != null) parts.push(`${detail.lifetimeSales} lifetime`);
  if (detail.medianAgeMonths != null) parts.push(`median listing age ${detail.medianAgeMonths} mo`);
  parts.push(`${detail.listingCount} listings · ${detail.source} ${detail.computedAt}`);
  return parts.join(" · ");
}
