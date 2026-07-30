import Link from "next/link";
import { notFound } from "next/navigation";
import { cachedRecord, cachedRecords } from "@/server/notion/store";
import { runnerRecord } from "@/server/viewmodels";
import { StepRunner } from "@/components/StepRunner";
import type { StyleOption, SavedPair, CandidateData } from "@/components/ApplyPanel";
import type { ArtworkData } from "@/components/ArtworkCapture";
import type { MasterAssetsData } from "@/components/MasterAssets";
import type { TextTreatmentData } from "@/components/TextTreatment";
import type { TextureData } from "@/components/TexturePick";
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

function masterAssetsData(rec: NonNullable<ReturnType<typeof cachedRecord>>): MasterAssetsData {
  const snap = rec.props["Artwork Snapshot"];
  const first = Array.isArray(snap) && snap.length > 0 ? (snap[0] as { url?: string }) : null;
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
    snapshotUrl: first?.url || null,
    masterWidth: typeof rec.props["Master Width"] === "number" ? rec.props["Master Width"] : null,
    masterHeight: typeof rec.props["Master Height"] === "number" ? rec.props["Master Height"] : null,
    requiredWidth,
    requiredHeight,
  };
}

function artworkData(rec: NonNullable<ReturnType<typeof cachedRecord>>): ArtworkData {
  const snap = rec.props["Artwork Snapshot"];
  const first = Array.isArray(snap) && snap.length > 0 ? (snap[0] as { url?: string }) : null;
  return {
    designId: rec.id,
    snapshotUrl: first?.url || null,
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
  return {
    styleId: (rec.props["Style"] as string[] | null)?.[0] ?? null,
    imagePrompt: String(rec.props["Image Prompt"] ?? ""),
    textPrompt: String(rec.props["Text Prompt"] ?? ""),
    textureNote: String(rec.props["Texture Note"] ?? ""),
  };
}
