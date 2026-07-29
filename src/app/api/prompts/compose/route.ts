import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";
import { composePair } from "@/server/anthropic/apply";
import { anthropicConfigured } from "@/server/anthropic/client";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Style fields the composer needs, in the order it should read them. */
const STYLE_FIELDS = [
  "Description",
  "Composition",
  "Slots",
  "Typography",
  "Reusable Prompt",
  "Type Prompt",
  "Rule of Thumb",
];

/**
 * Apply mode: style + fills + copy → prompt pair. `save: true` writes the
 * pair and the Style relation to the design; without it this is a dry run —
 * regenerate freely, nothing touches Notion.
 */
export async function POST(req: Request) {
  try {
    if (!anthropicConfigured()) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not set. Add it in your host's environment variables." },
        { status: 400 }
      );
    }
    const body = await req.json();
    const { designId, styleId, fills, copy, save, imagePrompt, textPrompt } = body as {
      designId: string;
      styleId: string;
      fills?: Record<string, string>;
      copy?: string;
      save?: boolean;
      imagePrompt?: string;
      textPrompt?: string;
    };

    const design = cachedRecord(designId);
    if (!design || design.dbKey !== "designs") {
      return NextResponse.json({ error: "Design not found in cache — refresh first" }, { status: 404 });
    }

    // Save path: write the (possibly hand-edited) pair through to Notion.
    if (save) {
      const record = await updateRecord("designs", designId, {
        "Image Prompt": imagePrompt ?? "",
        "Text Prompt": textPrompt ?? "",
        ...(styleId ? { Style: [styleId] } : {}),
      });
      return NextResponse.json({ record });
    }

    const style = cachedRecord(styleId);
    if (!style || style.dbKey !== "styles") {
      return NextResponse.json({ error: "Style not found in cache — refresh first" }, { status: 404 });
    }

    const styleBlock: Record<string, string> = { Name: style.title };
    for (const f of STYLE_FIELDS) styleBlock[f] = String(style.props[f] ?? "");

    // Context the composer should know: niche, product, occasion.
    const parts: string[] = [];
    const nicheId = (design.props["Niche"] as string[] | null)?.[0];
    if (nicheId) {
      const niche = cachedRecords("niches").find((n) => n.id === nicheId);
      if (niche) parts.push(`niche "${niche.title}"`);
    }
    const productId = (design.props["Primary Product"] as string[] | null)?.[0];
    if (productId) {
      const product = cachedRecords("products").find((p) => p.id === productId);
      if (product) parts.push(`primary product "${product.title}"`);
    }
    if (design.props["Occasion"]) parts.push(`occasion ${String(design.props["Occasion"])}`);

    const pair = await composePair({
      style: styleBlock,
      fills: fills ?? {},
      copy: copy ?? "",
      context: parts.length ? parts.join(", ") : undefined,
    });
    return NextResponse.json({ pair });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
