import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords } from "@/server/notion/store";
import { anthropicConfigured } from "@/server/anthropic/client";
import { draftListingCopy } from "@/server/anthropic/listing-copy";
import { productLabel } from "@/server/viewmodels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * L2 draft generation — returns a draft, WRITES NOTHING. The panel renders
 * every field editable and each save goes through the normal PATCH route,
 * so nothing generated ever lands on the record without operator review.
 *
 * Context is assembled server-side from the cache: the listing's Design
 * (phrase + lettering), its Niche (buyer, motivation), its Style, and the
 * Product's house name. The client sends only which keywords are toggled on.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!anthropicConfigured()) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not set. Add it in your host's environment variables." },
        { status: 400 }
      );
    }
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found in cache — refresh first" }, { status: 404 });
    }

    const designId = ((listing.props["Designs"] as string[] | null) ?? [])[0];
    const design = designId ? cachedRecord(designId) : null;
    if (!design) {
      return NextResponse.json(
        { error: "This listing has no Design attached — the draft needs its phrase and niche." },
        { status: 400 }
      );
    }
    const nicheId = ((design.props["Niche"] as string[] | null) ?? [])[0];
    const niche = nicheId ? cachedRecord(nicheId) : null;
    const styleId = ((design.props["Style"] as string[] | null) ?? [])[0];
    const style = styleId ? cachedRecord(styleId) : null;
    const productId = ((listing.props["Product"] as string[] | null) ?? [])[0];
    const product = productId ? cachedRecord(productId) : null;

    // toggled keyword names from the client → bucket data from the bank
    const toggled: string[] = Array.isArray(body.keywords) ? body.keywords.map(String) : [];
    const wanted = new Set(toggled.map((n) => n.trim().toLowerCase()));
    const keywords = cachedRecords("keywords")
      .filter((k) => wanted.has(k.title.trim().toLowerCase()))
      .map((k) => ({
        name: k.title,
        bucket: String(k.props["Bucket"] ?? "Unknown"),
        tagEligible:
          typeof k.props["Tag Eligible"] === "boolean" ? k.props["Tag Eligible"] : k.title.length <= 20,
      }));

    const draft = await draftListingCopy({
      designName: design.title,
      printedCopy: String(design.props["Text Prompt"] ?? ""),
      nicheName: niche?.title ?? "",
      buyer: String(niche?.props["Buyer"] ?? ""),
      purchaseMotivation: String(niche?.props["Purchase Motivation"] ?? ""),
      styleName: style?.title ?? "",
      productLabel: product ? productLabel(product) : "unspecified product",
      keywords,
      currentTitle: String(listing.props["Title"] ?? ""),
      currentTags: String(listing.props["Tags"] ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });

    return NextResponse.json({ draft });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
