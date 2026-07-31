"use client";

/**
 * Step runner — walks one record through its workflow with state.
 * Backward transitions are normal, never styled as destructive. Backtracks
 * require a reason (logged), and mark per-step downstream dependencies stale.
 * Stale steps offer "Still valid" as a first-class action.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiJson } from "@/lib/api";
import { WORKFLOWS, downstreamOf, stepIndex, type StepStatus } from "@/lib/workflows";
import { StepIcon, Kicker } from "./ui";
import { StyleCapture } from "./StyleCapture";
import { ApplyPanel, CandidatesBoard, WinnerEditor, type StyleOption, type SavedPair, type CandidateData } from "./ApplyPanel";
import { KeywordSeoPanel, type SeoData } from "./KeywordSeoPanel";
import { ImageSlotsPanel, type SlotsData } from "./ImageSlotsPanel";
import { ArtworkCapture, type ArtworkData } from "./ArtworkCapture";
import { MasterAssets, type MasterAssetsData } from "./MasterAssets";
import { TextTreatment, type TextTreatmentData } from "./TextTreatment";
import { TexturePick, type TextureData } from "./TexturePick";
import { StandingConstraints } from "./StandingConstraints";
import { ColorwaysPanel, type ColorwaysData } from "./ColorwaysPanel";
import { PrintCheck, type PrintCheckData } from "./PrintCheck";

export interface RunnerRecord {
  id: string;
  title: string;
  workflowKey: "creative" | "listing";
  current: string;
  steps: Record<string, { status: StepStatus; note?: string; at?: string }>;
  gates?: Array<{ label: string; ok: boolean }>;
  /** step id → why "done" is blocked; enforced server-side too */
  blockedDone?: Record<string, string>;
}

async function stepAction(body: Record<string, unknown>): Promise<string | null> {
  const res = await apiJson("/api/step", "POST", body);
  return res.ok ? null : res.error;
}

