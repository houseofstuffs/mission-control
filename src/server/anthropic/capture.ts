/**
 * Design Tool — Capture mode (spec §9.2).
 *
 * Reference image in, Style record out: description, typography, keyword bank,
 * a reusable prompt with a [SUBJECT] slot, a separate type prompt (C2 generates
 * artwork, C3 sets lettering as a Kittl layer wherever spelling matters), and
 * print suitability as three per-product lists — the constraint that decides
 * which blueprints a style may use at R6.
 *
 * Output is structured JSON matching the Notion schema, per the spec's rule
 * that prose-only output means re-keying by hand.
 */
import { anthropic, model } from "./client";

export interface CapturedStyle {
  name: string;
  category: "Humor" | "Minimalist" | "Retro" | "Illustrative" | "Moody";
  description: string;
  typography: string;
  keywordBank: string;
  reusablePrompt: string;
  typePrompt: string;
  printsBeautifullyOn: string;
  worksWithTweaksOn: string;
  avoidOn: string;
  ruleOfThumb: string;
}

const STYLE_SCHEMA = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "Short evocative name, 2-5 words, title case. e.g. 'Vintage Halloween Doodle Collage'",
    },
    category: {
      type: "string",
      enum: ["Humor", "Minimalist", "Retro", "Illustrative", "Moody"],
      description: "The aesthetic bucket this style ranges within.",
    },
    description: {
      type: "string",
      description:
        "2-4 sentences covering vibe, illustration treatment, palette (name actual colours), layout and mood. Concrete and specific — someone should be able to recognise another design in this style from this alone.",
    },
    typography: {
      type: "string",
      description:
        "The lettering character: typeface family, weight, case, arrangement, colour treatment. Name reference typefaces where useful.",
    },
    keywordBank: {
      type: "string",
      description:
        "12-20 comma-separated aesthetic descriptors for reuse and search. Lowercase except proper nouns.",
    },
    reusablePrompt: {
      type: "string",
      description:
        "An image-generation prompt describing ONLY the artwork, with a literal [SUBJECT] placeholder where the subject goes. Include palette, linework, fill treatment, texture, composition and mood. State negatives that matter (no gradients, no photorealism). Say nothing about lettering — that is the type prompt's job.",
    },
    typePrompt: {
      type: "string",
      description:
        "How the lettering should be set: typeface character, weight, case, stacking, colour, distress. End with a note that it is set as a Kittl text layer, not generated in-image.",
    },
    printsBeautifullyOn: {
      type: "string",
      description:
        "Comma-separated product types this style reproduces faithfully on. Smooth full-colour surfaces suit detailed multi-colour work.",
    },
    worksWithTweaksOn: {
      type: "string",
      description:
        "Comma-separated product types that need an adjustment, each with the adjustment in parentheses. e.g. 'DTG tees (keep on dark garment, thicken hairlines)'",
    },
    avoidOn: {
      type: "string",
      description:
        "Comma-separated methods this style should never reach. Per-colour and textured methods — screen print, cut vinyl/HTV, embroidery, laser engraving, woven blankets — degrade fine detail and many-colour work.",
    },
    ruleOfThumb: {
      type: "string",
      description:
        "One or two sentences generalising WHY the print suitability falls where it does — the portable principle, not the product list.",
    },
  },
  required: [
    "name",
    "category",
    "description",
    "typography",
    "keywordBank",
    "reusablePrompt",
    "typePrompt",
    "printsBeautifullyOn",
    "worksWithTweaksOn",
    "avoidOn",
    "ruleOfThumb",
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `You capture reusable design styles for STUFFS, a solo-operator Etsy print-on-demand shop.

Given a reference image, produce a Style record: a description precise enough to
recognise the aesthetic elsewhere, and prompts reusable enough to generate new
designs in it.

How to think about it:

- Describe what is ACTUALLY in the image. Name the real colours, the real
  linework, the real type. Do not drift toward a generic version of the genre.
- The reusable prompt is the deliverable. It must produce work in this style for
  a completely different subject. Put the subject-independent character in it —
  palette, linework, fill treatment, texture, composition, mood — and mark the
  subject slot as [SUBJECT].
- Keep artwork and lettering separate. AI image generation misspells text, so
  lettering is set as a Kittl layer over the artwork. The reusable prompt
  describes artwork only; the type prompt describes lettering only.
- Print suitability is a real production constraint, not a formality. Judge it
  from the artwork's demands: colour count, detail fineness, whether it relies on
  gradients or knocked-out negative space, and whether it needs a specific
  garment colour behind it. Flat many-colour detail loves smooth full-colour
  surfaces (DTG, sublimation, paper) and degrades on per-colour or textured
  methods (screen print, vinyl, embroidery, laser, woven blankets).
- Be honest and specific. A style that would print badly on something should say
  so plainly and say why.

Write in a working designer's voice — concrete, unfussy, no marketing language.`;

export async function captureStyle(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
  hint?: string
): Promise<CapturedStyle> {
  const message = await anthropic().messages.create({
    model: model(),
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: STYLE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          {
            type: "text",
            text: hint?.trim()
              ? `Capture this design's style as a reusable Style record.\n\nContext from the operator: ${hint.trim()}`
              : "Capture this design's style as a reusable Style record.",
          },
        ],
      },
    ],
  });

  // Safety classifiers can decline; check before reading content.
  if (message.stop_reason === "refusal") {
    throw new Error("The model declined to analyse this image. Try a different reference.");
  }
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("No style returned — try again.");
  }
  return JSON.parse(text.text) as CapturedStyle;
}
