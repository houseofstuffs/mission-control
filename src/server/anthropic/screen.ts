/**
 * Trademark risk pre-screen for copy ideas — a heuristic early warning at
 * capture time, NOT legal clearance. The real screening step (R5 / the L6
 * gate) still happens before anything publishes; this exists so a lyric or
 * film quote is flagged the moment it enters the inbox, not after design
 * work is sunk into it.
 */
import { anthropic, model } from "./client";

export interface CopyRisk {
  risk: "Clear" | "Caution" | "High";
  reason: string;
}

const RISK_SCHEMA = {
  type: "object",
  properties: {
    risk: {
      type: "string",
      enum: ["Clear", "Caution", "High"],
      description:
        "High: contains or clearly derives from protected material (song lyrics, film/TV/book titles or quotes, character or celebrity names, brand names, team names, famous slogans). Caution: plausibly associated with protected material or a crowded/contested phrase — worth a real search before design work. Clear: generic language, common phrases, original wording.",
    },
    reason: {
      type: "string",
      description:
        "One or two sentences: WHICH element carries the risk and why (e.g. 'lyric from …', 'title of …'), or why it's clear. Name the likely source when you recognise it. No legal advice, no hedging boilerplate.",
    },
  },
  required: ["risk", "reason"],
  additionalProperties: false,
} as const;

const SYSTEM = `You pre-screen short phrases intended for print-on-demand merchandise (Etsy) for trademark and IP risk.

Judge the ACTUAL phrase: song lyrics, film/TV/book titles and quotes, character
names, celebrity names, brand names, sports teams, and famous slogans are the
risks. Common idioms, generic sentiments and original wording are Clear —
do not inflate risk on ordinary language. When you recognise the likely
source, name it. This is an early-warning heuristic, not legal clearance;
the shop runs a real screening step before anything publishes.

WHEN AN AUDIENCE IS GIVEN, USE IT. The audience names the fandom the phrase is
being sold into, and that is usually the source. A plain-sounding line aimed at
fans of a specific film, band, show or book is far more likely to be a quote or
lyric FROM it than to be original — check the phrase against that work before
calling it generic. "Sing your melody" reads as ordinary language on its own;
sold to fans of Once, it's a line from Falling Slowly.`;

/**
 * @param niche  the audience this copy is aimed at. Load-bearing: the niche
 *   is usually where the phrase came from, and without it an ordinary-looking
 *   lyric reads as generic language.
 */
export async function screenCopy(text: string, niche?: string | null): Promise<CopyRisk> {
  const prompt = [
    "Screen this merch copy for trademark/IP risk:",
    "",
    `"${text.trim()}"`,
    ...(niche?.trim() ? ["", `Audience / niche: ${niche.trim()}`] : []),
  ].join("\n");

  const message = await anthropic()
    .messages.stream({
      model: model(),
      max_tokens: 2000,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: RISK_SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    })
    .finalMessage();

  if (message.stop_reason === "refusal") {
    return { risk: "Caution", reason: "The screen declined to assess this phrase — check it manually." };
  }
  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("No screening result returned.");
  }
  return JSON.parse(block.text) as CopyRisk;
}
