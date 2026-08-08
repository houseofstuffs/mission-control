import Link from "next/link";
import { notFound } from "next/navigation";
import { cachedRecord, cachedRecords } from "@/server/notion/store";
import { runnerRecord, productLabel } from "@/server/viewmodels";
import { StepRunner } from "@/components/StepRunner";
import type { SeoData, KeywordRow } from "@/components/KeywordSeoPanel";
import type { SlotsData, SlotRow } from "@/components/ImageSlotsPanel";
import type { MockupsData, MockupTile } from "@/components/GenerateMockupsPanel";
import { compatForListing } from "@/server/imageSlots";
import { printifyConfigured } from "@/server/printify/client";
import { anthropicConfigured } from "@/server/anthropic/client";
import { variantAllowed } from "@/config/design-prompt";
import { parseQuad, parsePlacementMap } from "@/config/mockups";
import { listingMockupPlan, generatedFor, perColourArt } from "@/server/mockup/plan";
import { generateJobStatus } from "@/server/mockup/generateJob";
import type { ColorwaysData } from "@/components/ColorwaysPanel";
import type { PricingData } from "@/components/PricingPanel";
import type { PushData } from "@/components/PushDraftPanel";
import type { PrintFileData } from "@/components/PrintFilePanel";
import { etsyConfigured } from "@/server/etsy/client";
import { connectionStatus as etsyConnectionStatus } from "@/server/etsy/connection";
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
  // L4 reuses L5's colour intersection, so compute the slots view once;
  // L7's preview reuses both it and the pricing view
  const slots = slotsData(rec, compatForListing(rec));
  const pricing = pricingData(rec);

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
        slots={slots}
        mockups={mockupsData(rec, slots)}
        colorways={colorwaysData(rec)}
        pricing={pricing}
        push={pushData(rec, slots, pricing)}
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
      // when the asset is one of OUR renders, resolve which VARIANT made
      // it — the mismatch detector compares this against the slot's own
      // relation, so a crossed pair shows itself instead of hiding until
      // a thumbnail looks off
      const genMatch = assetRef.match(/^\/api\/generated-mockups\/([^/]+)\/file/);
      const gen = genMatch ? cachedRecord(genMatch[1]) : null;
      const assetVariantId = gen ? (((gen.props["Variant"] as string[] | null) ?? [])[0] ?? null) : null;
      const assetVariant = assetVariantId ? cachedRecord(assetVariantId) : null;
      return {
        id: s.id,
        position: Number(s.props["Position"]) || 0,
        label: s.title,
        bucket: String(s.props["Bucket"] ?? "Sell Design"),
        shotType: String(s.props["Shot Type"] ?? ""),
        status: String(s.props["Status"] ?? "Planned"),
        assetRef,
        colour: String(s.props["Colour"] ?? "").trim(),
        templateId: ((s.props["Mockup Template"] as string[] | null) ?? [])[0] ?? null,
        assetVariantId,
        assetVariantName: assetVariant?.title ?? null,
        assetShotType: assetVariant ? String(assetVariant.props["Shot Type"] ?? "") : null,
        productLinkRole: role || null,
        provenance,
      };
    });
  const templates = cachedRecords("mockup_templates").map((t) => ({
    id: t.id,
    name: t.title,
    shotType: String(t.props["Shot Type"] ?? ""),
    garmentColor: String(t.props["Garment Color"] ?? ""),
    shotId: ((t.props["Shot"] as string[] | null) ?? [])[0] ?? null,
  }));
  return {
    listingId: rec.id,
    isMultiVariant: Boolean(rec.props["Is Multi Variant"]),
    compatibility,
    slots,
    templates,
    availableColors,
    // L4's assignment — offers narrow to shortlist ∩ colour when set
    shortlist: (rec.props["Template Shortlist"] as string[] | null) ?? [],
    hasProductLinks: slots.some((s) => s.productLinkRole),
  };
}

/**
 * L4's inputs. The template × colour matrix is the same intersection L5
 * filters its variant picker by, so the two steps can never disagree about
 * which colours are real. Every tile is a planned combination; url stays
 * null until the Phase-3 compositor fills it in.
 */
