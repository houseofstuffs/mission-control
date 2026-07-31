import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import { anthropicConfigured } from "@/server/anthropic/client";
import { draftProductVoice } from "@/server/anthropic/product-voice";
import { getBlueprint, printifyConfigured } from "@/server/printify/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Printify vendor copy is HTML — the prompt wants the words, not the tags. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Draft the product's shop-voice boilerplate. Returns a DRAFT — saving is a
 * separate, deliberate PATCH after the operator edits/approves it.
 *
 * Fact source is Vendor Text Raw; when that's blank and Printify is
 * configured, the blueprint's own description is fetched and stored into
 * the blank (fill-only — the "never overwritten" rule from §3.3 holds).
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!anthropicConfigured()) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not set. Add it in your host's environment variables." },
        { status: 400 }
      );
    }
    const { id } = await ctx.params;
    const product = cachedRecord(id);
    if (!product || product.dbKey !== "products") {
      return NextResponse.json({ error: "Product not found in cache — refresh first" }, { status: 404 });
    }

    let vendorRaw = String(product.props["Vendor Text Raw"] ?? "").trim();
    if (!vendorRaw && printifyConfigured()) {
      const blueprintId = Number(product.props["Printify Blueprint ID"]);
      if (Number.isFinite(blueprintId)) {
        try {
          const bp = await getBlueprint(blueprintId);
          if (bp.description?.trim()) {
            vendorRaw = bp.description.trim();
            await updateRecord("products", id, { "Vendor Text Raw": vendorRaw });
          }
        } catch {
          // no vendor text is workable — the generator says what it lacked
        }
      }
    }

    const result = await draftProductVoice({
      blueprintTitle: String(product.props["Blueprint Title"] ?? product.title),
      brand: String(product.props["Blueprint Brand"] ?? ""),
      productModel: String(product.props["Blueprint Model"] ?? ""),
      technique: String(product.props["Print Technique"] ?? ""),
      category: String(product.props["Category"] ?? ""),
      vendorText: stripHtml(vendorRaw),
    });

    return NextResponse.json({ draft: result.voiceText, notes: result.notes });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
