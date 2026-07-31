import Link from "next/link";
import { notFound } from "next/navigation";
import { cachedRecord, cachedRecords } from "@/server/notion/store";
import { runnerRecord, productLabel } from "@/server/viewmodels";
import { StepRunner } from "@/components/StepRunner";
import type { StyleOption, SavedPair, CandidateData } from "@/components/ApplyPanel";
import type { ArtworkData } from "@/components/ArtworkCapture";
import type { MasterAssetsData } from "@/components/MasterAssets";
import type { TextTreatmentData } from "@/components/TextTreatment";
import type { TextureData } from "@/components/TexturePick";
import type { PrintCheckData } from "@/components/PrintCheck";
import type { FanOutData } from "@/components/FanOutPanel";
import { ProductPicker } from "@/components/ProductPicker";
import { Kicker } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DesignRunnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = cachedRecord(id);
  if (!rec || rec.dbKey !== "designs") notFound();

  const canvasRaw = rec.props["Master Canvas (JSON)"];
  let canvas: Array<{ position: string; maxWidth: number; maxHeight: number; ratioLabel: string }> = [];
  if (typeof canvasRaw === "string" && canvasRaw.trim()) {
    try { canvas = JSON.parse(canvasRaw); } catch { canvas = []; }
  }

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <Kicker><Link href="/designs">DESIGNS</Link> / CREATIVE WORKFLOW</Kicker>
          <h1 className="page-title" style={{ textTransform: "none", letterSpacing: 0 }}>{rec.title || "Untitled design"}</h1>
        </div>
        <ProductPicker
          designId={rec.id}
          products={cachedRecords("products").map((p) => ({ id: p.id, name: p.title }))}
          currentId={(rec.props["Primary Product"] as string[] | null)?.[0] ?? null}
        />
      </div>
      {canvas.length > 0 ? (
        <div className="well" style={{ marginBottom: 22 }}>
          <Kicker>MASTER CANVAS — GENERATE AT RATIO, EXPORT AT PIXELS</Kicker>
          <div className="body-sm" style={{ marginTop: 6 }}>
            {canvas.map((a) => `${a.position}: ${a.maxWidth}×${a.maxHeight}px (${a.ratioLabel})`).join(" · ")}
          </div>
        </div>
      ) : null}
      <StepRunner
        record={runnerRecord(rec)}
        styles={styleOptions()}
        savedPair={savedPair(rec)}
        candidates={parseCandidates(rec)}
        artwork={artworkData(rec)}
        masterAssets={masterAssetsData(rec)}
        textTreatment={{
          designId: rec.id,
          textSource: String(rec.props["Text Source"] ?? ""),
          textDetail: String(rec.props["Text Detail"] ?? ""),
        }}
        printCheck={printCheckData(rec)}
        fanOut={fanOutData(rec)}
        texture={{
          designId: rec.id,
          textureId: (rec.props["Texture"] as string[] | null)?.[0] ?? null,
          textureDetail: String(rec.props["Texture Detail"] ?? ""),
          snapshotUrl: artworkData(rec).snapshotUrl,
          textures: cachedRecords("textures").map((t) => ({
            id: t.id,
            name: t.title,
            source: String(t.props["Source"] ?? ""),
          })),
        }}
      />
    </div>
  );
}

function styleOptions(): StyleOption[] {
  return cachedRecords("styles").map((s) => ({
    id: s.id,
    name: s.title,
    category: String(s.props["Category"] ?? ""),
    slots: String(s.props["Slots"] ?? ""),
  }));
}

function printCheckData(rec: NonNullable<ReturnType<typeof cachedRecord>>): PrintCheckData {
  const productId = (rec.props["Primary Product"] as string[] | null)?.[0] ?? null;
  const product = productId ? cachedRecords("products").find((p) => p.id === productId) : null;
  // colours the primary product actually offers — the set the compatibility
  // call filters. No product chosen yet just means nothing to filter.
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
  return {
    designId: rec.id,
    compatibility: String(rec.props["Garment Compatibility"] ?? ""),
    reason: String(rec.props["Garment Compatibility Reason"] ?? ""),
    checked: Boolean(rec.props["Print File Checked"]),
    notes: String(rec.props["Print File Check Notes"] ?? ""),
    colors,
    productName: product?.title ?? null,
  };
}

/** Ratio of a product's first print area, from its stored Print Areas JSON. */
function frontRatio(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const areas = JSON.parse(raw) as Array<{ maxWidth?: number; maxHeight?: number }>;
    const a = areas?.[0];
    return a?.maxWidth && a?.maxHeight ? a.maxWidth / a.maxHeight : null;
  } catch {
    return null;
  }
}

