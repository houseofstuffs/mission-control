/**
 * Keyword/SEO tunables — every threshold in one place so behavior is
 * adjustable without touching logic.
 */

/** avg searches below this → Dead, regardless of competition */
export const VOLUME_FLOOR = 100;
/** avg searches at/above this → Best Seller: proven head-term demand */
export const BEST_SELLER_SEARCHES = 5_000;
/** avg searches at/above this → at least Reach: real mid-market demand */
export const REACH_SEARCHES = 1_000;
/** competing listings below this → low competition, a new listing can rank */
export const COMPETITION_LOW = 10_000;
/** competing listings above this → head-market territory (Best Seller) */
export const COMPETITION_HIGH = 100_000;
/** eRank numbers older than this render with the stale treatment */
export const STALE_AFTER_DAYS = 90;

/** Etsy hard-caps tags at 20 characters — never offer longer as a tag. */
export const TAG_MAX_CHARS = 20;
/** Etsy allows exactly 13 tags per listing. */
export const TAG_COUNT = 13;

/** Advisory mix across the 13 tags — guidance, never enforced. */
export const TARGET_MIX = "~6-7 visibility · ~4-5 reach · ~1-2 best sellers";

export type Bucket = "Visibility" | "Reach" | "Best Seller" | "Dead" | "Unknown";

export const BUCKETS: Bucket[] = ["Visibility", "Reach", "Best Seller", "Unknown", "Dead"];

/**
 * The bucketing rule — TWO-dimensional, the way a keyword strategist reads
 * a list: demand (avg searches) and supply (competing listings) together,
 * not competition alone. Competition-only bucketing collapses a niche
 * dataset into one bucket, because niche phrases rarely clear 10k
 * competing listings no matter how much demand they carry.
 *
 * By what the tag DOES for a listing:
 *   - Best Seller — head terms: big proven demand (≥5k searches/mo), or a
 *     market so large (>100k competitors) that only head demand sustains
 *     it. ~1-2 of these lottery tickets per listing.
 *   - Reach — the mid-market: real demand (≥1k searches) or real crowds
 *     (≥10k competitors). Pulls broader traffic once the listing has
 *     traction.
 *   - Visibility — long-tail: modest demand, under 10k competitors. Where
 *     a brand-new listing can actually reach page one. The backbone
 *     (~6-7 tags).
 *   - Dead — under 100 searches/mo. Nobody's looking.
 *
 * Nulls: unmeasured is not dead, and null is never treated as 0. No
 * volume → Unknown (demand is the primary axis; without it there's no
 * honest bucket). Volume without competition → volume-only banding, since
 * demand tiers alone still separate head from tail.
 */
export function computeBucket(avgSearches: number | null, competition: number | null): Bucket {
  if (avgSearches == null) return "Unknown";
  if (avgSearches < VOLUME_FLOOR) return "Dead";
  if (avgSearches >= BEST_SELLER_SEARCHES) return "Best Seller";
  if (competition != null && competition > COMPETITION_HIGH) return "Best Seller";
  if (avgSearches >= REACH_SEARCHES) return "Reach";
  if (competition != null && competition >= COMPETITION_LOW) return "Reach";
  return "Visibility";
}

/** Stale = numbers pulled more than STALE_AFTER_DAYS ago (or never dated). */
export function isStaleKeyword(pulledAt: string | null | undefined, now = new Date()): boolean {
  if (!pulledAt) return true;
  const pulled = new Date(pulledAt).getTime();
  return Number.isNaN(pulled) || now.getTime() - pulled > STALE_AFTER_DAYS * 86_400_000;
}
