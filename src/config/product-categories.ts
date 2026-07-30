/**
 * Product categories — the grouping the Products view organises around, and
 * the switch that decides how estimated cost is averaged.
 *
 * Stored on the Product record as the raw key ("wall_art"), displayed through
 * CATEGORY_LABELS. Kept in config because Printify's blueprint titles will
 * need tuning over time — a miss here is cheap (the product just asks to be
 * categorised by hand), a wrong guess is not.
 */

export const CATEGORIES = ["apparel", "home", "wall_art", "misc"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Display order and names — fixed, and the order groups render in. */
export const CATEGORY_LABELS: Record<Category, string> = {
  apparel: "Apparel",
  home: "Home",
  wall_art: "Wall Art",
  misc: "Miscellaneous",
};

/**
 * Keywords matched against the blueprint title, first match wins.
 *
 * ORDER MATTERS. "All-Over Print T-Shirt" contains both "shirt" and "print";
 * apparel is checked first so it doesn't land in wall art.
 */
export const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  apparel: ["shirt", "sweatshirt", "hoodie", "tee", "crewneck"],
  home: ["mug", "tumbler", "blanket", "pillow", "coaster"],
  wall_art: ["poster", "canvas", "print", "banner"],
  misc: ["sticker", "decal"],
};

/**
 * Auto-assign a category from a blueprint title. Returns null when nothing
 * matches — the product is then flagged "needs category" rather than guessed.
 *
 * Matching requires a word boundary BEFORE the keyword, so "tee" hits "Tee"
 * and "Tees" but not "Steel Tumbler" or "Canteen". Suffixes are allowed
 * ("shirt" → "shirts"), which is why "sweatshirt" carries its own keyword —
 * there's no boundary before the "shirt" inside it.
 *
 * The brand is deliberately NOT matched: Bella+Canvas is a t-shirt company,
 * and "canvas" means wall art.
 */
export function categoryFromTitle(title: string): Category | null {
  const haystack = title.toLowerCase();
  for (const category of CATEGORIES) {
    for (const keyword of CATEGORY_KEYWORDS[category]) {
      if (new RegExp(`\\b${keyword}`).test(haystack)) return category;
    }
  }
  return null;
}

/** Narrow an arbitrary stored string to a Category, or null. */
export function asCategory(value: unknown): Category | null {
  return CATEGORIES.includes(value as Category) ? (value as Category) : null;
}
