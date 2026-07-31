/**
 * Product-level boilerplate ("Shop Voice Text") — the fit/fabric/sizing/care
 * copy that is true of this garment no matter which design is printed on it.
 * Generated ONCE per product, edited/approved by the operator, then reused
 * by every listing that sells this product (stitched under the per-listing
 * hook at L2).
 *
 * Deliberately design-blind: the prompt never sees a design, so the output
 * can never smuggle one in.
 */
import { anthropic, model } from "./client";
import { SHOP_VOICE } from "@/config/shop-voice";

export interface ProductVoiceInput {
  blueprintTitle: string;
  brand: string;
  productModel: string;
  technique: string;
  category: string;
  /** Printify's own product description — the fact source */
  vendorText: string;
}

const VOICE_SCHEMA = {
  type: "object",
  properties: {
    voiceText: {
      type: "string",
      description:
        "The boilerplate: fabric/material, fit and how it runs, sizing guidance, and care instructions, rewritten in the shop voice. Plain text with short labelled sections separated by blank lines (Etsy descriptions render plain text — no markdown, no HTML). Every FACT must come from the vendor text or the product name; where the vendor text is silent on something (e.g. how it runs), leave it out rather than inventing it. Never mention any design, artwork or print subject.",
    },
    notes: {
      type: "string",
      description:
        "One sentence only if a fact gap matters (e.g. vendor text had no care instructions). Empty string otherwise.",
    },
  },
  required: ["voiceText", "notes"],
  additionalProperties: false,
} as const;

const SYSTEM = `You rewrite garment vendor copy into product boilerplate for STUFFS, a solo-operator Etsy print-on-demand shop.

${SHOP_VOICE}

The output is the lower half of every listing description for this product —
fit, fabric, sizing, care — under a per-design hook written elsewhere. It
must read the same no matter which artwork ends up printed on the garment,
so never reference a design. Facts come from the vendor text; the voice
comes from the shop. Rewrite, don't embellish: a fabric weight is a fact,
not a punchline, but the sentence carrying it can still sound like STUFFS.`;

export async function draftProductVoice(
  input: ProductVoiceInput
): Promise<{ voiceText: string; notes: string }> {
  const user = [
    `PRODUCT: ${input.blueprintTitle}`,
    input.brand || input.productModel ? `GARMENT: ${[input.brand, input.productModel].filter(Boolean).join(" ")}` : "",
    input.technique ? `PRINT TECHNIQUE: ${input.technique}` : "",
    input.category ? `CATEGORY: ${input.category}` : "",
    "",
    "VENDOR TEXT (the fact source):",
    input.vendorText.trim() || "(none available — write only what the product name itself supports, and say so in notes)",
    "",
    "Write the shop-voice boilerplate.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const message = await anthropic()
    .messages.stream({
      model: model(),
      max_tokens: 3000,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: VOICE_SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    })
    .finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("The model declined to draft this boilerplate — try again.");
  }
  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No draft returned — try again.");
  return JSON.parse(block.text) as { voiceText: string; notes: string };
}
