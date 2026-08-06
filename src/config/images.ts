/**
 * Image-slot tunables. Etsy raised the photo cap from 10 to 20 in Aug 2025
 * (plus one video slot) — MAX_IMAGES stays config, not hardcode, in case it
 * moves again. 20 is a ceiling, not a quota: MIN_RECOMMENDED_IMAGES is the
 * advisory floor.
 */

export const MAX_IMAGES = 20;
export const MIN_RECOMMENDED_IMAGES = 7;

/** The JOB a slot does. Orthogonal to shot type — never nested. */
export const BUCKETS = ["Sell Design", "Sell Belief", "Sell Specifics"] as const;
export type ImageBucket = (typeof BUCKETS)[number];

/**
 * HOW a slot is rendered. Independent of bucket: a closeup print can sell
 * the design (artwork detail) or sell belief (print quality).
 */
export const SHOT_TYPES = [
  "Artwork Only",      // design on flat/transparent bg, no garment
  "Flat Lay",          // garment laid flat, whole, no props
  "Flat Lay Styled",   // flat lay with props/scene
  // split so a listing can show BOTH and tell them apart; bare "On
  // Model" remains a valid legacy value on existing records (Send
  // matches by string equality, so legacy still pairs with legacy)
  "On Model — Female", // worn by a female model
  "On Model — Male",   // worn by a male model
  "Ghost Mannequin",   // invisible-mannequin form shot
  "Hanging",           // on hanger
  "Folded",            // folded/stacked
  "Closeup Print",     // macro of print detail, texture, ink
  "Closeup Fabric",    // macro of material/weave/stitching
  "Lifestyle Scene",   // garment in context, not necessarily worn
  "Grid Composite",    // multiple variants/colors in one image
  "Graphic Card",      // text-based: size chart, care, color chart, personalisation howto
  "Video",             // the single video slot
] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

/**
 * Planned → Source mockup → Designing → Made → Placed.
 * "Source mockup" (red) = blocked on something external — a mockup set
 * that has to be bought/imported before work can continue. "Designing"
 * (amber) = actively in progress (a live Canva file). Both are purely
 * informational: gates and readiness counts read Made/Placed only.
 */
export const SLOT_STATUSES = ["Planned", "Source mockup", "Designing", "Made", "Placed"] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

/** The three Product-level reusable graphics an L5 slot can pull from — exact match to the Notion select options on image_slots' "Product Link Role". */
export const PRODUCT_LINK_ROLES = ["Highlights & Sizing", "Care & Policies", "Colorways"] as const;
export type ProductLinkRole = (typeof PRODUCT_LINK_ROLES)[number];

export interface SeedSlot {
  position: number;
  label: string;
  bucket: ImageBucket;
  shotType: ShotType;
  /** ties this slot to a Product-level reusable graphic, auto-filled at seed time and by the Refresh from Product button — never regenerated per listing */
  productLink?: ProductLinkRole;
}

/**
 * Single-variant seed — 20 named slots, no buffer left once the three
 * graphic-card additions below land (was 17 of 20; adding colorways, video
 * and announcement uses the rest). Every slot stays deletable per listing —
 * this is the default plan, not a quota. Position 1 is the search thumbnail.
 */
