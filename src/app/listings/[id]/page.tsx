import Link from "next/link";
import { notFound } from "next/navigation";
import { cachedRecord, cachedRecords } from "@/server/notion/store";
import { runnerRecord, productLabel } from "@/server/viewmodels";
import { StepRunner } from "@/components/StepRunner";
import type { SeoData, KeywordRow } from "@/components/KeywordSeoPanel";
import type { SlotsData, SlotRow } from "@/components/ImageSlotsPanel";
import { compatForListing } from "@/server/imageSlots";
import { printifyConfigured } from "@/server/printify/client";
import { anthropicConfigured } from "@/server/anthropic/client";
import { variantAllowed } from "@/config/design-prompt";
import type { ColorwaysData } from "@/components/ColorwaysPanel";
import type { PricingData } from "@/components/PricingPanel";
import { isStaleKeyword } from "@/config/keywords";
import { momentumTooltip, type MomentumDetail } from "@/server/listingCsv";
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
        seo={seoData(rec)}
        slots={slotsData(rec.id, Boolean(rec.props["Is Multi Variant"]), compatForListing(rec), selectedColorways(rec))}
        colorways={colorwaysData(rec)}
        pricing={pricingData(rec)}
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

/** L3's inputs: the snapshot on the record, the estimate on the product. */
function pricingData(rec: NonNullable<ReturnType<typeof cachedRecord>>): PricingData {
  const productId = ((rec.props["Product"] as string[] | null) ?? [])[0];
  const productRec = productId ? cachedRecords("products").find((p) => p.id === productId) : null;
  return {
    listingId: rec.id,
    price: typeof rec.props["Price"] === "number" ? rec.props["Price"] : null,
    cost: typeof rec.props["Cost At Creation"] === "number" ? rec.props["Cost At Creation"] : null,
    costBasis: String(rec.props["Cost Basis"] ?? ""),
    costSnapshotAt: String(rec.props["Cost Snapshot At"] ?? ""),
    product: productRec
      ? {
          name: productLabel(productRec),
          estimatedCost:
            typeof productRec.props["Estimated Cost"] === "number" ? productRec.props["Estimated Cost"] : null,
          costMethod: String(productRec.props["Cost Calc Method"] ?? "") || null,
        }
      : null,
  };
}

function momentumTitleFor(k: NonNullable<ReturnType<typeof cachedRecord>>): string | null {
  try {
    const detail = JSON.parse(String(k.props["Momentum Detail (JSON)"] ?? "")) as MomentumDetail;
    return detail && typeof detail === "object" ? momentumTooltip(detail) : null;
  } catch {
    return null;
  }
}

function seoData(rec: NonNullable<ReturnType<typeof cachedRecord>>): SeoData {
  const listingId = rec.id;
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
    momentum: String(k.props["Momentum"] ?? "") || null,
    momentumTitle: momentumTitleFor(k),
  }));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const attachedIds = new Set(
    all
      .filter((k) => ((k.props["Etsy Listings"] as string[] | null) ?? []).includes(listingId))
      .map((k) => k.id)
  );
  // keyword work already done on the Design — pre-populated at L2, not retyped
  const designId = ((rec.props["Designs"] as string[] | null) ?? [])[0] ?? null;
  const inherited = designId
    ? all
        .filter(
          (k) =>
            ((k.props["Designs"] as string[] | null) ?? []).includes(designId) && !attachedIds.has(k.id)
        )
        .map((k) => rowById.get(k.id)!)
    : [];
  // one lookup for the tally, suggestion chips and rail tooltips — the
  // whole bank, with the same metrics the shortlist pills show on hover
  const bank: SeoData["bank"] = {};
  for (const r of rows) {
    bank[r.name.trim().toLowerCase()] = {
      bucket: r.bucket,
      searches: r.avgSearches,
      competition: r.competition,
      momentum: r.momentum,
    };
  }

  const productId = ((rec.props["Product"] as string[] | null) ?? [])[0];
  const productRec = productId ? cachedRecords("products").find((p) => p.id === productId) : null;
  const voiceText = String(productRec?.props["Shop Voice Text"] ?? "").trim();

  let dismissed: string[] = [];
  try {
    const parsed = JSON.parse(String(rec.props["Dismissed Keywords (JSON)"] ?? "[]"));
    if (Array.isArray(parsed)) dismissed = parsed.map(String);
  } catch {
    /* unreadable renders as none dismissed — the next ✕ rewrites it clean */
  }

  let attributes: Array<{ name: string; value: string }> = [];
  try {
    const parsed = JSON.parse(String(rec.props["Attributes (JSON)"] ?? "[]"));
    if (Array.isArray(parsed)) {
      attributes = parsed
        .map((a) => ({ name: String(a?.name ?? ""), value: String(a?.value ?? "") }))
        .filter((a) => a.name || a.value);
    }
  } catch {
    /* unreadable JSON renders as empty — saving rewrites it clean */
  }

  return {
    listingId,
    attached: rows.filter((r) => attachedIds.has(r.id)),
    inherited,
    available: rows
      .filter((r) => !attachedIds.has(r.id) && !inherited.some((i) => i.id === r.id))
      .map((r) => ({ id: r.id, name: r.name, bucket: r.bucket })),
    tags: String(rec.props["Tags"] ?? ""),
    bank,
    dismissed,
    title: String(rec.props["Title"] ?? ""),
    hook: String(rec.props["Description Hook"] ?? ""),
    bodyCopy: String(rec.props["Body Copy"] ?? ""),
    attributes,
    product: productRec
      ? {
          id: productRec.id,
          name: productLabel(productRec),
          hasVoice: voiceText.length > 0,
          voiceText,
        }
      : null,
    hasDesign: Boolean(designId),
    aiReady: anthropicConfigured(),
  };
}
