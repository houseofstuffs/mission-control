"use client";

/**
 * Niche gate decisions (R7) on the dashboard — greenlit / parked / killed
 * with the one-line reason and the "I can beat this" thesis. Greenlighting
 * here is what unlocks a niche in the New design dialog.
 *
 * Deeper research fields (keyword banks, saturation read, screening) stay in
 * Notion; this is the decision, not the research.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";

export interface NicheCardData {
  id: string;
  name: string;
  gate: string;
  gateReason: string;
  beatThesis: string;
  evaluatedAt: string | null;
  ideaCount: number;
  designCount: number;
}

const GATE_CHIP: Record<string, { cls: string; label: string }> = {
  Greenlit: { cls: "done", label: "✓ greenlit" },
  Parked: { cls: "parked", label: "❙❙ parked" },
  Killed: { cls: "killed", label: "✕ killed" },
  Unevaluated: { cls: "neutral", label: "unevaluated" },
};

export function NichesPanel({ niches }: { niches: NicheCardData[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function save(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/niches/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Update failed");
    else router.refresh();
    setBusyId(null);
  }

  if (niches.length === 0) return null;

  return (
    <div className="stack-12">
      <Kicker>NICHES · {niches.length}</Kicker>
      {error ? <div className="callout blocked">{error}</div> : null}
      <div className="inbox-grid">
        {niches.map((n) => {
          const chip = GATE_CHIP[n.gate] ?? GATE_CHIP.Unevaluated;
          const reasonValue = drafts[n.id] ?? n.gateReason;
          return (
            <div key={n.id} className="idea-card">
              <div className={`title${n.gate === "Killed" ? " killed-title" : ""}`}>{n.name}</div>
              <div className="row-gap-8">
                <span className={`chip ${chip.cls}`}>{chip.label}</span>
                <span className="hint">
                  {n.ideaCount} idea{n.ideaCount === 1 ? "" : "s"} · {n.designCount} design
                  {n.designCount === 1 ? "" : "s"}
                </span>
              </div>

              <select
                className="select input-compact"
                style={{ height: 32 }}
                value={n.gate}
                disabled={busyId === n.id}
                onChange={(e) => save(n.id, { gate: e.target.value })}
              >
                <option value="Unevaluated">Unevaluated</option>
                <option value="Greenlit">Greenlit — ready for designs</option>
                <option value="Parked">Parked — right idea, wrong time</option>
                <option value="Killed">Killed — with a reason</option>
              </select>

              <input
                className="input input-compact"
                style={{ height: 32 }}
                placeholder="One-line reason"
                value={reasonValue}
                disabled={busyId === n.id}
                onChange={(e) => setDrafts((d) => ({ ...d, [n.id]: e.target.value }))}
                onBlur={() => {
                  if (reasonValue !== n.gateReason) save(n.id, { gateReason: reasonValue });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />

              {n.gate === "Greenlit" && !n.beatThesis ? (
                <span className="hint">
                  Add the &ldquo;I can beat this&rdquo; thesis in Notion — it&apos;s what you check
                  against sales data later.
                </span>
              ) : null}
              {n.beatThesis ? <div className="body-sm">{n.beatThesis}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
