/**
 * Standing constraints appended to every image-generation prompt.
 *
 * A copy-paste aid for Kittl, NOT an API call and never auto-injected — the
 * generation happens in an external tool, so this exists to be copied.
 *
 * Why these two rules: a magenta ground gives the background knockout an
 * unambiguous colour to remove, and near-black instead of pure black survives
 * that knockout (pure black gets eaten, and it forces dark-garment-only
 * compatibility). Every element carrying its own opaque fill is what stops
 * shapes falling apart once the background is gone.
 */
export const STANDING_PROMPT_CONSTRAINTS = `BACKGROUND: Place the artwork on a flat, solid magenta (#FF00FF) background.
This color must appear NOWHERE in the artwork itself.

LINEWORK & DETAIL: Do not use pure black (#000000) anywhere in the design.
All outlines, linework, shading, pupils, spots, and interior detail must be
drawn in dark warm charcoal-brown (#241C14). Every element must have its own
opaque fill color — no element may rely on the background showing through to
form part of its shape.`;

/** Garment compatibility — how the artwork constrains which garments it can print on. */
export const GARMENT_COMPATIBILITY = ["Any", "Dark only", "Light only", "Unset"] as const;
export type GarmentCompatibility = (typeof GARMENT_COMPATIBILITY)[number];

/** Colourway slots to seed per compatibility (spec §3): constrained = fewer. */
export const COLORWAY_SLOTS: Record<string, number> = {
  Any: 5,
  "Dark only": 2,
  "Light only": 2,
  Unset: 5, // seeded as Any, but the step gets flagged
};

/* ---------- variant filtering ---------- */

/**
 * Colour names read as light or dark. Printify variant colours are free text
 * ("Sport Grey", "Heather Dust", "Military Green"), so this is word matching,
 * not colour science — anything unrecognised returns null and is never
 * excluded. Erring toward "show it" keeps a bad word list from hiding
 * variants silently.
 */
const LIGHT_WORDS = [
  "white", "natural", "ivory", "cream", "sand", "bone", "ash", "silver",
  "light", "pale", "pastel", "banana", "butter", "lemon", "yellow", "peach",
  "blush", "pink", "mint", "sky", "powder", "khaki", "beige", "tan", "dust",
  "oatmeal", "sport grey", "sports grey", "heather grey", "heather gray",
  "athletic heather", "soft", "lilac", "lavender",
];
const DARK_WORDS = [
  "black", "navy", "charcoal", "forest", "maroon", "burgundy", "wine",
  "espresso", "chocolate", "brown", "olive", "military", "hunter", "dark",
  "deep", "midnight", "graphite", "slate", "indigo", "royal", "purple",
  "red", "cardinal", "true navy", "gunmetal", "asphalt", "storm", "moss",
];

export type ColorFamily = "light" | "dark";

/** Which family a variant colour reads as, or null when it can't be told. */
export function colorFamily(name: string): ColorFamily | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const dark = DARK_WORDS.some((w) => n.includes(w));
  const light = LIGHT_WORDS.some((w) => n.includes(w));
  if (dark === light) return null; // both or neither — not our call
  return dark ? "dark" : "light";
}

/**
 * Whether a variant colour is allowed under this compatibility. Unset and Any
 * allow everything; unrecognised colours are always allowed (see above).
 */
export function variantAllowed(compat: string, colorName: string): boolean {
  if (compat !== "Dark only" && compat !== "Light only") return true;
  const fam = colorFamily(colorName);
  if (!fam) return true;
  return compat === "Dark only" ? fam === "dark" : fam === "light";
}

/* ---------- print-file pre-flight thresholds ---------- */

/** Below this share of solidly-opaque pixels, texture is probably riding on alpha. */
export const MIN_OPAQUE_SHARE = 0.5;
/** Alpha at or above this counts as solidly opaque. */
export const OPAQUE_ALPHA = 240;
/** Above this share of pure #000000, knockout will eat linework. */
export const MAX_PURE_BLACK_SHARE = 0.01;
/** Long edge below this is too small for a print file. */
export const MIN_LONG_EDGE = 4500;
