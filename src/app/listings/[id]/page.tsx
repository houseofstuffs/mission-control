import Link from "next/link";
import { notFound } from "next/navigation";
import { cachedRecord, cachedRecords } from "@/server/notion/store";
import { runnerRecord, productLabel } from "@/server/viewmodels";
import { StepRunner } from "@/components/StepRunner";
import type { SeoData, KeywordRow } from "@/components/KeywordSeoPanel";
import type { SlotsData, SlotRow } from "@/components/ImageSlotsPanel";
import { compatForListing } from "@/server/imageSlots";
import { printifyConfigured } from "@/server/printify/client";
import { variantAllowed } from "@/config/design-prompt";
import type { ColorwaysData } from "@/components/ColorwaysPanel";
import { isStaleKeyword } from "@/config/keywords";
import { Kicker } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ListingRunnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = cachedRecord(id);
  if (!rec || rec.dbKey !== "etsy_listings") notFound();

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <Kicker><Link href="/listings">LISTINGS</Link> / LISTING WORKFLOW · DRAFT-ONLY</Kicker>
          <h1 className="page-title" style={{ textTransform: "none", letterSpacing: 0 }}>{rec.title || "Untitled listing"}</h1>
        </div>
      </div>
      <StepRunner
        record={runnerRecord(rec)}
        seo={seoData(rec.id, String(rec.props["Tags"] ?? ""))}
        slots={slotsData(rec.id, Boolean(rec.props["Is Multi Variant"]), compatForListing(rec), selectedColorways(rec))}
        colorways={colorwaysData(rec)}
      />
    </div>
  );
}

function selectedColorways(rec: NonNullable<ReturnType<typeof cachedRecord>>): string[] {
  try {
    const parsed = JSON.parse(String(rec.props["Colorways (JSON)"] ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** The product's colour list, annotated with what garment compat rules out. */
function colorwaysData(rec: NonNullable<ReturnType<typeof cachedRecord>>): ColorwaysData {
  const productId = ((rec.props["Product"] as string[] | null) ?? [])[0];
  const productRec = productId ? cachedRecords("products").find((p) => p.id === productId) : null;
  const colors = productId
    ? Array.from(
        new Set(
          cachedRecords("product_variants")
            .filter((v) => ((v.props["Product"] as string[] | null) ?? []).includes(productId))
            .map((v) => String(v.props["Color"] ?? "").trim())
            .filter(Boolean)
        )
      ).sort()
    : [];
  const compat = compatForListing(rec);
  return {
    listingId: rec.id,
    productName: productRec ? productLabel(productRec) : "No product set",
    colors,
    excluded: colors.filter((c) => !variantAllowed(compat, c)),
    selected: selectedColorways(rec),
    printifyReady: printifyConfigured(),
    connected: String(rec.props["Printify Product ID"] ?? "").trim().length > 0,
  };
}

function slotsData(listingId: string, isMultiVariant: boolean, compatibility: string, colorways: string[]): SlotsData {
  const slots: SlotRow[] = cachedRecords("image_slots")
    .filter((s) => ((s.props["Listing"] as string[] | null) ?? []).includes(listingId))
    .sort((a, b) => (Number(a.props["Position"]) || 0) - (Number(b.props["Position"]) || 0))
    .map((s) => ({
      id: s.id,
      position: Number(s.props["Position"]) || 0,
      label: s.title,
      bucket: String(s.props["Bucket"] ?? "Sell Design"),
      shotType: String(s.props["Shot Type"] ?? ""),
      status: String(s.props["Status"] ?? "Planned"),
      assetRef: String(s.props["Asset Ref"] ?? ""),
      templateId: ((s.props["Mockup Template"] as string[] | null) ?? [])[0] ?? null,
    }));
  const templates = cachedRecords("mockup_templates").map((t) => ({
    id: t.id,
    name: t.title,
    shotType: String(t.props["Shot Type"] ?? ""),
    garmentColor: String(t.props["Garment Color"] ?? ""),
  }));
  return { listingId, isMultiVariant, compatibility, slots, templates, colorways };
}

function seoData(listingId: string, tags: string): SeoData {
  const all = cachedRecords("keywords");
  const rows: KeywordRow[] = all.map((k) => ({
    id: k.id,
    name: k.title,
    bucket: String(k.props["Bucket"] ?? "Unknown"),
    avgSearches: typeof k.props["Avg Searches"] === "number" ? k.props["Avg Searches"] : null,
    avgClicks: typeof k.props["Avg Clicks"] === "number" ? k.props["Avg Clicks"] : null,
    competition: typeof k.props["Etsy Competition"] === "number" ? k.props["Etsy Competition"] : null,
    // formula from Notion when cached; length fallback covers fresh rows
    tagEligible:
      typeof k.props["Tag Eligible"] === "boolean" ? k.props["Tag Eligible"] : k.title.length <= 20,
    stale: isStaleKeyword(typeof k.props["Pulled At"] === "string" ? k.props["Pulled At"] : null),
  }));
  const attachedIds = new Set(
    all
      .filter((k) => ((k.props["Etsy Listings"] as string[] | null) ?? []).includes(listingId))
      .map((k) => k.id)
  );
  return {
    listingId,
    attached: rows.filter((r) => attachedIds.has(r.id)),
    available: rows
      .filter((r) => !attachedIds.has(r.id))
      .map((r) => ({ id: r.id, name: r.name, bucket: r.bucket })),
    tags,
  };
}