export const SINGLE_SEED: SeedSlot[] = [
  { position: 1, label: "hero — best-selling color", bucket: "Sell Design", shotType: "On Model — Female" },
  { position: 2, label: "artwork detail", bucket: "Sell Design", shotType: "Artwork Only" },
  { position: 3, label: "colorway", bucket: "Sell Design", shotType: "Flat Lay" },
  { position: 4, label: "colorway", bucket: "Sell Design", shotType: "Flat Lay" },
  { position: 5, label: "colorway", bucket: "Sell Design", shotType: "Flat Lay" },
  { position: 6, label: "colorway", bucket: "Sell Design", shotType: "Flat Lay" },
  { position: 7, label: "colorway", bucket: "Sell Design", shotType: "Flat Lay" },
  { position: 8, label: "lifestyle", bucket: "Sell Belief", shotType: "On Model — Female" },
  { position: 9, label: "lifestyle", bucket: "Sell Belief", shotType: "Lifestyle Scene" },
  { position: 10, label: "lifestyle", bucket: "Sell Belief", shotType: "On Model — Female" },
  { position: 11, label: "scale + fit", bucket: "Sell Belief", shotType: "On Model — Female" },
  { position: 12, label: "print detail", bucket: "Sell Belief", shotType: "Closeup Print" },
  { position: 13, label: "fabric detail", bucket: "Sell Belief", shotType: "Closeup Fabric" },
  { position: 14, label: "objection", bucket: "Sell Belief", shotType: "Closeup Fabric" },
  { position: 15, label: "color grid", bucket: "Sell Design", shotType: "Grid Composite" },
  { position: 16, label: "size chart", bucket: "Sell Specifics", shotType: "Graphic Card", productLink: "Highlights & Sizing" },
  { position: 17, label: "care info", bucket: "Sell Specifics", shotType: "Graphic Card", productLink: "Care & Policies" },
  { position: 18, label: "colorways", bucket: "Sell Specifics", shotType: "Graphic Card", productLink: "Colorways" },
  { position: 19, label: "video", bucket: "Sell Belief", shotType: "Video" },
  // design-specific — never pulled from a Product, filled in by hand per listing
  { position: 20, label: "announcement", bucket: "Sell Specifics", shotType: "Graphic Card" },
];

/**
 * Multi-variant seed — the hero sells the CONCEPT, never one name. Guidance
 * rule: show the SYSTEM plus 2-3 examples; never spend slots on repeated
 * name variations.
 */
export const MULTI_SEED: SeedSlot[] = [
  { position: 1, label: "hero — the concept, not one name", bucket: "Sell Design", shotType: "Grid Composite" },
  { position: 2, label: "variant range", bucket: "Sell Design", shotType: "Grid Composite" },
  { position: 3, label: "garment compare (tee vs sweatshirt)", bucket: "Sell Design", shotType: "Flat Lay" },
  { position: 4, label: "colorway", bucket: "Sell Design", shotType: "Flat Lay" },
  { position: 5, label: "colorway", bucket: "Sell Design", shotType: "Flat Lay" },
  { position: 6, label: "colorway", bucket: "Sell Design", shotType: "Flat Lay" },
  { position: 7, label: "colorway", bucket: "Sell Design", shotType: "Flat Lay" },
  { position: 8, label: "colorway", bucket: "Sell Design", shotType: "Flat Lay" },
  { position: 9, label: "lifestyle", bucket: "Sell Belief", shotType: "On Model — Female" },
  { position: 10, label: "lifestyle", bucket: "Sell Belief", shotType: "On Model — Female" },
  { position: 11, label: "lifestyle", bucket: "Sell Belief", shotType: "On Model — Female" },
  { position: 12, label: "scale + fit", bucket: "Sell Belief", shotType: "On Model — Female" },
  { position: 13, label: "print detail", bucket: "Sell Belief", shotType: "Closeup Print" },
  { position: 14, label: "fabric detail", bucket: "Sell Belief", shotType: "Closeup Fabric" },
  { position: 15, label: "personalisation — how to submit custom text", bucket: "Sell Specifics", shotType: "Graphic Card" },
  { position: 16, label: "size chart", bucket: "Sell Specifics", shotType: "Graphic Card", productLink: "Highlights & Sizing" },
  { position: 17, label: "care info", bucket: "Sell Specifics", shotType: "Graphic Card", productLink: "Care & Policies" },
  // usable per listing, not forced — a complex multi-garment bundle may
  // replace this with one hand-compiled graphic instead (still just an
  // editable slot either way)
  { position: 18, label: "colorways", bucket: "Sell Specifics", shotType: "Graphic Card", productLink: "Colorways" },
  { position: 19, label: "video", bucket: "Sell Belief", shotType: "Video" },
  // design-specific — never pulled from a Product, filled in by hand per listing
  { position: 20, label: "announcement", bucket: "Sell Specifics", shotType: "Graphic Card" },
];
