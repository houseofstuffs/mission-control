/**
 * Design Tool — Capture mode (spec §9.2).
 *
 * Reference image in, Style record out: description, composition, named slots,
 * typography, keyword bank, a reusable prompt, a separate type prompt (C2
 * generates artwork, C3 sets lettering as a Kittl layer wherever spelling
 * matters), and print suitability as three per-product lists — the constraint
 * that decides which blueprints a style may use at R6.
 *
 * A style is subject-independent by definition: the reference supplies look and
 * layout, the subject comes from the idea it gets paired with. Everything the
 * reference happens to depict is abstracted into [HERO] / [MOTIF n] / [COPY]
 * slots, so one record can carry many different compositions.
 *
 * Output is structured JSON matching the Notion schema, per the spec's rule
 * that prose-only output means re-keying by hand.
 */
import { anthropic, model } from "./client";

export interface CapturedStyle {
  name: string;
  category: "Humor" | "Minimalist" | "Retro" | "Illustrative" | "Moody";
  description: string;
  composition: string;
  slots: string;
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
        "2-3 sentences covering ONLY subject-independent traits: palette (name the actual colours), linework and illustration treatment, texture and finish, mood. Never name what the reference depicts — a design with completely different subject matter must still match this description.",
    },
    composition: {
      type: "string",
      description:
        "The layout skeleton in slot terms: where things sit, their relative size and weight, how the space is divided. Refer to elements only as [HERO], [MOTIF 1], [MOTIF 2], [COPY]. e.g. '[HERO] centred and dominant; [MOTIF 1] as a vertical graphic band down one side; [MOTIF 2] clustered opposite it; [COPY] arched above.' Describe positions and proportions, never the actual objects.",
    },
    slots: {
      type: "string",
      description:
        "Comma-separated list of the slots this style expects, in fill order — e.g. '[HERO], [MOTIF 1], [MOTIF 2], [COPY]'. Use only slots that appear in the composition and reusable prompt. Simple layouts may need just [HERO].",
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
        "An image-generation prompt for the artwork, using the same slot placeholders as the composition. Cover palette, linework, fill treatment, arrangement and mood, plus the negatives that matter (no gradients, no photorealism). Generation is always FLAT: if the reference has distress, weathering or grain, that is an applied production layer — keep it OUT of this prompt (note it in the description instead) and end the prompt with 'flat clean artwork, no distress or weathering, clean edges'. Keep it tight — every sentence that isn't a style constraint narrows what can be generated. Name no actual subject matter, and say nothing about lettering; that is the type prompt's job.",
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
    "composition",
    "slots",
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

A reference image is being borrowed for its LOOK and its LAYOUT — never its
contents. The subject matter comes from somewhere else entirely: a niche, an
idea, a piece of copy. Your job is to separate the two and keep only the part
that travels.

THE RULE: no actual subject matter appears anywhere in your output. If the
reference shows a skull wreathed in marigolds over a checkerboard, you do not
write "skull", "marigolds" or "checkerboard". You write that a single dominant
[HERO] sits centred, [MOTIF 1] forms a dense organic frame around it, and
[MOTIF 2] repeats as a hard geometric band beneath. Someone reading your record
should be able to build a design about something completely different and have
it read as the same style. Naming the reference's contents is the one failure
that makes a record useless.

How to think about it:

- Be precise about what DOES travel: the real colours, the real linework weight
  and quality, the real texture and finish, the real type character. Precision
  here is what stops the record drifting into a generic version of the genre.
- Be abstract about what does NOT: subjects, objects, specific imagery. These
  become slots — [HERO] for the focal element, [MOTIF 1] / [MOTIF 2] for
  supporting imagery, [COPY] for lettering. Use only as many slots as the layout
  genuinely has.
- Composition is its own field because layout is often the real reason a
  reference was saved. Describe the arrangement — what sits where, at what
  relative weight, how the space divides — in slot terms only.
- Keep it lean. Every extra sentence is a constraint on what can be generated
  later, and over-specified records produce samey work. Say what makes the style
  itself, and stop.
- Keep artwork and lettering separate. AI image generation misspells text, so
  lettering is set as a Kittl layer over the artwork. The reusable prompt
  describes artwork only; the type prompt describes lettering only.
- Print suitability is a real production constraint, not a formality. Judge it
  from the artwork's demands: colour count, detail fineness, whether it relies on
  gradients or knocked-out negative space, and whether it needs a specific
  garment colour behind it. Flat many-colour detail loves smooth full-colour
  surfaces (DTG, sublimation, paper) and degrades on per-colour or textured
  methods (screen print, vinyl, embroidery, laser, woven blankets). A style that
  would print badly on something should say so plainly and say why.

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
              ? `Capture this reference's style and layout as a reusable Style record. Its subject matter is not part of the record.\n\nContext from the operator: ${hint.trim()}`
              : "Capture this reference's style and layout as a reusable Style record. Its subject matter is not part of the record.",
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