function mockupsData(
  rec: NonNullable<ReturnType<typeof cachedRecord>>,
  slots: SlotsData
): MockupsData {
  const productId = ((rec.props["Product"] as string[] | null) ?? [])[0];
  const product = productId ? cachedRecord(productId) : null;
  const designId = ((rec.props["Designs"] as string[] | null) ?? [])[0];
  const design = designId ? cachedRecord(designId) : null;

  const norm = (c: string) => c.trim().toLowerCase();
  // ONE plan derivation, shared with the generate job (src/server/mockup/
  // plan.ts) — the grid the operator reviews and the run the job executes
  // can never disagree. Tiles join their generated record when one exists.
  const plan = listingMockupPlan(rec);
  // tiles group under the SHOT (the template), never the variant — a
  // variant IS one colour, so variant-level grouping renders every tile
  // as its own one-card "group" and the review grid degenerates to a
  // full-width column (the live one-per-row bug). Shot-less hand intakes
  // stay their own group of one, which is honest.
  const shotOfVariant = new Map(slots.templates.map((t) => [t.id, t.shotId]));
  const tiles: MockupTile[] = plan.tiles.map((t) => {
    const g = generatedFor(rec.id, t.variantId);
    const shotId = shotOfVariant.get(t.variantId) ?? null;
    const shot = shotId ? cachedRecord(shotId) : null;
    const variant = cachedRecord(t.variantId);
    return {
      variantId: t.variantId,
      templateId: shotId ?? t.variantId,
      templateName: shot?.title || t.variantName,
      shotType: t.shotType,
      colour: t.colour,
      quad: parseQuad(String(variant?.props["Print Area Quad (JSON)"] ?? "")),
      url: g ? `/api/generated-mockups/${g.id}/file?v=${encodeURIComponent(g.lastEdited)}` : null,
      generatedId: g?.id ?? null,
      verdict: g ? (String(g.props["Verdict"] ?? "Approved") as "Approved" | "Flagged") : null,
      // which slot already holds this render — drives "Send N NEW" and
      // the skip-quietly semantics on repeat sends
      placedInSlot: g
        ? slots.slots.find((sl) => sl.assetRef.startsWith(`/api/generated-mockups/${g.id}/file`))?.position ?? null
        : null,
    };
  });

  // every branded graphic the slot plan expects, present or not — a missing
  // one must show as missing here, because L5's Graphic Card slots will
  // want it and silence now means discovering the gap two steps later
  const graphic = (field: string, label: string) => {
    const url = String(product?.props[field] ?? "").trim();
    return { label, url: url || null };
  };
  const infoGraphics = [
    graphic("Highlights & Sizing Graphic Link", "Size chart"),
    graphic("Care & Policies Graphic Link", "Care info"),
    graphic("Colorways Graphic Link", "Colourways"),
  ];

  // every template, with what it would CONTRIBUTE to this listing — the
  // pick is coverage and yield, not a name-guessing game. Incompatible
  // templates (a Product set, and not this listing's) are hidden with a
  // count; templates with no Product set show everywhere by design.
  const listingColours = slots.availableColors.map(norm);
  const variantColoursByShot = new Map<string, Set<string>>();
  for (const t of slots.templates) {
    if (!t.shotId || !t.garmentColor.trim()) continue;
    const set = variantColoursByShot.get(t.shotId) ?? new Set<string>();
    set.add(norm(t.garmentColor));
    variantColoursByShot.set(t.shotId, set);
  }
  // display-cased colour names, keyed by normalized form
  const colourDisplay = new Map(slots.availableColors.map((c) => [norm(c), c]));
  const shotTypeByShot = new Map<string, string>();
  for (const t of slots.templates) {
    if (t.shotId && t.shotType && !shotTypeByShot.has(t.shotId)) shotTypeByShot.set(t.shotId, t.shotType);
  }

  const allShots = cachedRecords("mockup_shots");
  const compatible = (s: (typeof allShots)[number]) => {
    const pid = ((s.props["Product"] as string[] | null) ?? [])[0];
    return !pid || pid === productId;
  };
  const hiddenShots = allShots.filter((s) => !compatible(s));
  const allTemplates = allShots.filter(compatible).map((s) => {
    const all = variantColoursByShot.get(s.id) ?? new Set<string>();
    const covered = [...all].filter((c) => listingColours.includes(c));
    const hasSample = Array.isArray(s.props["Sample Image"]) && (s.props["Sample Image"] as unknown[]).length > 0;
    return {
      id: s.id,
      name: s.title || "Untitled template",
      // the SHOT record's own Shot Type first — a variant's stamped copy
      // can lag a rename until Re-sync ("On Model" vs "On Model — Female"
      // rendered as two labels for one template). Variant stamp is only
      // the fallback for shots that predate the field.
      shotType: String(s.props["Shot Type"] ?? "").trim() || (shotTypeByShot.get(s.id) ?? ""),
      thumbUrl: hasSample ? `/api/mockup-shots/${s.id}/thumb?v=${encodeURIComponent(s.lastEdited)}` : null,
      printRegionQuad: parseQuad(String(s.props["Print Region Quad (JSON)"] ?? "")),
      /** listing colours this template can actually produce, display-cased */
      coverage: covered.map((c) => colourDisplay.get(c) ?? c),
      /** one variant per colour after the duplicate guard, so yield = coverage */
      yield: covered.length,
      /** the template only exists in ONE colour at all — the sketch's amber lock */
      colourLocked: all.size === 1,
      hasGeometry: String(s.props["Crop Rect (JSON)"] ?? "").trim().length > 0,
    };
  });

  // distinct TEMPLATES behind the planned tiles — a shot-less hand
  // intake counts as its own template of one
  const templatesInPlay = new Set(plan.tiles.map((t) => shotOfVariant.get(t.variantId) ?? t.variantId)).size;

  return {
    listingId: rec.id,
    ready: {
      printifyProduct: String(rec.props["Printify Product ID"] ?? "").trim().length > 0,
      psdMaster: String(design?.props["Master PNG Link"] ?? "").trim().length > 0,
      templatesInPlay,
      variantCount: new Set(plan.tiles.map((t) => t.variantId)).size,
      colours: slots.availableColors,
    },
    allTemplates,
    hidden: {
      count: hiddenShots.length,
      example: hiddenShots[0]?.title ?? null,
    },
    generateJob: (() => {
      const j = generateJobStatus(rec.id);
      return j
        ? { status: j.status, done: j.done, total: j.total, rendered: j.rendered, results: j.results }
        : null;
    })(),
    productName: product ? productLabel(product) : null,
    shortlist: slots.shortlist,
    tiles,
    infoGraphics,
    artOverrides: perColourArt(rec),
    designId: designId ?? null,
    masterLink: String(design?.props["Master PNG Link"] ?? "").trim(),
    placement: parsePlacementMap(String(rec.props["Mockup Placement (JSON)"] ?? "")),
    // the REAL print area — px from Printify's catalog; inches DERIVED as
    // px / DPI (300 assumed unless the product sets Print DPI, and the
    // readout says so). One input, no hand-copied inches to misread.
    printArea: (() => {
      const wPx = Number(product?.props["Max Print Width px"]) || null;
      const hPx = Number(product?.props["Max Print Height px"]) || null;
      const setDpi = Number(product?.props["Print DPI"]) || null;
      const dpi = setDpi ?? 300;
      return {
        wPx,
        hPx,
        wIn: wPx ? wPx / dpi : null,
        hIn: hPx ? hPx / dpi : null,
        dpi,
        dpiAssumed: setDpi === null,
      };
    })(),
  };
}

