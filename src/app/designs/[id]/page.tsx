import Link from "next/link";
import { notFound } from "next/navigation";
import { cachedRecord, cachedRecords } from "@/server/notion/store";
import { runnerRecord } from "@/server/viewmodels";
import { StepRunner } from "@/components/StepRunner";
import type { StyleOption, SavedPair, CandidateData } from "@/components/ApplyPanel";
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
