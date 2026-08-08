/**
 * STUFFS Mission Control — Notion schema, designed fresh from the project spec.
 *
 * Notion is the system of record (spec §2.1). This file is the single source
 * of truth for every database: the provisioning script creates them from it,
 * and the generic property mappers read/write against it.
 *
 * The schema is shaped to RECEIVE Printify data first (spec: rebuild from the
 * Printify-seed starting point): Products are keyed blueprint × print provider
 * (§3.3), variants are first-class records, and print areas / costs land in
 * dedicated fields. User-owned objects (Collections, Sections, Brand,
 * Expenses) are layered on top.
 *
 * External IDs are stored on every synced record — non-negotiable (§10).
 */

import { GARMENT_COMPATIBILITY } from "@/config/design-prompt";
import { CATEGORIES } from "@/config/product-categories";
import { PIPELINE_TYPES, BLEND_MODES, FIT_MODES, SURFACE_TAGS } from "@/config/mockups";
import { MOMENTUM_OPTIONS } from "@/config/momentum";

export type PropType =
  | "title"
  | "rich_text"
  | "number"
  | "select"
  | "multi_select"
  | "checkbox"
  | "url"
  | "date"
  | "files"
  | "relation"
  | "created_time"
  | "formula";

export interface PropSpec {
  type: PropType;
  /** Pre-seeded select/multi_select options (Notion adds more on write). */
  options?: string[];
  /** For relations: the `key` of the target database in this schema. */
  relation?: string;
  /** For formulas: the Notion formula expression. Read-only at runtime. */
  expression?: string;
}

export interface DbSpec {
  key: string;
  title: string;
  description: string;
  properties: Record<string, PropSpec>;
}

/** Creative + listing workflow step options, kept in sync with lib/workflows. */
// Creative is C1–C9: two pairs merged and uprez+knockout moved ahead of
// Texture. C10/C11 stay listed so any historical record still resolves.
const CREATIVE_STEPS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "Done"];
// L6 retired — existing records' select options survive in Notion; the
// step engine auto-advances anything still parked there (RETIRED_STEPS)
const LISTING_STEPS = ["L1", "L2", "L3", "L4", "L5", "L7", "Pushed"];

const OCCASIONS = [
  "Halloween", "Christmas", "Valentine's Day", "Mother's Day", "Father's Day",
  "Easter", "St. Patrick's Day", "Thanksgiving", "Graduation", "None",
];

/**
 * Databases in provisioning order — relations only point at databases that
 * appear earlier in this list. Self-relations (Etsy Listings → parent) are
 * patched in a second pass by the provisioner.
 */
