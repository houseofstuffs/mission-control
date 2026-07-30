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
import { apiCall, apiJson } from "@/lib/api";
import { Kicker } from "./ui";

export interface NicheCardData {
  id: string;
  name: string;
  gate: string;
  gateReason: string;
  beatThesis: string;
  screeningStatus: string;
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
    const res = await apiJson(`/api/niches/${id}`, "PATCH", body);
    if (!res.ok) setError(res.error);
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
              <div className="row-gap-8" style={{ alignItems: "center" }}>
                <div
                  className={`title${n.gate === "Killed" ? " killed-title" : ""}`}
                  style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={n.name}
                >
                  {n.name}
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${n.name}`}
                  title="Delete"
                  disabled={busyId === n.id}
                  onClick={async () => {
                    if (!window.confirm(`Delete "${n.name}"? It moves to Notion's trash, recoverable for 30 days.`)) return;
                    const res = await apiCall(`/api/niches/${n.id}`, { method: "DELETE" });
                    if (!res.ok) setError(res.error);
                    else router.refresh();
                  }}
                  style={{
                    flexShrink: 0, width: 22, height: 22, display: "inline-flex", alignItems: "center",
                    justifyContent: "center", padding: 0, border: "none", background: "transparent",
                    cursor: "pointer", color: "var(--text-secondary, #8a7a5c)",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
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
                {/* Killed stays a valid value (set in Notion, still renders
                    struck through here) but isn't offered as a choice. */}
                {n.gate === "Killed" ? <option value="Killed">Killed</option> : null}
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

              {/* the creative gate reads this — designs in this niche stay
                  flagged until the printed phrases have been searched */}
              <select
                className="select input-compact"
                style={{
                  height: 32,
                  ...(n.screeningStatus === "Screened clear"
                    ? {}
                    : { borderColor: "var(--status-blocked, #d7242a)" }),
                }}
                value={n.screeningStatus || "Not screened"}
                disabled={busyId === n.id}
                onChange={(e) => save(n.id, { screeningStatus: e.target.value })}
              >
                <option value="Not screened">Not screened</option>
                <option value="Phrases emitted">Phrases emitted</option>
                <option value="Screened clear">Screened clear</option>
                <option value="Screened flagged">Screened flagged</option>
              </select>

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
