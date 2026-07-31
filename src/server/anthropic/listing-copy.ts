/**
 * L2 listing-copy drafts — title, tags, description hook, attributes.
 *
 * Everything returned here is a DRAFT: the panel renders it editable and
 * nothing touches Notion until the operator saves each piece. The hook is
 * deliberately the ONLY description text generated per listing — fit/
 * fabric/care copy is product-level boilerplate (Shop Voice Text on the
 * Product record, generated once) and gets stitched under the hook at save
 * time, never re-generated per listing.
 */
import { anthropic, model } from "./client";
import { SHOP_VOICE } from "@/config/shop-voice";
import { TAG_MAX_CHARS, TAG_COUNT, TARGET_MIX } from "@/config/keywords";

export interface ListingCopyInput {
  designName: string;
  /** the lettering instruction / printed copy, when the design has any */
  printedCopy: string;
  nicheName: string;
  buyer: string;
  purchaseMotivation: string;
  styleName: string;
  /** the garment, e.g. "Comfort Colors SWEATSHIRT 1466" */
  productLabel: string;
  /** keywords the operator toggled ON, with their computed buckets */
  keywords: Array<{ name: string; bucket: string; tagEligible: boolean }>;
  /** existing values, so a regenerate can improve rather than ignore them */
  currentTitle: string;
  currentTags: string[];
}

export interface ListingCopyDraft {
  title: string;
  tags: string[];
  hook: string;
  attributes: Array<{ name: string; value: string }>;
  notes: string;
}

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        `The Etsy listing title: UNDER ${15} words (hard rule — count them), front-loading the strongest Visibility-bucket keyword as the opening phrase, readable as a sentence a person would type into Etsy search, not a keyword pile. Name the product type.`,
    },
    // NOTE: no maxItems/maxLength here — the structured-output validator
    // rejects them ("property 'maxItems' is not supported"). The caps are
    // enforced in the prompt text and again in the post-filter below.
    tags: {
      type: "array",
      items: { type: "string" },
      description:
        `The full proposed tag set, up to ${TAG_COUNT}. Every toggled-on tag-eligible keyword appears verbatim first; fill the remainder with phrase variants (plurals, buyer phrasings, gift angles) toward the target mix of ${TARGET_MIX}. HARD RULE: every tag ${TAG_MAX_CHARS} characters or fewer — count characters, drop or shorten anything over. No duplicates, no single generic words.`,
    },
    hook: {
      type: "string",
      description:
        "The description OPENER only: 1-3 short sentences in the shop voice, reacting to THIS design's phrase/theme — the thing a buyer reads first. Opens with exactly one fitting emoji (the shop's paragraph-marker convention), none mid-sentence. No fit, fabric, sizing or care copy (that's product boilerplate, stitched separately). No 'welcome to our shop' throat-clearing.",
    },
    attributes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Etsy attribute name, e.g. Occasion, Holiday, Recipient, Style" },
          value: { type: "string", description: "the suggested value" },
        },
        required: ["name", "value"],
        additionalProperties: false,
      },
      description:
        "Etsy attribute suggestions that genuinely apply (Occasion, Holiday, Recipient, Style...). Only ones defensible from the design and niche — an empty array beats a stretch.",
    },
    notes: {
      type: "string",
      description:
        "One or two sentences only if genuinely useful (e.g. a strong keyword left out of the title and why). Empty string otherwise.",
    },
  },
  required: ["title", "tags", "hook", "attributes", "notes"],
  additionalProperties: false,
} as const;

const SYSTEM = `You draft Etsy listing copy for STUFFS, a solo-operator print-on-demand shop.

${SHOP_VOICE}

You are given the design (its phrase/theme and niche), the garment it sells
on, and the keywords the operator selected — each labelled with its SEO
bucket (Visibility = low competition, Reach = mid, Best Seller = high).
The title's job is search: front-load the strongest Visibility keyword and
keep it under 15 words. The tag set's job is coverage: the operator's
selected keywords verbatim first, then variants toward the bucket mix.
The hook's job is voice: make the buyer who GETS this design feel seen.

Every field is a draft the operator edits — write working copy, not options
or explanations.`;

export async function draftListingCopy(input: ListingCopyInput): Promise<ListingCopyDraft> {
  const kwLines = input.keywords
    .map((k) => `- "${k.name}" [${k.bucket}${k.tagEligible ? "" : " · over 20 chars, title-only"}]`)
    .join("\n");
  const user = [
    `DESIGN: ${input.designName}`,
    input.printedCopy ? `PRINTED COPY / LETTERING: ${input.printedCopy}` : "PRINTED COPY: (artwork only, no lettering)",
    input.nicheName ? `NICHE: ${input.nicheName}` : "",
    input.buyer ? `BUYER: ${input.buyer}` : "",
    input.purchaseMotivation ? `PURCHASE MOTIVATION: ${input.purchaseMotivation}` : "",
    input.styleName ? `ART STYLE: ${input.styleName}` : "",
    `PRODUCT: ${input.productLabel}`,
    "",
    "SELECTED KEYWORDS (buckets computed from real search data):",
    kwLines || "(none toggled on yet — draft from the design context and say so in notes)",
    input.currentTitle ? `\nCURRENT TITLE (improve, don't ignore): ${input.currentTitle}` : "",
    input.currentTags.length ? `CURRENT TAGS: ${input.currentTags.join(", ")}` : "",
    "",
    "Draft the title, tag set, description hook, and attribute suggestions.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const message = await anthropic()
    .messages.stream({
      model: model(),
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    })
    .finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("The model declined to draft this copy — check the design fields and try again.");
  }
  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No draft returned — try again.");
  const draft = JSON.parse(block.text) as ListingCopyDraft;

  // Belt over the schema's braces: drop over-cap tags and duplicates so the
  // UI never has to reject what generation proposed.
  const seen = new Set<string>();
  draft.tags = draft.tags
    .map((t) => t.trim())
    .filter((t) => {
      const key = t.toLowerCase();
      if (!t || t.length > TAG_MAX_CHARS || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, TAG_COUNT);
  return draft;
}