export const SCHEMA: DbSpec[] = [
  {
    key: "brand",
    title: "Brand",
    description:
      "Shop identity — visual tokens, logo, graphic templates, verbal voice. Single record. Source for both interface and branded listing graphics.",
    properties: {
      Name: { type: "title" },
      "Visual Tokens (JSON)": { type: "rich_text" },
      "Logo Links": { type: "rich_text" },
      "Logo Files": { type: "files" },
      "Verbal Voice": { type: "rich_text" },
      "Graphic Templates": { type: "rich_text" },
      Notes: { type: "rich_text" },
    },
  },
  {
    key: "expenses",
    title: "Expenses",
    description:
      "Subscriptions, asset purchases, sample orders. Manual entry — no API has these. Capture starts now; records can't be recovered later.",
    properties: {
      Name: { type: "title" },
      Category: {
        type: "select",
        options: ["Subscription", "Asset purchase", "Sample order", "Fee", "Other"],
      },
      Amount: { type: "number" },
      Currency: { type: "select", options: ["USD"] },
      Date: { type: "date" },
      Recurring: { type: "select", options: ["One-off", "Monthly", "Yearly"] },
      Vendor: { type: "rich_text" },
      Notes: { type: "rich_text" },
    },
  },
  {
    key: "shop_sections",
    title: "Shop Sections",
    description:
      "Etsy navigation — merchandising only, capped at 20. Section by buyer browsing behavior, not by collection. Seasonal reassignment happens at season END while listings are dormant.",
    properties: {
      Name: { type: "title" },
      "Section Type": { type: "select", options: ["Enduring interest", "Seasonal window"] },
      "Season Start": { type: "date" },
      "Season End": { type: "date" },
      "Etsy Section ID": { type: "rich_text" },
      Notes: { type: "rich_text" },
    },
  },
  {
    key: "collections",
    title: "Collections",
    description:
      "Creative groupings — shared style, palette, subject. Internal; spans listings. Palette and type are locked WITHIN a series only, never shop-wide.",
    properties: {
      Name: { type: "title" },
      Description: { type: "rich_text" },
      "Palette Lock": { type: "rich_text" },
      "Type Lock": { type: "rich_text" },
      Status: { type: "select", options: ["Active", "Retired"] },
    },
  },
  {
    key: "niches",
    title: "Niches",
    description:
      "Evaluated micro-niches with evidence and a gate decision (greenlit / parked / killed). The curated keyword bank here is what reaches listing titles — the reason the research workflow exists.",
    properties: {
      Name: { type: "title" },
      Gate: { type: "select", options: ["Unevaluated", "Greenlit", "Parked", "Killed"] },
      "Gate Reason": { type: "rich_text" },
      "Beat Thesis": { type: "rich_text" },
      Buyer: { type: "rich_text" },
      "Purchase Motivation": { type: "select", options: ["Gift", "Identity", "In-joke", "Mixed"] },
      "Saturation Read": { type: "rich_text" },
      "Conversion Diagnostic": { type: "rich_text" },
      "Seed Keywords": { type: "rich_text" },
      "Curated Keyword Bank": { type: "rich_text" },
      "Community Fit": { type: "select", options: ["In it", "Could join", "Tourist"] },
      // "Product Fit" (relation → products) is added in provisioning pass 2 —
      // Products is created after Niches. Free text covers what isn't seeded.
      "Other Products": { type: "rich_text" },
      "Screenable Phrases": { type: "rich_text" },
      "Screening Status": {
        type: "select",
        options: ["Not screened", "Phrases emitted", "Screened clear", "Screened flagged"],
      },
      Evidence: { type: "files" },
      "Evaluated At": { type: "date" },
    },
  },
  {
    key: "ideas",
    title: "Ideas",
    description:
      "Inbox items — photos, screengrabs, clipped URLs, scraps of copy. Most die; lightweight by design. Ideas do not become Designs until greenlit.",
    properties: {
      Name: { type: "title" },
      Status: { type: "select", options: ["Inbox", "Triaged", "Promoted", "Discarded"] },
      "Capture Type": { type: "select", options: ["Photo", "Screengrab", "URL", "Copy"] },
      "Source URL": { type: "url" },
      Image: { type: "files" },
      Note: { type: "rich_text" },
      // Capture-time trademark pre-screen for copy ideas — advisory early
      // warning, never a gate; the real screen (R5/L6) still applies.
      "Trademark Risk": { type: "select", options: ["Clear", "Caution", "High"] },
      "Risk Reason": { type: "rich_text" },
      Occasion: { type: "select", options: OCCASIONS },
      "Occasion Date": { type: "date" },
      "Lead Time Days": { type: "number" },
      "Enter Creative By": { type: "date" },
      Niche: { type: "relation", relation: "niches" },
      "Captured At": { type: "created_time" },
    },
  },
  {
    key: "styles",
    title: "Styles",
    description:
      "Captured aesthetics — subject-independent by design. Description, composition skeleton, named slots, reusable prompt, print-suitability constraint on eligible products.",
    properties: {
      Name: { type: "title" },
      // Aesthetic bucket — the range Explore mode works across (§9.2).
      Category: {
        type: "select",
        options: ["Humor", "Minimalist", "Retro", "Illustrative", "Moody"],
      },
      Description: { type: "rich_text" },
      // Layout skeleton in slot terms, separate from surface treatment: a
      // reference is often being borrowed for its arrangement, not its subject.
      Composition: { type: "rich_text" },
      // The slots this style expects, in fill order — the fill-in fields when
      // a style is combined with an idea's content at C1.
      Slots: { type: "rich_text" },
      Typography: { type: "rich_text" },
      "Keyword Bank": { type: "rich_text" },
      // Image and type prompts stay separate: C2 generates artwork, C3 sets
      // lettering as a Kittl layer wherever spelling matters.
      "Reusable Prompt": { type: "rich_text" },
      "Type Prompt": { type: "rich_text" },
      // Print suitability is per-product, not one verdict — these three lists
      // are what constrains which blueprints a style may use at R6.
      "Prints Beautifully On": { type: "rich_text" },
      "Works With Tweaks On": { type: "rich_text" },
      "Avoid On": { type: "rich_text" },
      "Rule of Thumb": { type: "rich_text" },
      "Print Suitability": {
        type: "select",
        options: ["Prints beautifully", "Prints with tweaks", "Avoid"],
      },
      "Source Image": { type: "files" },
      Notes: { type: "rich_text" },
    },
  },
  {
    key: "textures",
    title: "Textures",
    description:
      "Texture references — Kittl (thumbnail only, no API) or owned files (real composites possible). Usage is derived from Design relations, not hand-maintained.",
    properties: {
      Name: { type: "title" },
      Source: { type: "select", options: ["Kittl", "Owned file"] },
      "File Link": { type: "url" },
      File: { type: "files" },
      License: { type: "rich_text" },
      "Semantic Tags": { type: "rich_text" },
      Notes: { type: "rich_text" },
    },
  },
  {
    key: "mockup_shots",
    title: "Mockup Shots",
    description:
      "Groups the garment-colour variants of one physical photo shoot (e.g. 'CC1466 Model 1' across black/navy/heather) so one crop rectangle applies to every colour in the batch, decided once and reused. The crop runs client-side against each photo's full-resolution original BEFORE the browser's normal upload downscale ever touches it (src/lib/mockupCrop.ts) — this app never stores the pre-crop original, so changing an existing shot's framing means re-uploading its source photos again, not editing a saved asset.",
    properties: {
      Name: { type: "title" },
      // {x, y, size} normalized 0–1, always square — set once, applied to
      // every colour already in the batch and every one added later.
      "Crop Rect (JSON)": { type: "rich_text" },
      // The garment's printable zone, drawn once at template definition on
      // the CROPPED sample — every variant created under this template
      // starts from it, so "Re-place corners" per colour stops being a
      // mandatory chore and becomes a correction.
      "Print Region Quad (JSON)": { type: "rich_text" },
      // HOW this shoot renders — same list the L5 slots use, because it's
      // the join key: Send matches render → slot by shot type. Required at
      // creation; a template without one silently broke Send for every
      // colour at once (same failure class as the missing Product).
      // Import and Re-sync stamp it down onto every variant.
      "Shot Type": {
        type: "select",
        options: [
          "Artwork Only", "Flat Lay", "Flat Lay Styled",
          "On Model — Female", "On Model — Male", "On Model", // bare On Model = legacy
          "Ghost Mannequin", "Hanging", "Folded", "Closeup Print", "Closeup Fabric",
          "Lifestyle Scene", "Grid Composite", "Graphic Card", "Video",
        ],
      },
      // The cropped sample the geometry was drawn on, preview-sized. Kept
      // as the template's card thumbnail — text-only cards stop being
      // tellable apart around the fourth template.
      "Sample Image": { type: "files" },
      // Where this template's colour photos live. Remembered so the Drive
      // auto-import (pending Google OAuth) can list the folder and detect
      // colours from filenames without any manual dropping.
      "Drive Folder Link": { type: "url" },
      // "Product" (relation → products) is added in provisioning pass 2 —
      // Products is created after Mockup Shots, and an inline forward
      // reference here made the patch step fail with "Relation target
      // 'products' not provisioned yet" on every run, not just the first.
      "Crop Set At": { type: "date" },
      // Set by hand after actually looking at a real multi-colour batch —
      // this app can't detect framing drift between photos on its own.
      "Framing Flagged": { type: "checkbox" },
      "Framing Notes": { type: "rich_text" },
    },
  },
  {
    key: "mockup_templates",
    title: "Mockup Templates",
    description:
      "Purchased or collected mockup templates. Usage and license tracked. Pipeline Type is chosen once at intake and decides both the intake fields and the compositing method — render never asks.",
    properties: {
      Name: { type: "title" },
      Source: { type: "rich_text" },
      License: { type: "rich_text" },
      "File Link": { type: "url" },
      "Product Types": { type: "rich_text" },
      // Set only by the batch shot-crop flow — links this colour variant to
      // the shot whose shared crop rectangle produced its Base Image.
      Shot: { type: "relation", relation: "mockup_shots" },
      // The one decision that branches everything: which fields intake asks
      // for, and which compositing method render runs.
      "Pipeline Type": { type: "select", options: [...PIPELINE_TYPES] },
      // Required for BOTH pipelines — the photo everything lands on.
      "Base Image": { type: "files" },
      // Where the Base Image CAME FROM — the Drive file id and the
      // normalized crop that produced it. This pair is what makes
      // "Adjust crop" possible: re-crop the original source and REPLACE
      // the stored file (one-time, persisted — never a render-time
      // transform), so a variant framed off from its batch is fixed once
      // for every future listing. Variants imported before this existed
      // have neither; the adjust flow asks for the source link instead.
      "Source Drive File": { type: "rich_text" },
      "Source Crop Rect (JSON)": { type: "rich_text" },
      // Required ONLY for Full Displacement; unused under Simple Placement.
      "Displacement Map": { type: "files" },
      // Optional even under Full Displacement — composited only if present,
      // skipped silently if not. Many sources don't ship them.
      "Shadow Layer": { type: "files" },
      "Highlight Layer": { type: "files" },
      // Four corners, normalized 0–1, TL→TR→BR→BL. Required for Simple
      // Placement (the corner-placement step); optional crop guide under
      // Full Displacement.
      "Print Area Quad (JSON)": { type: "rich_text" },
      // Simple Placement's composite step. Multiply sinks ink into fabric.
      "Blend Mode": { type: "select", options: [...BLEND_MODES] },
      // How artwork meets the print area when ratios disagree: whole-and-
      // letterboxed (garments) or edge-to-edge with overflow cropped
      // (die-cuts, full-bleed). Never stretched, in either mode.
      Fit: { type: "select", options: [...FIT_MODES] },
      // OPTIONAL metadata. One template serves every colourway of its
      // product — the photo LAYOUT is the template; garment colour is a
      // per-render variable, and compatibility filtering happens at the
      // colourway level. Set only for templates genuinely colour-locked.
      Surface: { type: "select", options: [...SURFACE_TAGS] },
      // Which colour the base PHOTO shows, as Printify names it ("Pepper").
      // Until per-template colour variables exist, a template is offered to
      // a listing only when this colour is one the listing sells (empty =
      // colour-neutral, always offered). Free text: Printify's colour
      // vocabulary is enormous.
      "Garment Color": { type: "rich_text" },
      // How this template renders — auto-fills the slot's shot type when the
      // template is chosen (slot value set beforehand = the plan).
      "Shot Type": {
        type: "select",
        options: [
          "Artwork Only", "Flat Lay", "Flat Lay Styled",
          "On Model — Female", "On Model — Male", "On Model", // bare On Model = legacy
          "Ghost Mannequin", "Hanging", "Folded", "Closeup Print", "Closeup Fabric",
          "Lifestyle Scene", "Grid Composite", "Graphic Card", "Video",
        ],
      },
      Notes: { type: "rich_text" },
    },
  },
  {
    key: "shipping_profiles",
    title: "Shipping Profiles",
    description:
      "Mirrors Etsy's own Shipping Profiles (Shop Manager → Settings → Shipping settings) — read-only, pulled via the Etsy OAuth connection, never written back. Etsy owns these records the same way Printify owns the catalog data Products mirrors; this cache exists so a Product can point at one and the L3 calculator can pre-fill SHIPPING CHARGED from it. Etsy's ShippingProfile object went through a processing-time migration shortly before this was built (min/max processing days moved to a separate Processing Profile resource) — the lifted fields below are the ones confirmed stable; Raw Profile (JSON) carries everything else so nothing pulled is ever lost to a wrong guess about field names.",
    properties: {
      Name: { type: "title" },
      "Etsy Shipping Profile ID": { type: "number" },
      "Origin Country": { type: "rich_text" },
      "Domestic Handling Fee": { type: "number" },
      "International Handling Fee": { type: "number" },
      // One row per destination — country, buyer-facing cost, delivery
      // window. Etsy exposes destinations as a sub-resource, not embedded
      // on the profile itself.
      "Destinations (JSON)": { type: "rich_text" },
      "Raw Profile (JSON)": { type: "rich_text" },
      "Synced At": { type: "date" },
    },
  },
  {
    key: "products",
    title: "Products",
    description:
      "Blueprint × print provider pairs — NOT product types (§3.3). Auto-seeded from the Printify catalog with specs, costs and print areas. Two copy fields, never merged: vendor_text_raw is the Printify original and is never overwritten; shop_voice_text is the rewrite, cached here at Product level.",
    properties: {
      Name: { type: "title" },
      // Optional override for the dashboard headline; blank = derived from
      // brand + product type + model.
      "Short Name": { type: "rich_text" },
      "Printify Blueprint ID": { type: "number" },
      "Printify Print Provider ID": { type: "number" },
      "Blueprint Title": { type: "rich_text" },
      "Blueprint Brand": { type: "rich_text" },
      "Blueprint Model": { type: "rich_text" },
      "Print Provider Name": { type: "rich_text" },
      // Printify's catalog photo for the blueprint — the card thumbnail.
      // A CDN link, not a stored file: their image, their hosting.
      "Blueprint Image": { type: "url" },
      // Not in Printify's public API — set once per product from their UI.
      "Print Technique": {
        type: "select",
        options: ["DTG", "DTF", "Sublimation", "Embroidery", "Screen print", "UV printing", "Laser engraving", "Other"],
      },
      "Physical/Digital": { type: "select", options: ["Physical", "Digital"] },
      // Groups the Products view and picks the cost-averaging rule. Auto-mapped
      // from the blueprint title at seed (src/config/product-categories.ts);
      // no default — an unmatched product asks to be categorised by hand.
      Category: { type: "select", options: [...CATEGORIES] },
      "Print Areas (JSON)": { type: "rich_text" },
      "Max Print Width px": { type: "number" },
      "Max Print Height px": { type: "number" },
      // Physical size is DERIVED: inches = px / DPI, one input instead of
      // two hand-copied numbers that can be misread (the "22.25 in" that
      // turned out to be the 22:25 aspect RATIO). Printify placeholders
      // are px at print resolution — 300 DPI for DTG apparel, and
      // 4200×4800 @ 300 = 14×16 in, the standard sweatshirt platen, which
      // is the sanity check. Blank = 300 assumed, and the readouts SAY
      // "assumed"; set it only when a provider genuinely differs.
      "Print DPI": { type: "number" },
      "Aspect Ratios": { type: "rich_text" },
      "Recomposition Flag": { type: "checkbox" },
      "Base Cost Min": { type: "number" },
      "Base Cost Max": { type: "number" },
      // The single displayed cost, plus how it was produced — method and
      // count travel with the number so an average is never mistaken for a
      // representative size (or vice versa). Recomputed on seed, on category
      // change, on representative-variant change, and after a cost pull.
      "Estimated Cost": { type: "number" },
      "Estimated Cost Variant Count": { type: "number" },
      "Cost Calc Method": {
        type: "select",
        options: ["Core size average", "Representative size", "Full average"],
      },
      // Where the costs came from: Probe = temporary product created in the
      // shop to read account-level pricing, then deleted. Live product =
      // read off a real product once one exists.
      "Cost Source": { type: "select", options: ["Probe", "Live product"] },
      "Cost Pulled At": { type: "date" },
      // Per-variant costs from the probe, keyed by Printify Variant ID.
      // Stored on the product as JSON rather than as ~200 per-variant writes:
      // one throttled write instead of a five-minute sync per product. The
      // per-variant Base Cost field still wins when set by hand.
      "Variant Costs (JSON)": { type: "rich_text" },
      // What Printify bills to ship one unit, US domestic, first item in the
      // order — read from their catalog shipping endpoint (no shop needed,
      // unlike the cost probe). The L3 calculator pre-fills its SHIPPING
      // COST dial from this but always leaves it hand-overridable — this is
      // a default, not a locked number.
      "Estimated Shipping Cost": { type: "number" },
      "Shipping Cost Source": { type: "select", options: ["Printify catalog"] },
      "Shipping Pulled At": { type: "date" },
      // Which of the synced Etsy Shipping Profiles applies to this product —
      // set by hand (Etsy assigns a profile per LISTING, not per product, so
      // this is a default this app never overrides). The L3 calculator reads
      // this to pre-fill SHIPPING CHARGED the same way it already reads the
      // Printify pull for SHIPPING COST.
      "Etsy Shipping Profile": { type: "relation", relation: "shipping_profiles" },
      // Representative Variant relation is patched in provisioning pass 2 —
      // product_variants doesn't exist yet when products is created.
      Currency: { type: "select", options: ["USD"] },
      "Variant Count": { type: "number" },
      "Vendor Text Raw": { type: "rich_text" },
      "Shop Voice Text": { type: "rich_text" },
      // Reusable per-blueprint graphic cards — generated once, reused by
      // every listing on this product (same reuse pattern as Shop Voice
      // Text). L5 auto-fills the matching named slot from these; the
      // Refresh from Product button re-pulls them if added/changed after a
      // listing already exists.
      "Highlights & Sizing Graphic Link": { type: "url" },
      "Care & Policies Graphic Link": { type: "url" },
      "Colorways Graphic Link": { type: "url" },
      // When the shop-voice rewrite was generated/approved — a freshness
      // stamp, not a gate. Empty Shop Voice Text is what the badge reads.
      "Voice Generated At": { type: "date" },
      Status: { type: "select", options: ["Active", "Retired"] },
      "Synced At": { type: "date" },
    },
  },
  {
    key: "product_variants",
    title: "Product Variants",
    description:
      "Per-variant records from Printify — color, size, cost, per-variant print placeholders. Needed for variant-level design mapping on multi-product listings.",
    properties: {
      Name: { type: "title" },
      Product: { type: "relation", relation: "products" },
      "Printify Variant ID": { type: "number" },
      Color: { type: "select" },
      Size: { type: "select" },
      "Base Cost": { type: "number" },
      Currency: { type: "select", options: ["USD"] },
      Available: { type: "checkbox" },
      "Placeholders (JSON)": { type: "rich_text" },
      SKU: { type: "rich_text" },
    },
  },
  {
    key: "designs",
    title: "Designs",
    description:
      "The creative asset — artwork, PSD master, derivatives. Moves through the creative workflow C1–C9. The PSD is the master asset; every PNG is a disposable derivative. Files live in Drive/S3 — Notion stores links only.",
    properties: {
      Name: { type: "title" },
      "Current Step": { type: "select", options: CREATIVE_STEPS },
      "Step State (JSON)": { type: "rich_text" },
      "Has Stale": { type: "checkbox" },
      "Has Blocked": { type: "checkbox" },
      Niche: { type: "relation", relation: "niches" },
      Collection: { type: "relation", relation: "collections" },
      Style: { type: "relation", relation: "styles" },
      Texture: { type: "relation", relation: "textures" },
      "Primary Product": { type: "relation", relation: "products" },
      "Physical/Digital": { type: "select", options: ["Physical", "Digital"] },
      "Winning Model": { type: "select" },
      // C3 — how the lettering was actually produced. Generated-in-image is
      // the spelling-risk path; a live text layer is the safe one.
      "Text Source": {
        type: "select",
        options: [
          "Live text — Kittl",
          "Live text — PODSpy",
          "Generated in-image — Kittl",
          "Generated in-image — PODSpy",
          "Other",
        ],
      },
      "Text Detail": { type: "rich_text" },
      // C6 — how the chosen texture was applied (mask vs overlay, strength).
      // WHICH texture is the Texture relation below.
      "Texture Detail": { type: "rich_text" },
      Occasion: { type: "select", options: OCCASIONS },
      "Occasion Date": { type: "date" },
      "Lead Time Days": { type: "number" },
      "Target Publish Date": { type: "date" },
      "Actual Publish Date": { type: "date" },
      "Master Canvas (JSON)": { type: "rich_text" },
      // Lightweight preview of the selected generation (C2's output) —
      // powers Kanban thumbnails. The MASTER file lives in Drive/S3 (§3.6);
      // this is a snapshot, never the asset.
      "Artwork Snapshot": { type: "files" },
      // C1's output — the composed pair from Apply mode (style × subject).
      // Stored on the design so C2/C3 read from the record, not a chat log.
      "Image Prompt": { type: "rich_text" },
      "Text Prompt": { type: "rich_text" },
      // The C5 instruction: which texture, mask vs overlay, strength.
      // Generation stays flat; texture is a layer, never baked in.
      "Texture Note": { type: "rich_text" },
      // All composed style candidates (3-5 + suggested directions) — the
      // winner is chosen at C2 after real generations, not at C1.
      "Prompt Candidates (JSON)": { type: "rich_text" },
      "Master PNG Link": { type: "url" },
      "PSD Master Link": { type: "url" },
      "PSD Saved At": { type: "date" },
      // What the master was actually exported at — checked against the
      // product's print areas at C8. Artwork smaller than its print area
      // gets upscaled by Printify and prints soft.
      "Master Width": { type: "number" },
      "Master Height": { type: "number" },
      // Which garment colours this artwork can sit on. Set by hand at C8 —
      // no auto-detection, because "does this read on black" is a judgement.
      // Drives colourway slot seeding, the variant filter, and the L6 gate.
      // Absent reads as Unset everywhere.
      "Garment Compatibility": { type: "select", options: [...GARMENT_COMPATIBILITY] },
      "Garment Compatibility Reason": { type: "rich_text" },
      // C8 pre-flight — advisory only. Never blocks, never edits the file.
      // Keyword-research CSVs already folded into this design's pool —
      // [{file, source, rows, at}]. The research is design-level, so every
      // listing of the design reports the same import history.
      "Keyword Imports (JSON)": { type: "rich_text" },
      "Print File Checked": { type: "checkbox" },
      "Print File Check Notes": { type: "rich_text" },
      "Sample Ordered": { type: "checkbox" },
      "Sample ETA": { type: "date" },
      // VA workflow — nullable and invisible in v1 (§3.4)
      Assignee: { type: "rich_text" },
      "Review State": { type: "select", options: ["Draft", "In review", "Approved"] },
      // Second shop/channel becomes additive (§3.4)
      Shop: { type: "select", options: ["STUFFS"] },
      Channel: { type: "select", options: ["Etsy"] },
      // Reconciliation possible forever (§3.4)
      "External IDs (JSON)": { type: "rich_text" },
    },
  },
  {
    key: "etsy_listings",
    title: "Etsy Listings",
    description:
      "Market offerings referencing one or more Designs — named EtsyListing deliberately, not Listing (§2.7). Moves through listing workflow L1–L7. cost_at_creation is a snapshot, never a live lookup.",
    properties: {
      Name: { type: "title" },
      "Current Step": { type: "select", options: LISTING_STEPS },
      "Step State (JSON)": { type: "rich_text" },
      "Has Stale": { type: "checkbox" },
      "Has Blocked": { type: "checkbox" },
      "Etsy State": { type: "select", options: ["Not pushed", "Draft", "Active", "Inactive", "Expired"] },
      Designs: { type: "relation", relation: "designs" },
      "Variant Design Map (JSON)": { type: "rich_text" },
      // The colourways this listing actually sells (chosen in Printify at
      // L1) — the set mockup templates are filtered against. JSON array of
      // Printify colour names.
      "Colorways (JSON)": { type: "rich_text" },
      // The colours this listing actually generates MOCKUPS for — a subset
      // of Colorways (JSON). A shop can sell 8 colours but only shoot/mock
      // up 4 of them. Empty means "same as Colorways" (every sold colour
      // gets a mockup slot) rather than "none" — the L5 offered-template
      // filter treats blank as the sold-colours set, never as zero.
      "Mockup Colors (JSON)": { type: "rich_text" },
      // How THIS design sits inside the print region, at render time —
      // {"default": {scale,dx,dy,rot}, "perVariant": {variantId: {...}}}.
      // Listing-scoped by design: crop belongs to the variant, the quad
      // to the template, placement to the design being sold here.
      "Mockup Placement (JSON)": { type: "rich_text" },
      // Alternate design masters for SPECIFIC colours — {"espresso": link}.
      // Printify prints per-variant art within one listing, so a single
      // master can make a mockup factually wrong (dark-version eyes that
      // don't register on Espresso). Colours not listed here use the
      // design's Master PNG Link; the generate job resolves per tile.
      "Per-Colour Art (JSON)": { type: "rich_text" },
      // Keyword ids ✕'d off the L2 shortlist — "not for this listing",
      // persisted so the shortlist doesn't re-offer them every visit.
      // They stay in the bank and the full pool; picking one from
      // "Show all" un-dismisses it.
      "Dismissed Keywords (JSON)": { type: "rich_text" },
      // Customizable text (dad/mom/kid) or multiple garment types in one
      // listing — switches the image-slot seed and adds two publish gates.
      "Is Multi Variant": { type: "checkbox" },
      Product: { type: "relation", relation: "products" },
      // Which mockup templates THIS listing uses (L4's assignment). Drives
      // the generate plan and narrows L5's variant offers to
      // shortlist ∩ slot colour. Template-level (mockup_shots), not
      // per-colour — colours multiply automatically from Mockup Colors.
      "Template Shortlist": { type: "relation", relation: "mockup_shots" },
      "Shop Section": { type: "relation", relation: "shop_sections" },
      "Origin Type": {
        type: "select",
        options: ["New concept", "Bundle", "Variant of winner", "Seasonal reissue"],
      },
      // Parent Listing (self-relation) is patched in provisioning pass 2.
      "Physical/Digital": { type: "select", options: ["Physical", "Digital"] },
      Title: { type: "rich_text" },
      Tags: { type: "rich_text" },
      "Attributes (JSON)": { type: "rich_text" },
      "Description Hook": { type: "rich_text" },
      "Body Copy": { type: "rich_text" },
      Price: { type: "number" },
      "Cost At Creation": { type: "number" },
      "Cost Snapshot At": { type: "date" },
      "Cost Basis": { type: "select", options: ["Printify Standard", "Printify Premium"] },
      "Gate State (JSON)": { type: "rich_text" },
      "Trademark Screened": { type: "checkbox" },
      // when the attestation was given — screening happens outside the app
      // (eRank, USPTO by hand), so the app records the CLAIM and its date
      "Trademark Screened At": { type: "date" },
      // L3's other half. Etsy owns what a buyer is charged for shipping and
      // this app is draft-only, so it never writes the profile to Etsy —
      // confirming is the operator attesting the listing will carry the
      // Product's profile, which is what the publish gate reads.
      "Shipping Profile Confirmed": { type: "checkbox" },
      "Shipping Confirmed At": { type: "date" },
      "Published At": { type: "date" },
      "Expiry Date": { type: "date" },
      Shop: { type: "select", options: ["STUFFS"] },
      Channel: { type: "select", options: ["Etsy"] },
      "Etsy Listing ID": { type: "rich_text" },
      // L7's push record: when the copy bundle was applied to the Etsy
      // draft, and exactly what was sent (so a re-push warns with facts)
      "Pushed At": { type: "date" },
      "Push Snapshot (JSON)": { type: "rich_text" },
      "Printify Product ID": { type: "rich_text" },
      "External IDs (JSON)": { type: "rich_text" },
    },
  },
  {
    key: "change_log",
    title: "Change Log",
    description:
      "Append-only record of listing edits: what changed, when, why (§3.5). Notion's free plan keeps 7 days of history — this is the permanent record that makes sequential A/B testing possible.",
    properties: {
      Name: { type: "title" },
      Listing: { type: "relation", relation: "etsy_listings" },
      Field: { type: "rich_text" },
      "Old Value": { type: "rich_text" },
      "New Value": { type: "rich_text" },
      Why: { type: "rich_text" },
      "Changed At": { type: "date" },
    },
  },
  {
    key: "workflow_log",
    title: "Workflow Log",
    description:
      "Append-only step-runner events: step done, backtracks (which step, from where, why), still-valid confirmations, blocks. After ten designs this shows where the process leaks.",
    properties: {
      Name: { type: "title" },
      Design: { type: "relation", relation: "designs" },
      Listing: { type: "relation", relation: "etsy_listings" },
      Event: {
        type: "select",
        options: ["Step done", "Backtrack", "Still valid", "Blocked", "Unblocked", "Moved", "Created"],
      },
      "From Step": { type: "rich_text" },
      "To Step": { type: "rich_text" },
      // titles captured AT WRITE TIME so history survives step retirement
      // and id reuse (L6 is retired and may be reused — entries that say
      // "Publish gates" must say that forever)
      "From Step Title": { type: "rich_text" },
      "To Step Title": { type: "rich_text" },
      Reason: { type: "rich_text" },
      "Steps Marked Stale": { type: "rich_text" },
      At: { type: "date" },
    },
  },
  {
    key: "keywords",
    title: "Keywords",
    description:
      "SEO keyword bank. Bucket is computed from avg searches × competition (thresholds in src/config/keywords.ts) on write and on refresh — unless Bucket Manual Override is checked. Null metrics mean Unknown, never a default bucket. Manual entry in Phase 1; the eRank/Everbee CSV importer (Phase 2) maps into this same shape.",
    properties: {
      Keyword: { type: "title" },
      "Avg Searches": { type: "number" },
      "Avg Clicks": { type: "number" },
      "Etsy Competition": { type: "number" },
      // Live in Notion itself — the length rule can't drift from the data.
      "Char Count": { type: "formula", expression: 'length(prop("Keyword"))' },
      // Etsy hard-caps tags at 20 chars; longer keywords are title-only.
      "Tag Eligible": { type: "formula", expression: 'length(prop("Keyword")) <= 20' },
      Bucket: {
        type: "select",
        options: ["Visibility", "Reach", "Best Seller", "Dead", "Unknown"],
      },
      "Bucket Manual Override": { type: "checkbox" },
      Seasonality: { type: "select", options: ["Evergreen", "Seasonal", "Unknown"] },
      // Is this market selling NOW? Computed from listing-research CSV
      // imports (Everbee Product Analytics / eRank listings) — a label
      // BESIDE the bucket, never folded into it: buckets feed the publish
      // gate, momentum is context. Detail JSON keeps the lifetime numbers
      // so old data stays visible, just dated.
      Momentum: { type: "select", options: [...MOMENTUM_OPTIONS] },
      "Momentum Detail (JSON)": { type: "rich_text" },
      "Pulled At": { type: "date" },
      Source: { type: "select", options: ["eRank", "Everbee", "Manual"] },
      Notes: { type: "rich_text" },
      Designs: { type: "relation", relation: "designs" },
      Collections: { type: "relation", relation: "collections" },
      "Etsy Listings": { type: "relation", relation: "etsy_listings" },
    },
  },
  {
    key: "image_slots",
    title: "Image Slots",
    description:
      "Per-listing image plan — up to 20 ordered slots (Etsy's cap since Aug 2025, +1 video; MAX_IMAGES in src/config/images.ts). Bucket is the slot's JOB, Shot Type is HOW it renders — orthogonal, never nested. Position 1 is the search thumbnail. Seeded on listing creation; slots 18-20 stay empty by default.",
    properties: {
      Name: { type: "title" }, // the slot's label/purpose: hero, colorway, objection...
      Listing: { type: "relation", relation: "etsy_listings" },
      Position: { type: "number" },
      Bucket: { type: "select", options: ["Sell Design", "Sell Belief", "Sell Specifics"] },
      "Shot Type": {
        type: "select",
        options: [
          "Artwork Only", "Flat Lay", "Flat Lay Styled",
          "On Model — Female", "On Model — Male", "On Model", // bare On Model = legacy
          "Ghost Mannequin", "Hanging", "Folded", "Closeup Print", "Closeup Fabric",
          "Lifestyle Scene", "Grid Composite", "Graphic Card", "Video",
        ],
      },
      Status: { type: "select", options: ["Planned", "Source mockup", "Designing", "Made", "Placed"] },
      // The COLOUR a slot is for — set on the per-colour colorway slots the
      // seed derives from Mockup Colours ("colorway — espresso" carries
      // "Espresso"). Send matches on it: a render only lands in a coloured
      // slot when the colours agree. Blank = colour-agnostic slot.
      Colour: { type: "rich_text" },
      // link to the mockup/image file; empty = planned-not-yet-made
      "Asset Ref": { type: "url" },
      "Mockup Template": { type: "relation", relation: "mockup_templates" },
      Notes: { type: "rich_text" },
      // Set only on the slots seeded to pull from a Product-level reusable
      // graphic (blank on every other slot, including the per-listing
      // announcement card). Position and label are both freely edited per
      // listing, so this — not either of those — is what the Refresh from
      // Product button and the "(from Product)" badge key off of.
      "Product Link Role": {
        type: "select",
        options: ["Highlights & Sizing", "Care & Policies", "Colorways"],
      },
    },
  },
  {
    key: "design_derivatives",
    title: "Design Derivatives",
    description:
      "Per-product recompositions of a design's master (Phase 2). A derivative exists only once the recomposed file is actually made — at L1, where the Printify product needs its print file — never speculatively. Need is computed live (front print-area ratio deviating >12% from the master's shape, same bar as the C9 fan-out flag). Master changes mark derivatives Stale; the master itself is never a derivative, and files live in Drive/S3 — Notion stores links only (§3.6).",
    properties: {
      Name: { type: "title" },
      Design: { type: "relation", relation: "designs" },
      Product: { type: "relation", relation: "products" },
      Listing: { type: "relation", relation: "etsy_listings" },
      "File Link": { type: "url" },
      "Width px": { type: "number" },
      "Height px": { type: "number" },
      // Made = file exists and matches the current master. Stale = the
      // master changed after this was made — re-export before publishing.
      Status: { type: "select", options: ["Made", "Stale"] },
      "Made At": { type: "date" },
      Notes: { type: "rich_text" },
    },
  },
  {
    key: "generated_mockups",
    title: "Generated Mockups",
    description:
      "The compositor's output — one record per listing × variant render (a variant is already one colour). The image itself lives here as a Notion file; L5 slots reference it through the app's stable /api/generated-mockups/{id}/file route, which re-mints Notion's expiring URL on demand. Verdict is approve-by-default: the operator flags the misses. Regenerating replaces the record's image, never duplicates the record.",
    properties: {
      Name: { type: "title" },
      Listing: { type: "relation", relation: "etsy_listings" },
      Variant: { type: "relation", relation: "mockup_templates" },
      Colour: { type: "rich_text" },
      Image: { type: "files" },
      Verdict: { type: "select", options: ["Approved", "Flagged"] },
      "Generated At": { type: "date" },
      // set when the send step placed it into a slot — the record of where
      "Sent To Slot": { type: "relation", relation: "image_slots" },
    },
  },
];