/**
 * L7's inputs — the exact bundle the push applies, plus the push record.
 * Reuses the slots and pricing views so the preview can never disagree
 * with the steps that own the content.
 */
function pushData(
  rec: NonNullable<ReturnType<typeof cachedRecord>>,
  slots: SlotsData,
  pricing: PricingData
): PushData {
  const filled = slots.slots
    .filter((s) => s.status === "Made" || s.status === "Placed")
    .map((s) => ({ position: s.position, label: s.label, isGraphic: Boolean(s.productLinkRole) }));

  const norm = (c: string) => c.trim().toLowerCase();
  const colours = (() => {
    try {
      const parsed = JSON.parse(String(rec.props["Colorways (JSON)"] ?? "[]"));
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  })();
  const available = new Set(slots.availableColors.map(norm));

  return {
    listingId: rec.id,
    etsyReady: etsyConfigured() && etsyConnectionStatus().connected,
    etsyListingId: String(rec.props["Etsy Listing ID"] ?? "").trim(),
    pushedAt: String(rec.props["Pushed At"] ?? "").trim() || null,
    gallery: filled,
    title: String(rec.props["Title"] ?? "").trim(),
    price: pricing.price,
    cost: pricing.cost,
    shippingCharged: pricing.product?.shippingCharged ?? null,
    shippingCost: pricing.product?.estimatedShippingCost ?? null,
    shippingConfirmed: pricing.shippingConfirmed,
    colours,
    coloursAllAvailable: colours.length > 0 && colours.every((c) => available.has(norm(c))),
    hook: String(rec.props["Description Hook"] ?? "").trim(),
    bodyCopy: String(rec.props["Body Copy"] ?? "").trim(),
    tags: String(rec.props["Tags"] ?? "").split(",").map((t) => t.trim()).filter(Boolean),
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
    shippingConfirmed: Boolean(rec.props["Shipping Profile Confirmed"]),
    shippingConfirmedAt: String(rec.props["Shipping Confirmed At"] ?? ""),
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

  // Other listings on the SAME design that already carry approved tags —
  // a spinoff (hoodie off a sweatshirt) shouldn't re-screen the shortlist
  // from scratch. Matched on any shared design, not just the first: a
  // listing can carry several, and sharing one is enough to make the tag
  // work relevant. Read-only reference; nothing here writes to a sibling.
  const myDesigns = new Set((rec.props["Designs"] as string[] | null) ?? []);
  const siblings: SeoData["siblings"] =
    myDesigns.size === 0
      ? []
      : cachedRecords("etsy_listings")
          .filter((l) => {
            if (l.id === listingId) return false;
            const theirs = (l.props["Designs"] as string[] | null) ?? [];
            return theirs.some((d) => myDesigns.has(d));
          })
          .map((l) => {
            const productRel = ((l.props["Product"] as string[] | null) ?? [])[0];
            const prod = productRel
              ? cachedRecords("products").find((p) => p.id === productRel)
              : null;
            return {
              id: l.id,
              name: l.title || "Untitled listing",
              productName: prod ? productLabel(prod) : null,
              tags: String(l.props["Tags"] ?? "")
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              hook: String(l.props["Description Hook"] ?? "").trim(),
            };
          })
          // Empty siblings stay listed on purpose: the panel existing is
          // how the operator knows the design linkage works at all. What
          // they have (or don't) renders as explicit empty states inside.
          .sort((a, b) => a.name.localeCompare(b.name));

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
    siblings,
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
