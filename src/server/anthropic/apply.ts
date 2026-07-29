/**
 * Design Tool — Apply mode (spec §9.2).
 *
 * Style record + slot fills + copy → the C1 prompt pair: an image prompt for
 * C2 (artwork only) and a text prompt for C3 (lettering as a Kittl layer).
 * Also emits the exact text phrases for trademark screening — the screen
 * happens against what will actually be printed, not a paraphrase.
 *
 * Per spec: fonts constrained to Kittl's available merch-licensed library;
 * palette and type locked within a series only, never across the shop; the
 * text-in-image vs Kittl-layer rule is retained.
 */
import { anthropic, model } from "./client";

export interface ComposedPair {
  imagePrompt: string;
  textPrompt: string;
  textureNote: string;
  screeningPhrases: string;
  notes: string;
}

const PAIR_SCHEMA = {
  type: "object",
  properties: {
    imagePrompt: {
      type: "string",
      description:
        "The ready-to-paste image-generation prompt: the style's reusable prompt with every slot filled with the actual subject matter, tightened into one coherent prompt. Artwork only — no lettering (explicitly say text-free where the style risks generating some), and FLAT: no distress, weathering, grain or aging effects, clean edges. Texture is a separate layer applied at C5.",
    },
    textPrompt: {
      type: "string",
      description:
        "The lettering instruction for Kittl: the exact copy to set, the style's type treatment applied to it, arrangement, colour, and any distress or warp. Font suggestions must be plausible Kittl merch-licensed library picks, named as character descriptions (e.g. 'a bold condensed vintage serif such as...') so a close match can be chosen if the exact font is absent.",
    },
    textureNote: {
      type: "string",
      description:
        "The C5 texture instruction, derived from the style's character: what kind of texture (grain, grunge, halftone, paper...), applied as a MASK/knockout when the distress should also eat the artwork's edges (same grain through interior and silhouette) or as an overlay when it shouldn't, rough strength, and any blend-mode note. One executable sentence or two — something to do in Kittl in thirty seconds. Empty string if the style is clean and needs no texture.",
    },
    screeningPhrases: {
      type: "string",
      description:
        "Comma-separated: every exact phrase that will appear in the final design, verbatim, for trademark screening. If there is no lettering, an empty string.",
    },
    notes: {
      type: "string",
      description:
        "One or two sentences, only if genuinely useful: a tension between the style and this subject, a print-suitability caution for the chosen product, or an adjustment worth making at C2. Empty string if nothing needs saying.",
    },
  },
  required: ["imagePrompt", "textPrompt", "textureNote", "screeningPhrases", "notes"],
  additionalProperties: false,
} as const;

const SYSTEM = `You compose generation-ready prompt pairs for STUFFS, a solo-operator Etsy print-on-demand shop.

You are given a Style record (subject-independent: palette, linework, texture,
composition skeleton with named slots, type treatment) and the actual content
for this design: what goes in each slot, and the copy. Merge them into two
prompts:

- The IMAGE prompt goes to an image generator (Kittl). It is the style's
  reusable prompt with the slots filled — keep the style's constraints intact
  and the subject matter woven in naturally, not bolted on. Artwork only:
  AI image generation misspells text, so if the design has lettering, the
  image prompt must not ask for any (say "no text, no lettering" explicitly
  when the style might otherwise produce some).
- The image prompt asks for FLAT artwork: no distress, weathering, grain,
  aging or halftone effects, clean edges. Baked-in texture is different on
  every generation and can't be adjusted per product — texture is applied as
  a separate layer at the texture step (C5). If the style's character calls
  for distress, that goes in the TEXTURE NOTE instead: which kind of texture,
  applied as a mask/knockout when the grain should also eat the artwork's
  edges, or as an overlay when it shouldn't, and how strong. Fill treatment
  that is genuinely part of the illustration (flat muted fills, visible
  brushwork) stays in the image prompt — only applied-effect texture moves out.
- The TEXT prompt is for setting the copy as a Kittl text layer over the
  artwork: exact copy, type character, arrangement, colour, distress. Fonts
  must be realistic picks from Kittl's merch-licensed library — describe the
  character so a close match works if the named font is missing.

Rules:
- The style wins on aesthetics; the content wins on meaning. If they fight,
  say so in notes rather than silently bending one.
- Keep prompts tight. Every sentence that isn't doing work narrows the
  generation for no reason.
- The style's palette is a register with a default family, not a locked list.
  A SERIES commits to one colourway and keeps it across its designs: use the
  style's default family unless the operator's fills or copy ask for another
  family in the same tonal register. Type treatments stay as the style
  defines them — fill, don't redesign.
- List every verbatim phrase that will be printed for trademark screening.

Write prompts as working prompts — no preamble, no explanation inside them.`;

export interface ApplyInput {
  style: Record<string, string>;
  fills: Record<string, string>;
  copy: string;
  context?: string; // niche / product / occasion, assembled by the caller
}

export async function composePair(input: ApplyInput): Promise<ComposedPair> {
  const styleBlock = Object.entries(input.style)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const fillsBlock = Object.entries(input.fills)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");

  const user = [
    "STYLE RECORD:",
    styleBlock,
    "",
    "SLOT FILLS:",
    fillsBlock || "(none — single-subject design)",
    "",
    `COPY (exact text to set): ${input.copy.trim() || "(no lettering on this design)"}`,
    input.context ? `\nDESIGN CONTEXT: ${input.context}` : "",
    "",
    "Compose the image + text prompt pair.",
  ].join("\n");

  const message = await anthropic().messages.create({
    model: model(),
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: PAIR_SCHEMA } },
    messages: [{ role: "user", content: [{ type: "text", text: user }] }],
  });

  if (message.stop_reason === "refusal") {
    throw new Error("The model declined to compose this pair. Check the copy and try again.");
  }
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("No prompts returned — try again.");
  }
  return JSON.parse(text.text) as ComposedPair;
}
