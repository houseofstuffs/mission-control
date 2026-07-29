/**
 * Keyword/SEO tunables — every threshold in one place so behavior is
 * adjustable without touching logic.
 */

/** avg searches below this → Dead, regardless of competition */
export const VOLUME_FLOOR = 100;
/** competition below this → Visibility */
export const COMPETITION_LOW = 10_000;
/** competition above this → Best Seller; between LOW and HIGH → Reach */
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
 * The bucketing rule. Null metrics → Unknown — a keyword without numbers is
 * unmeasured, not dead; null is never treated as 0.
 */
export function computeBucket(avgSearches: number | null, competition: number | null): Bucket {
  if (avgSearches == null || competition == null) return "Unknown";
  if (avgSearches < VOLUME_FLOOR) return "Dead";
  if (competition < COMPETITION_LOW) return "Visibility";
  if (competition > COMPETITION_HIGH) return "Best Seller";
  return "Reach";
}

/** Stale = numbers pulled more than STALE_AFTER_DAYS ago (or never dated). */
export function isStaleKeyword(pulledAt: string | null | undefined, now = new Date()): boolean {
  if (!pulledAt) return true;
  const pulled = new Date(pulledAt).getTime();
  return Number.isNaN(pulled) || now.getTime() - pulled > STALE_AFTER_DAYS * 86_400_000;
}