export function StepRunner({
  record,
  styles,
  savedPair,
  candidates,
  seo,
  slots,
  artwork,
  masterAssets,
  textTreatment,
  texture,
  printCheck,
  colorways,
}: {
  record: RunnerRecord;
  styles?: StyleOption[];
  savedPair?: SavedPair;
  candidates?: CandidateData[];
  seo?: SeoData;
  slots?: SlotsData;
  artwork?: ArtworkData;
  masterAssets?: MasterAssetsData;
  textTreatment?: TextTreatmentData;
  texture?: TextureData;
  printCheck?: PrintCheckData;
  colorways?: ColorwaysData;
}) {
  const wf = WORKFLOWS[record.workflowKey];
  const router = useRouter();
  const terminal = record.workflowKey === "creative" ? "Done" : "Pushed";
  const isTerminal = record.current === terminal;

  const [selectedId, setSelectedId] = useState(isTerminal ? wf.steps[wf.steps.length - 1].id : record.current);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backDialog, setBackDialog] = useState<string | null>(null);
  const [backReason, setBackReason] = useState("");

  const selected = wf.steps.find((s) => s.id === selectedId) ?? wf.steps[0];
  const selectedStatus: StepStatus = record.steps[selected.id]?.status ?? "pending";
  const selIdx = stepIndex(wf, selected.id);
  const currentIdx = isTerminal ? wf.steps.length : stepIndex(wf, record.current);

  const staleDownstream = useMemo(
    () =>
      downstreamOf(wf, selected.id).filter((id) => record.steps[id]?.status === "done"),
    [wf, selected.id, record.steps]
  );

  async function run(label: string, body: Record<string, unknown>) {
    setBusy(label);
    setError(null);
    const err = await stepAction({ pageId: record.id, ...body });
    if (err) setError(err);
    else router.refresh();
    setBusy(null);
  }

  const doneCount = wf.steps.filter((s) => record.steps[s.id]?.status === "done").length;
  const doneBlocker = record.blockedDone?.[selected.id] ?? null;

  return (
    <div className="stack-22">
      {/* step rail */}
      <div className="step-rail" role="tablist" aria-label={`${wf.name} steps`}>
        {wf.steps.map((step, i) => {
          const status: StepStatus = record.steps[step.id]?.status ?? "pending";
          const isSelected = step.id === selected.id;
          return (
            <span key={step.id} style={{ display: "contents" }}>
              {i > 0 ? (
                <span
                  className={`connector${
                    record.steps[wf.steps[i - 1].id]?.status === "done" ? " done" : ""
                  }`}
                />
              ) : null}
              <button
                role="tab"
                aria-selected={isSelected}
                className={`step${isSelected ? " selected" : ""}`}
                onClick={() => setSelectedId(step.id)}
              >
                <StepIcon status={status} selected={isSelected} />
                <span className="step-label">{step.label}</span>
              </button>
            </span>
          );
        })}
      </div>

      <div className="runner-grid">
        {/* step card + the tools that live under it */}
        <div className="stack-16">
        <div className="card">
          <Kicker>
            STEP {selIdx + 1} OF {wf.steps.length}
            {step_pos(selIdx, currentIdx)}
          </Kicker>
          <div className="card-title">{selected.title}</div>

          {selectedStatus === "stale" ? (
            <div className="callout stale">
              This step went stale{record.steps[selected.id]?.note ? ` — ${record.steps[selected.id]!.note}` : ""}.
              Redo it, or confirm it&apos;s still valid below.
            </div>
          ) : null}
          {selectedStatus === "blocked" ? (
            <div className="callout blocked">
              Blocked{record.steps[selected.id]?.note ? `: ${record.steps[selected.id]!.note}` : ""}.
            </div>
          ) : null}
          {selected.note ? <div className="body-sm muted">{selected.note}</div> : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            <div className="well">
              <Kicker>NEEDS</Kicker>
              <ul style={{ margin: "8px 0 0 18px" }}>
                {selected.needs.map((n) => (
                  <li key={n} className="body-sm">{n}</li>
                ))}
              </ul>
            </div>
            <div className="well">
              <Kicker>PRODUCES</Kicker>
              <ul style={{ margin: "8px 0 0 18px" }}>
                {selected.produces.map((p) => (
                  <li key={p} className="body-sm">{p}</li>
                ))}
              </ul>
            </div>
          </div>

          {error ? <div className="field-error">{error}</div> : null}

          <div className="row-gap-12">
            <button
              className="btn btn-primary"
              disabled={busy !== null || selectedStatus === "done"}
              title={doneBlocker ?? undefined}
              // the requirement is explained on attempt, not pre-emptively —
              // a warning shown before you've done anything is just noise
              onClick={() => (doneBlocker ? setError(doneBlocker) : run("done", { action: "done", step: selected.id }))}
            >
              {busy === "done" ? <span className="spinner" /> : null}
              Mark step done
            </button>
            {/* Backward navigation is a normal secondary action, never destructive */}
            <button
              className="btn btn-secondary"
              disabled={busy !== null || selIdx >= currentIdx}
              onClick={() => {
                setBackReason("");
                setBackDialog(selected.id);
              }}
            >
              ← Back to this step
            </button>
            {selectedStatus === "stale" ? (
              <button
                className="btn btn-tertiary"
                disabled={busy !== null}
                onClick={() => run("still-valid", { action: "still-valid", step: selected.id })}
              >
                Still valid
              </button>
            ) : null}
            {selectedStatus === "blocked" ? (
              <button
                className="btn btn-tertiary"
                disabled={busy !== null}
                onClick={() => run("unblock", { action: "unblock", step: selected.id })}
              >
                Unblock
              </button>
            ) : (
              <button
                className="btn btn-tertiary"
                disabled={busy !== null || selectedStatus === "done"}
                onClick={() => {
                  const reason = window.prompt("What's blocking this step? Name the unblocking condition:");
                  if (reason != null) run("block", { action: "block", step: selected.id, reason });
                }}
              >
                Mark blocked
              </button>
            )}
          </div>
        </div>

        {/* C1 is where styles meet this design's content. Apply composes the
            candidate set; Capture births a style from a reference without
            leaving the runner (spec §9.2). Outside the step card — these are
            work surfaces, not step state. Collapsed buttons share one row. */}
        {record.workflowKey === "creative" && selected.id === "C1" ? (
          <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "stretch" }}>
            <ApplyPanel
              designId={record.id}
              styles={styles ?? []}
              saved={savedPair ?? { styleId: null, imagePrompt: "", textPrompt: "", textureNote: "" }}
              hasCandidates={(candidates ?? []).length > 0}
            />
            <StyleCapture compact />
          </div>
        ) : null}

        {/* L1: record which colourways the Printify product actually enables —
            downstream template offers filter against this list */}
        {record.workflowKey === "listing" && selected.id === "L1" && colorways ? (
          <ColorwaysPanel data={colorways} />
        ) : null}

        {/* L2 is where title and tags are written — attached keywords by
            bucket, the 13-tag composer, manual entry. Outside the step card,
            same as the C1 tools. */}
        {record.workflowKey === "listing" && selected.id === "L2" && seo ? (
          <KeywordSeoPanel seo={seo} />
        ) : null}

        {/* L5 is the slot plan — assemble the ordered image set */}
        {record.workflowKey === "listing" && selected.id === "L5" && slots ? (
          <ImageSlotsPanel data={slots} />
        ) : null}

        {/* C2's output: which generation won, and the board's first thumbnail.
            The standing constraints sit above it — they belong to the prompt
            you're about to paste into Kittl, not to the result. */}
        {record.workflowKey === "creative" && selected.id === "C2" ? <StandingConstraints /> : null}
        {record.workflowKey === "creative" && selected.id === "C2" && artwork ? (
          <ArtworkCapture data={artwork} />
        ) : null}


        {/* C3's output: how the lettering was produced, and what was set */}
        {record.workflowKey === "creative" && selected.id === "C3" && textTreatment ? (
          <TextTreatment data={textTreatment} />
        ) : null}

        {/* C6's output: which texture, and how it was applied */}
        {record.workflowKey === "creative" && selected.id === "C6" && texture ? (
          <TexturePick data={texture} />
        ) : null}

        {/* C7's output: PSD master, the PNG exported from it, final preview */}
        {record.workflowKey === "creative" && selected.id === "C7" && masterAssets ? (
          <MasterAssets data={masterAssets} />
        ) : null}

        {/* C8: the garment call, and the pixels the eye can't audit */}
        {record.workflowKey === "creative" && selected.id === "C8" && printCheck ? (
          <PrintCheck data={printCheck} />
        ) : null}

        {/* the candidate set follows the design to C2 — generate each image
            prompt there, then crown the winner. A design with a committed
            pair but NO candidates (a spin-off) gets the editable pair
            directly: the carried prompts must be visible and revisable
            wherever the design is worked on, and edits save to the record. */}
        {record.workflowKey === "creative" &&
        (selected.id === "C1" || selected.id === "C2") &&
        (candidates ?? []).length > 0 ? (
          <CandidatesBoard
            designId={record.id}
            candidates={candidates!}
            chosenImagePrompt={savedPair?.imagePrompt ?? ""}
            focusWinner={selected.id === "C2"}
            saved={savedPair}
          />
        ) : record.workflowKey === "creative" &&
          (selected.id === "C1" || selected.id === "C2") &&
          savedPair &&
          (savedPair.imagePrompt || savedPair.textPrompt) ? (
          <WinnerEditor designId={record.id} saved={savedPair} />
        ) : null}
        </div>

        {/* right panel */}
        <div className="stack-16">
          <div className="gate-panel">
            <div className="panel-title">
              {record.workflowKey === "listing" ? "Publish gates" : "Gate check"}
            </div>
            {(record.gates ?? []).length === 0 ? (
              <div className="gate-item ok">Nothing failing right now.</div>
            ) : (
              record.gates!.map((g) => (
                <div key={g.label} className={`gate-item${g.ok ? " ok" : ""}`}>
                  {g.ok ? "✓ " : ""}{g.label}
                </div>
              ))
            )}
          </div>
          <div className="card supporting">
            <Kicker>PROGRESS</Kicker>
            <div className="body-sm">
              {doneCount} of {wf.steps.length} steps done
              {isTerminal ? " — workflow complete." : ` · current: ${record.current}`}
            </div>
          </div>
        </div>
      </div>

      {/* backtrack dialog — reason required, downstream impact shown up front */}
      {backDialog ? (
        <div className="modal-scrim" onClick={() => setBackDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-title">Back to {selected.title}</div>
            {staleDownstream.length > 0 ? (
              <div className="callout stale">
                Redoing this step marks {staleDownstream.join(", ")} stale — they consume what this
                step produces. Steps that don&apos;t depend on it stay done.
              </div>
            ) : (
              <div className="body-sm muted">No completed downstream steps depend on this one.</div>
            )}
            <div className="field">
              <label className="kicker" htmlFor="back-reason">WHY ARE YOU GOING BACK?</label>
              <input
                id="back-reason"
                className="input"
                placeholder="e.g. artwork ratio wrong for blanket"
                value={backReason}
                onChange={(e) => setBackReason(e.target.value)}
                autoFocus
              />
              <span className="hint">Logged — after ten designs this shows where the process leaks.</span>
            </div>
            <div className="row-gap-12">
              <button
                className="btn btn-secondary"
                disabled={busy !== null || backReason.trim() === ""}
                onClick={async () => {
                  await run("back", { action: "back", step: backDialog, reason: backReason.trim() });
                  setBackDialog(null);
                }}
              >
                {busy === "back" ? <span className="spinner" /> : null}
                ← Back a step
              </button>
              <button className="btn btn-tertiary" onClick={() => setBackDialog(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function step_pos(selIdx: number, currentIdx: number): string {
  if (selIdx < currentIdx) return " · EARLIER STEP";
  if (selIdx > currentIdx) return " · UPCOMING";
  return "";
}
