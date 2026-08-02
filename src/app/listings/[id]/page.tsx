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
import type { PrintFileData } from "@/components/PrintFilePanel";
import { needsRecompose, derivativeFor } from "@/server/recompose";
import { usDomesticCharge } from "@/server/etsy/profileCost";
import { isStaleKeyword } from "@/config/keywords";
import { momentumTooltip, type MomentumDetail } from "@/server/listingCsv";
import { Kicker } from "@/components/ui";
import { assetUrl } from "@/lib/assets";

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
        slots={slotsData(rec, compatForListing(rec))}
        colorways={colorwaysData(rec)}
        pricing={pricingData(rec)}
        printFile={printFileData(rec)}
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

function selectedMockupColors(rec: NonNullable<ReturnType<typeof cachedRecord>>): string[] {
  try {
    const parsed = JSON.parse(String(rec.props["Mockup Colors (JSON)"] ?? "[]"));
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
    mockupColors: selectedMockupColors(rec),
    printifyReady: printifyConfigured(),
    connected: String(rec.props["Printify Product ID"] ?? "").trim().length > 0,
  };
}

const PRODUCT_LINK_FIELD: Record<string, string> = {
  "Highlights & Sizing": "Highlights & Sizing Graphic Link",
  "Care & Policies": "Care & Policies Graphic Link",
  Colorways: "Colorways Graphic Link",
};

function slotsData(rec: NonNullable<ReturnType<typeof cachedRecord>>, compatibility: string): SlotsData {
  const productId = ((rec.props["Product"] as string[] | null) ?? [])[0];
  const product = productId ? cachedRecord(productId) : null;

  // The three-way intersection: sold (or the mockup-colors subset if one's
  // set) ∩ a real, currently-available Product Variant in that colour.
  // Failing either check means no mockup template for that colour should
  // ever be offered at L5, even if a photo technically exists for it.
  const norm = (c: string) => c.trim().toLowerCase();
  const soldColors = selectedColorways(rec);
  const mockupColors = selectedMockupColors(rec);
  const wantedColors = new Set((mockupColors.length > 0 ? mockupColors : soldColors).map(norm));
  const availableVariantColors = new Set(
    (productId ? cachedRecords("product_variants") : [])
      .filter((v) => ((v.props["Product"] as string[] | null) ?? []).includes(productId ?? "") && v.props["Available"])
      .map((v) => norm(String(v.props["Color"] ?? "")))
      .filter(Boolean)
  );
  const availableColors = [...wantedColors].filter((c) => availableVariantColors.has(c));

  const slots: SlotRow[] = cachedRecords("image_slots")
    .filter((s) => ((s.props["Listing"] as string[] | null) ?? []).includes(rec.id))
    .sort((a, b) => (Number(a.props["Position"]) || 0) - (Number(b.props["Position"]) || 0))
    .map((s) => {
      const role = String(s.props["Product Link Role"] ?? "");
      const assetRef = String(s.props["Asset Ref"] ?? "");
      // "from Product" when the slot's own asset still matches what the
      // Product currently carries; "custom" when it's been hand-replaced
      // (e.g. a combined graphic for a multi-garment bundle) — never
      // stored, always compared live so it can't go stale itself
      const productLink = role && product ? String(product.props[PRODUCT_LINK_FIELD[role]] ?? "").trim() : "";
      const provenance: SlotRow["provenance"] = !role
        ? null
        : assetRef && productLink && assetRef === productLink
          ? "product"
          : assetRef
            ? "custom"
            : null;
      return {
        id: s.id,
        position: Number(s.props["Position"]) || 0,
        label: s.title,
        bucket: String(s.props["Bucket"] ?? "Sell Design"),
        shotType: String(s.props["Shot Type"] ?? ""),
        status: String(s.props["Status"] ?? "Planned"),
        assetRef,
        templateId: ((s.props["Mockup Template"] as string[] | null) ?? [])[0] ?? null,
        productLinkRole: role || null,
        provenance,
      };
    });
  const templates = cachedRecords("mockup_templates").map((t) => ({
    id: t.id,
    name: t.title,
    shotType: String(t.props["Shot Type"] ?? ""),
    garmentColor: String(t.props["Garment Color"] ?? ""),
  }));
  return {
    listingId: rec.id,
    isMultiVariant: Boolean(rec.props["Is Multi Variant"]),
    compatibility,
    slots,
    templates,
    availableColors,
    hasProductLinks: slots.some((s) => s.productLinkRole),
  };
}

/** L1's print-file question: does this garment need a recomposed master? */
function printFileData(rec: NonNullable<ReturnType<typeof cachedRecord>>): PrintFileData {
  const designId = ((rec.props["Designs"] as string[] | null) ?? [])[0] ?? null;
  const productId = ((rec.props["Product"] as string[] | null) ?? [])[0] ?? null;
  const design = designId ? cachedRecord(designId) : null;
  const product = productId ? cachedRecord(productId) : null;
  const der =
    design && product ? derivativeFor(cachedRecords("design_derivatives"), design.id, product.id) : null;
  return {
    listingId: rec.id,
    designId,
    productId,
    productName: product ? productLabel(product) : "",
    needsRecompose: design && product ? needsRecompose(design, product) : false,
    masterLink: String(design?.props["Master PNG Link"] ?? ""),
    derivative: der
      ? {
          fileLink: String(der.props["File Link"] ?? ""),
          width: typeof der.props["Width px"] === "number" ? der.props["Width px"] : null,
          height: typeof der.props["Height px"] === "number" ? der.props["Height px"] : null,
          status: String(der.props["Status"] ?? "Made"),
          madeAt: String(der.props["Made At"] ?? ""),
        }
      : null,
  };
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
          estimatedShippingCost:
            typeof productRec.props["Estimated Shipping Cost"] === "number"
              ? productRec.props["Estimated Shipping Cost"]
              : null,
          shippingPulledAt: String(productRec.props["Shipping Pulled At"] ?? "") || null,
          // the buyer's side — from the Etsy profile this product points at
          ...(() => {
            const profileId = ((productRec.props["Etsy Shipping Profile"] as string[] | null) ?? [])[0];
            const profile = profileId
              ? cachedRecords("shipping_profiles").find((s) => s.id === profileId)
              : null;
            return {
              shippingCharged: profile ? usDomesticCharge(profile) : null,
              shippingProfileName: profile?.title ?? null,
            };
          })(),
        }
      : null,
  };
}

/** CSVs already folded into this design's keyword pool. */
function keywordImports(designId: string | null): SeoData["imports"] {
  if (!designId) return [];
  const design = cachedRecord(designId);
  try {
    const parsed = JSON.parse(String(design?.props["Keyword Imports (JSON)"] ?? "[]"));
    return Array.isArray(parsed)
      ? parsed.map((i) => ({
          file: String(i?.file ?? "keyword export"),
          source: String(i?.source ?? ""),
          rows: Number(i?.rows) || 0,
          at: String(i?.at ?? ""),
        }))
      : [];
  } catch {
    return [];
  }
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
    patternUrl: assetUrl("pattern"),
    imports: keywordImports(designId),
    pooledFromCsv: designId
      ? all.filter(
          (k) =>
            ((k.props["Designs"] as string[] | null) ?? []).includes(designId) &&
            ["eRank", "Everbee"].includes(String(k.props["Source"] ?? ""))
        ).length
      : 0,
  };
}