function fanOutData(rec: NonNullable<ReturnType<typeof cachedRecord>>): FanOutData {
  const listings = cachedRecords("etsy_listings").filter((l) =>
    ((l.props["Designs"] as string[] | null) ?? []).includes(rec.id)
  );
  const primaryId = ((rec.props["Primary Product"] as string[] | null) ?? [])[0] ?? null;
  // the master was composed for the PRIMARY product's shape — anything that
  // deviates >12% needs recomposition, not scaling (same bar as the seed)
  const masterRatio = frontRatio(rec.props["Master Canvas (JSON)"]);
  const products = cachedRecords("products").map((p) => {
    const listing = listings.find((l) =>
      ((l.props["Product"] as string[] | null) ?? []).includes(p.id)
    );
    const ratio = frontRatio(p.props["Print Areas (JSON)"]);
    return {
      id: p.id,
      label: productLabel(p),
      category: String(p.props["Category"] ?? "") || null,
      isPrimary: p.id === primaryId,
      needsRecompose:
        masterRatio != null && ratio != null && Math.abs(ratio - masterRatio) / masterRatio > 0.12,
      listingId: listing?.id ?? null,
      listingTitle: listing?.title ?? null,
    };
  });
  // primary first, then the Products page's group order (apparel, home,
  // wall art, misc, uncategorised) — no headers, just the familiar sequence
  const CAT_ORDER = ["apparel", "home", "wall_art", "misc"];
  const catRank = (c: string | null) => {
    const i = c ? CAT_ORDER.indexOf(c) : -1;
    return i === -1 ? CAT_ORDER.length : i;
  };
  products.sort((a, b) =>
    Number(b.isPrimary) - Number(a.isPrimary) ||
    catRank(a.category) - catRank(b.category) ||
    a.label.localeCompare(b.label)
  );
  return {
    designId: rec.id,
    designTitle: rec.title || "Untitled design",
    kind: String(rec.props["Physical/Digital"] ?? "Physical"),
    products,
  };
}

/** Snapshot preview through the thumb proxy — card-sized, stable, cacheable. */
function thumbUrl(rec: NonNullable<ReturnType<typeof cachedRecord>>): string | null {
  const snap = rec.props["Artwork Snapshot"];
  const has = Array.isArray(snap) && snap.length > 0 && (snap[0] as { url?: string }).url;
  return has ? `/api/designs/${rec.id}/thumb?v=${encodeURIComponent(rec.lastEdited)}` : null;
}

function masterAssetsData(rec: NonNullable<ReturnType<typeof cachedRecord>>): MasterAssetsData {
  // biggest print area on the primary product — the bar the master must clear
  let requiredWidth: number | null = null;
  let requiredHeight: number | null = null;
  const canvasRaw = rec.props["Master Canvas (JSON)"];
  if (typeof canvasRaw === "string" && canvasRaw.trim()) {
    try {
      const areas = JSON.parse(canvasRaw) as Array<{ maxWidth?: number; maxHeight?: number }>;
      for (const a of areas) {
        if ((a.maxWidth ?? 0) > (requiredWidth ?? 0)) requiredWidth = a.maxWidth ?? null;
        if ((a.maxHeight ?? 0) > (requiredHeight ?? 0)) requiredHeight = a.maxHeight ?? null;
      }
    } catch {
      /* unparseable canvas just means no check */
    }
  }
  return {
    designId: rec.id,
    psdLink: String(rec.props["PSD Master Link"] ?? ""),
    psdSavedAt: String(rec.props["PSD Saved At"] ?? "") || null,
    masterPngLink: String(rec.props["Master PNG Link"] ?? ""),
    snapshotUrl: thumbUrl(rec),
    masterWidth: typeof rec.props["Master Width"] === "number" ? rec.props["Master Width"] : null,
    masterHeight: typeof rec.props["Master Height"] === "number" ? rec.props["Master Height"] : null,
    requiredWidth,
    requiredHeight,
  };
}

function artworkData(rec: NonNullable<ReturnType<typeof cachedRecord>>): ArtworkData {
  return {
    designId: rec.id,
    snapshotUrl: thumbUrl(rec),
    artworkLink: String(rec.props["Master PNG Link"] ?? ""),
    winningModel: String(rec.props["Winning Model"] ?? ""),
  };
}

function parseCandidates(rec: NonNullable<ReturnType<typeof cachedRecord>>): CandidateData[] {
  const raw = rec.props["Prompt Candidates (JSON)"];
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CandidateData[]) : [];
  } catch {
    return [];
  }
}

function savedPair(rec: NonNullable<ReturnType<typeof cachedRecord>>): SavedPair {
  const styleId = (rec.props["Style"] as string[] | null)?.[0] ?? null;
  // The style's library title; a suggested-direction spin-off has no Style
  // relation, but its name was minted "<source> — <style>" — use the suffix.
  const fromLibrary = styleId ? cachedRecords("styles").find((s) => s.id === styleId)?.title : null;
  const parts = (rec.title ?? "").split(" — ");
  const fromTitle = parts.length > 1 ? parts[parts.length - 1] : null;
  return {
    styleId,
    styleName: fromLibrary || fromTitle || null,
    imagePrompt: String(rec.props["Image Prompt"] ?? ""),
    textPrompt: String(rec.props["Text Prompt"] ?? ""),
    textureNote: String(rec.props["Texture Note"] ?? ""),
  };
}
