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

/** One composed candidate — a pair plus provenance. */
export interface Candidate extends ComposedPair {
  styleName: string;
  /** true = a direction the model proposed, not a library style */
  suggested: boolean;
}

const CANDIDATES_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      description:
        "One candidate per given style, IN THE ORDER GIVEN, then any suggested new directions after them.",
      items: {
        type: "object",
        properties: {
          styleName: {
            type: "string",
            description:
              "For library styles: the style's name exactly as given. For suggested directions: a fresh 2-3 word name for the direction.",
          },
          suggested: {
            type: "boolean",
            description: "false for the given library styles; true for directions you proposed.",
          },
          imagePrompt: (PAIR_SCHEMA.properties as Record<string, unknown>).imagePrompt,
          textPrompt: (PAIR_SCHEMA.properties as Record<string, unknown>).textPrompt,
          textureNote: (PAIR_SCHEMA.properties as Record<string, unknown>).textureNote,
          screeningPhrases: (PAIR_SCHEMA.properties as Record<string, unknown>).screeningPhrases,
          notes: (PAIR_SCHEMA.properties as Record<string, unknown>).notes,
        },
        required: ["styleName", "suggested", "imagePrompt", "textPrompt", "textureNote", "screeningPhrases", "notes"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

const MULTI_ADDENDUM = `

MULTIPLE STYLES: when given several style records, compose one complete
candidate per style, in the order given. Keep them genuinely distinct — each
candidate honours ITS style's register, linework and type; do not let
phrasings bleed between them. The same slot fills and copy apply to all.

SUGGESTED DIRECTIONS: when asked for N extra directions, add N candidates
after the library ones, marked suggested=true, each with a fresh 2-3 word
name. Draw them from registers deliberately OUTSIDE the given styles'
territory — they exist to widen the comparison at C2, not to echo it. Same
rules apply: flat artwork, no subject drift, lettering separate.`;

export interface ApplyInput {
  /** 1-5 library style records, name → full field map */
  styles: Array<{ name: string; fields: Record<string, string> }>;
  fills: Record<string, string>;
  copy: string;
  context?: string; // niche / product / occasion, assembled by the caller
  /** 0-2 model-proposed directions on top of the library styles */
  suggestCount: number;
}

export async function composeCandidates(input: ApplyInput): Promise<Candidate[]> {
  const styleBlocks = input.styles
    .map((s, i) => {
      const body = Object.entries(s.fields)
        .filter(([, v]) => v.trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      return `STYLE ${i + 1} — "${s.name}":\n${body}`;
    })
    .join("\n\n");
  const fillsBlock = Object.entries(input.fills)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");

  const user = [
    styleBlocks,
    "",
    "SLOT FILLS (apply to every candidate):",
    fillsBlock || "(none — single-subject design)",
    "",
    `COPY (exact text to set): ${input.copy.trim() || "(no lettering on this design)"}`,
    input.context ? `\nDESIGN CONTEXT: ${input.context}` : "",
    "",
    input.suggestCount > 0
      ? `Compose one candidate per style above, then suggest ${input.suggestCount} additional direction${input.suggestCount === 1 ? "" : "s"} from outside their territory.`
      : "Compose one candidate per style above.",
  ].join("\n");

  // Streamed: at 32k max tokens the SDK refuses non-streaming requests
  // (they could outlive the HTTP window). Same response, collected here.
  const message = await anthropic()
    .messages.stream({
      model: model(),
      max_tokens: 32000,
      system: SYSTEM + MULTI_ADDENDUM,
      output_config: { format: { type: "json_schema", schema: CANDIDATES_SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    })
    .finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("The model declined to compose these candidates. Check the copy and try again.");
  }
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("No candidates returned — try again.");
  }
  return (JSON.parse(text.text) as { candidates: Candidate[] }).candidates;
}
