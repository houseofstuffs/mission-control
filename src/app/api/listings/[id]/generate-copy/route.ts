import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords } from "@/server/notion/store";
import { anthropicConfigured } from "@/server/anthropic/client";
import { draftListingCopy, type CopyStage } from "@/server/anthropic/listing-copy";
import { productLabel } from "@/server/viewmodels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The attributes already on the record — the hook stage writes against them. */
function savedAttributes(raw: unknown): Array<{ name: string; value: string }> {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((a) => ({ name: String(a?.name ?? ""), value: String(a?.value ?? "") }))
      .filter((a) => a.name && a.value);
  } catch {
    return [];
  }
}

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
    const stage: CopyStage = ["title-attributes", "hook"].includes(body?.stage)
      ? body.stage
      : "all";
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

    // The keyword decision comes from the RECORD, not the request — the
    // title front-loads the operator's locked-in keywords, so generation
    // waits until the Selected tags are saved. Attached title-only
    // keywords (>20 chars) ride along: they can't be tags but shape the
    // title.
    const savedTags = String(listing.props["Tags"] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (savedTags.length === 0) {
      return NextResponse.json(
        { error: "Lock in your keywords first — save the Selected tags, then generate. The title is built to front-load your decision." },
        { status: 400 }
      );
    }
    const wanted = new Set(savedTags.map((n) => n.toLowerCase()));
    const bank = cachedRecords("keywords");
    const keywords = [
      ...bank.filter((k) => wanted.has(k.title.trim().toLowerCase())),
      ...bank.filter(
        (k) =>
          ((k.props["Etsy Listings"] as string[] | null) ?? []).includes(id) &&
          !(typeof k.props["Tag Eligible"] === "boolean" ? k.props["Tag Eligible"] : k.title.length <= 20)
      ),
    ].map((k) => ({
      name: k.title,
      bucket: String(k.props["Bucket"] ?? "Unknown"),
      tagEligible:
        typeof k.props["Tag Eligible"] === "boolean" ? k.props["Tag Eligible"] : k.title.length <= 20,
    }));
    // saved tags that aren't bank records (hand-typed phrases) still count
    const known = new Set(keywords.map((k) => k.name.trim().toLowerCase()));
    for (const t of savedTags) {
      if (!known.has(t.toLowerCase())) {
        keywords.push({ name: t, bucket: "Unknown", tagEligible: t.length <= 20 });
      }
    }

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
      currentAttributes: savedAttributes(listing.props["Attributes (JSON)"]),
      stage,
    });

    return NextResponse.json({ draft });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