/**
 * Relations patched after all databases exist (self-relations, or relations
 * pointing at databases created later in SCHEMA order). `dual` makes it a
 * two-way relation and names the reverse property on the target database.
 */
export const SECOND_PASS_RELATIONS: Array<{
  dbKey: string;
  propName: string;
  targetKey: string;
  dual?: string;
}> = [
  { dbKey: "etsy_listings", propName: "Parent Listing", targetKey: "etsy_listings" },
  // wall_art cost anchor: the ONE size whose cost is the estimate — poster
  // sizes are different products, not a range to average away.
  { dbKey: "products", propName: "Representative Variant", targetKey: "product_variants" },
  // Niche-level product-line fit: which seeded Products this niche wants.
  // Two-way so the Products side shows which niches point at it.
  { dbKey: "niches", propName: "Product Fit", targetKey: "products", dual: "Niche Fit" },
  // Which garment a mockup shoot was OF — L4's picker filters to the
  // listing's product. Forward reference (Products is created after
  // Mockup Shots), hence pass 2. Unset = shown for every listing.
  { dbKey: "mockup_shots", propName: "Product", targetKey: "products" },
];

/** Property renames applied during provisioning — content is preserved. */
export const RENAMED_PROPERTIES: Array<{ dbKey: string; from: string; to: string }> = [
  { dbKey: "niches", from: "Product Line Fit", to: "Other Products" },
  // Tool-agnostic naming: the artifact (a transparent master PNG), not the
  // tool it happens to live in today.
  { dbKey: "designs", from: "Artwork Link", to: "Master PNG Link" },
];

export const DB_KEYS = SCHEMA.map((d) => d.key);

export function getDbSpec(key: string): DbSpec {
  const spec = SCHEMA.find((d) => d.key === key);
  if (!spec) throw new Error(`Unknown database key: ${key}`);
  return spec;
}
