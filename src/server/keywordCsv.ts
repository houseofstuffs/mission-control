/**
 * eRank / Everbee keyword CSV → KeywordInput rows.
 *
 * The two tools name the same three numbers differently — eRank says
 * "Avg Searches / Avg Clicks / Etsy Competition", Everbee says "Volume /
 * Competition" (clicks usually absent) — so mapping is a header-synonym
 * table over normalised names, not two hardcoded formats. Anything with a
 * keyword column and at least one metric column imports; unmapped columns
 * are ignored rather than fatal.
 *
 * Numbers arrive dirty: "1,234", "< 20", "N/A", "Unknown", "". Absent or
 * unparseable → null, never 0 — the bucket rule treats null as Unknown.
 * "< 20" keeps its ceiling (20): eRank uses it for volumes under the floor,
 * and 20 lands the keyword in Dead, which is what "< 20 searches" means.
 */
import type { KeywordInput } from "@/server/keywords";

export interface ParsedKeywordCsv {
  /** best guess at which tool exported this, from the header shape */
  source: "eRank" | "Everbee";
  rows: KeywordInput[];
  /** lines that had no keyword text — reported, never silently dropped */
  skipped: number;
}

/** lowercase, letters+digits only — "Avg. Searches " and "avg_searches" meet here */
function norm(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const KEYWORD_HEADERS = new Set(["keyword", "keywords", "tag", "searchterm"]);
const SEARCHES_HEADERS = new Set([
  "avgsearches", "averagesearches", "searches", "volume", "searchvolume",
  "estsearches", "avgmonthlysearches", "monthlysearches",
]);
const CLICKS_HEADERS = new Set(["avgclicks", "averageclicks", "clicks", "estclicks"]);
const COMPETITION_HEADERS = new Set([
  "etsycompetition", "competition", "competinglistings", "totalcompetition",
]);

/** headers that only eRank uses vs only Everbee uses — for source detection */
const ERANK_MARKERS = new Set(["avgsearches", "avgclicks", "etsycompetition", "googlesearches", "longtail"]);
const EVERBEE_MARKERS = new Set(["volume", "searchvolume", "keywordscore", "competinglistings", "totalviews"]);

/** "1,234" → 1234 · "< 20" → 20 · "N/A"/"Unknown"/"" → null. Never 0 for absent. */
function parseMetric(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[",$%\s]/g, "").replace(/^[<>~≈]+/, "");
  if (!cleaned || /^(na|n\/a|unknown|none|-)$/i.test(cleaned)) return null;
  const n = Number(cleaned.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Minimal quote-aware CSV: handles quoted fields, "" escapes, \r\n. */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export function parseKeywordCsv(text: string): ParsedKeywordCsv {
  const table = parseCsvText(text);
  if (table.length < 2) {
    throw new Error("The CSV needs a header row and at least one keyword row.");
  }
  const headers = table[0].map(norm);

  const col = (names: Set<string>): number => headers.findIndex((h) => names.has(h));
  const kwCol = col(KEYWORD_HEADERS);
  const searchesCol = col(SEARCHES_HEADERS);
  const clicksCol = col(CLICKS_HEADERS);
  const compCol = col(COMPETITION_HEADERS);

  if (kwCol === -1) {
    throw new Error(
      `No keyword column found — expected a header like "Keyword". Got: ${table[0].join(", ")}`
    );
  }
  if (searchesCol === -1 && compCol === -1) {
    throw new Error(
      "No metric columns found — expected search volume and/or competition headers (eRank or Everbee export)."
    );
  }

  const erankScore = headers.filter((h) => ERANK_MARKERS.has(h)).length;
  const everbeeScore = headers.filter((h) => EVERBEE_MARKERS.has(h)).length;
  const source: ParsedKeywordCsv["source"] = everbeeScore > erankScore ? "Everbee" : "eRank";

  const rows: KeywordInput[] = [];
  let skipped = 0;
  for (const line of table.slice(1)) {
    const keyword = (line[kwCol] ?? "").trim();
    if (!keyword) {
      skipped++;
      continue;
    }
    rows.push({
      keyword,
      avgSearches: searchesCol === -1 ? null : parseMetric(line[searchesCol]),
      avgClicks: clicksCol === -1 ? null : parseMetric(line[clicksCol]),
      etsyCompetition: compCol === -1 ? null : parseMetric(line[compCol]),
      source,
    });
  }
  return { source, rows, skipped };
}
