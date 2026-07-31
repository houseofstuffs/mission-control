/**
 * Keyword momentum — is this market selling NOW, or did it sell hot years
 * ago? Computed from listing-research exports (Everbee Product Analytics,
 * eRank top listings), which carry per-listing lifetime sales, monthly
 * sales and listing age.
 *
 * Deliberately a SEPARATE signal from the Visibility/Reach/Best Seller
 * buckets: buckets come from searches × competition and feed the publish
 * gate; momentum is a label beside them. Older data is never discounted
 * away — the lifetime totals stay stored and visible, momentum just says
 * how much of that story is recent.
 *
 * The core number is RECENT SHARE: of all sales the export tracks, what
 * fraction happened in the last 12 months. Per listing, recent sales ≈
 * monthly × 12 (capped at its lifetime total); a listing under a year old
 * counts its whole lifetime as recent.
 */

/** ≥ this share of tracked sales in the last 12 months → Selling now */
export const RECENT_SHARE_HOT = 0.5;
/** < this share → Legacy (when the winners are also old, see below) */
export const RECENT_SHARE_LEGACY = 0.2;
/** median listing age at/under this (months) reads as an active market
 *  regardless of share — young winners mean the market is buying today */
export const YOUNG_MARKET_MEDIAN_MONTHS = 12;
/** Legacy needs old winners too — a low share with young listings is
 *  noise, not history */
export const LEGACY_MEDIAN_MONTHS = 24;
/** fewer usable listings than this → Unknown, never a guessed label */
export const MIN_LISTINGS_FOR_READ = 3;

export type Momentum = "Selling now" | "Steady" | "Legacy" | "Unknown";

export const MOMENTUM_OPTIONS: Momentum[] = ["Selling now", "Steady", "Legacy", "Unknown"];

export function computeMomentum(
  recentShare: number | null,
  medianAgeMonths: number | null,
  usableListings: number
): Momentum {
  if (usableListings < MIN_LISTINGS_FOR_READ || recentShare == null) return "Unknown";
  if (
    recentShare >= RECENT_SHARE_HOT ||
    (medianAgeMonths != null && medianAgeMonths <= YOUNG_MARKET_MEDIAN_MONTHS)
  ) {
    return "Selling now";
  }
  if (
    recentShare < RECENT_SHARE_LEGACY &&
    (medianAgeMonths == null || medianAgeMonths >= LEGACY_MEDIAN_MONTHS)
  ) {
    return "Legacy";
  }
  return "Steady";
}
