"use client";

/**
 * L4 — generate mockups. The automated pipeline plus its review gate.
 *
 * Generate runs the server-side job (src/server/mockup/generateJob.ts):
 * the SAME renderMockup module the Test render button always used, looped
 * over the shared plan (src/server/mockup/plan.ts), surviving navigation
 * like the Drive import does. Tiles join their generated_mockups record —
 * image through the stable file route, verdict persisted on the record.
 *
 * Approve-by-default is deliberate: the operator flags the misses, rather
 * than clicking through a dozen good ones to bless each.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker, Spinner } from "./ui";
import { apiCall, apiJson } from "@/lib/api";

export interface MockupTile {
  templateId: string;
  templateName: string;
  shotType: string;
  colour: string;
  /** the render, through the stable file route. Null = not generated yet. */
  url: string | null;
  /** the generated_mockups record behind the url */
  generatedId: string | null;
  /** persisted verdict; null until a render exists */
  verdict: "Approved" | "Flagged" | null;
}

export interface GenerateJobView {
  status: "running" | "complete" | "interrupted";
  total: number;
  done: number;
  rendered: number;
  results: Array<{ name: string; detail: string; ok: boolean }>;
}

export interface MockupsData {
  listingId: string;
  ready: {
    printifyProduct: boolean;
    psdMaster: boolean;
    /** distinct TEMPLATES contributing to the plan — house terminology:
     *  template = the shot, variant = template×colour. Counting variants
     *  under a "templates" label printed "6 templates" with 2 assigned. */
    templatesInPlay: number;
    /** colour variants usable for this listing (the L5 filter, reused) */
    variantCount: number;
    colours: string[];
  };
  tiles: MockupTile[];
  /** compatible templates, with what each contributes to THIS listing */
  allTemplates: Array<{
    id: string;
    name: string;
    shotType: string;
    thumbUrl: string | null;
    printRegionQuad: Array<{ x: number; y: number }> | null;
    /** the listing colours this template can produce, display-cased */
    coverage: string[];
    /** mockups it yields for this listing (one variant per colour) */
    yield: number;
    /** exists in exactly one colour — the amber lock */
    colourLocked: boolean;
    hasGeometry: boolean;
  }>;
  /** templates for OTHER products, hidden from the picker */
  hidden: { count: number; example: string | null };
  /** the compositor's last known run for this listing */
  generateJob: GenerateJobView | null;
  productName: string | null;
  /** template ids assigned to THIS listing — drives the plan and L5's offers */
  shortlist: string[];
  /** the Product's reusable graphics — built once per blueprint, not per
   *  listing. url null = expected by the slot plan but not built yet; that
   *  absence renders as a "needed" pill, never silence. */
  infoGraphics: Array<{ label: string; url: string | null }>;
}

type Verdict = "approved" | "flagged";

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

const READY_LABEL: Array<[keyof MockupsData["ready"], string]> = [
  ["printifyProduct", "Printify product"],
  ["psdMaster", "PSD master"],
  ["colours", "Mockup colours"],
];

/** the sketch's thumbnail: sample image with the print-region quad's
 *  bounding box drawn as a dashed overlay */
function TemplateThumb({ t }: { t: MockupsData["allTemplates"][number] }) {
  const q = t.printRegionQuad;
  const box = q
    ? {
        left: `${Math.min(...q.map((p) => p.x)) * 100}%`,
        top: `${Math.min(...q.map((p) => p.y)) * 100}%`,
        width: `${(Math.max(...q.map((p) => p.x)) - Math.min(...q.map((p) => p.x))) * 100}%`,
        height: `${(Math.max(...q.map((p) => p.y)) - Math.min(...q.map((p) => p.y))) * 100}%`,
      }
    : null;
  return (
    <span
      style={{
        width: 44,
        height: 44,
        borderRadius: 8,
        background: "var(--surface-sunk, #f4efe2)",
        position: "relative",
        flex: "none",
        overflow: "hidden",
        display: "inline-block",
      }}
    >
      {t.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
      {box ? (
        <span
          style={{
            position: "absolute",
            ...box,
            border: "1.4px dashed rgba(255,255,255,0.75)",
            borderRadius: 3,
            mixBlendMode: "difference",
          }}
        />
      ) : null}
    </span>
  );
}

export function GenerateMockupsPanel({ data }: { data: MockupsData }) {
  const router = useRouter();
  // Selection lives HERE so the plan card recomputes live as templates are
  // ticked (the sketch's behaviour) — the saved shortlist stays the server
  // truth, and a dirty selection previews with an UNSAVED marker.
  const [picked, setPicked] = useState<Set<string>>(new Set(data.shortlist));
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const dirty = JSON.stringify([...picked].sort()) !== JSON.stringify(data.shortlist.slice().sort());

  async function saveAssignment() {
    setAssignBusy(true);
    setAssignError(null);
    const res = await apiJson(`/api/listings/${data.listingId}`, "PATCH", {
      templateShortlist: [...picked],
    });
    if (!res.ok) setAssignError(res.error);
    else router.refresh();
    setAssignBusy(false);
  }

  // the LIVE plan: sum of picked templates' yields. Matches the server's
  // tile derivation once saved (one variant per colour post-dedupe).
  const pickedTemplates = data.allTemplates.filter((t) => picked.has(t.id));
  const liveMockups = pickedTemplates.reduce((n, t) => n + t.yield, 0);

  // only built graphics count toward the plan — a missing one is a pill
  // below, not a phantom in the sum
  const builtGraphics = data.infoGraphics.filter((g) => g.url).length;

  // ---- the compositor run: start + poll, same shape as the Drive import ----
  const [job, setJob] = useState<GenerateJobView | null>(data.generateJob);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  useEffect(() => {
    if (job?.status !== "running") return;
    const timer = setInterval(async () => {
      const res = await apiCall<{ job?: GenerateJobView | null }>(`/api/listings/${data.listingId}/generate`);
      if (res.ok && res.data.job) {
        setJob(res.data.job);
        if (res.data.job.status !== "running") router.refresh();
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, data.listingId]);

  async function generate(regenerate: boolean) {
    setGenBusy(true);
    setGenError(null);
    const res = await apiJson<{ job?: GenerateJobView }>(`/api/listings/${data.listingId}/generate`, "POST", { regenerate });
    if (!res.ok) setGenError(res.error);
    else if (res.data.job) setJob(res.data.job);
    setGenBusy(false);
  }

  // Verdicts persist on the generated record; the local map is only an
  // optimistic overlay while a PATCH is in flight.
  const [verdictOverride, setVerdictOverride] = useState<Record<string, Verdict>>({});
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendReport, setSendReport] = useState<Array<{ name: string; detail: string; ok: boolean }> | null>(null);

  const key = (t: MockupTile) => `${t.templateId}:${t.colour}`;
  const verdictOf = (t: MockupTile): Verdict | null => {
    if (t.url === null || !t.generatedId) return null;
    return (
      verdictOverride[t.generatedId] ??
      (t.verdict === "Flagged" ? "flagged" : "approved")
    );
  };

  async function setVerdict(t: MockupTile, v: Verdict) {
    if (!t.generatedId) return;
    setVerdictOverride((cur) => ({ ...cur, [t.generatedId!]: v }));
    const res = await apiJson(`/api/generated-mockups/${t.generatedId}`, "PATCH", {
      verdict: v === "approved" ? "Approved" : "Flagged",
    });
    if (!res.ok) {
      setGenError(res.error);
      setVerdictOverride((cur) => {
        const next = { ...cur };
        delete next[t.generatedId!];
        return next;
      });
    }
  }

  async function sendApproved() {
    setSendBusy(true);
    setGenError(null);
    setSendReport(null);
    const res = await apiJson<{ results?: Array<{ name: string; detail: string; ok: boolean }> }>(
      `/api/listings/${data.listingId}/send-mockups`,
      "POST",
      {},
      120_000
    );
    if (!res.ok) setGenError(res.error);
    else {
      setSendReport(res.data.results ?? []);
      router.refresh();
    }
    setSendBusy(false);
  }

  const generated = data.tiles.filter((t) => t.url !== null);
  const approved = generated.filter((t) => verdictOf(t) === "approved");
  const attention = data.tiles.filter((t) => t.url === null || verdictOf(t) === "flagged");

  const blockers = [
    !data.ready.printifyProduct ? "no Printify product" : null,
    !data.ready.psdMaster ? "no PSD master" : null,
    data.allTemplates.length > 0 && data.shortlist.length === 0
      ? "no templates assigned to this listing (assign above)"
      : null,
    data.ready.variantCount === 0 ? "no colour variants for these colours" : null,
    data.ready.colours.length === 0 ? "no mockup colours" : null,
  ].filter(Boolean) as string[];

  const groups = useMemo(() => {
    const byTemplate = new Map<string, MockupTile[]>();
    for (const t of data.tiles) {
      const list = byTemplate.get(t.templateId) ?? [];
      list.push(t);
      byTemplate.set(t.templateId, list);
    }
    return [...byTemplate.values()];
  }, [data.tiles]);

  const shown = (t: MockupTile) => !onlyAttention || t.url === null || verdictOf(t) === "flagged";

  return (
    <div className="stack-12">
      {/* ready card FIRST (sketch order) — its template chip and plan line
          recompute LIVE from the picked set; dirty shows unsaved */}
      <div className="card supporting">
        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
          <Kicker>READY TO GENERATE</Kicker>
          <span className="row-gap-8" style={{ flexWrap: "wrap" }}>
            {READY_LABEL.map(([field, label]) => {
              const v = data.ready[field];
              const ok = typeof v === "number" ? v > 0 : Array.isArray(v) ? v.length > 0 : Boolean(v);
              return (
                <span
                  key={label}
                  className={`chip ${ok ? "done" : "stale"}`}
                  style={{ fontSize: 11 }}
                  title={field === "colours" && ok ? data.ready.colours.join(", ") : undefined}
                >
                  {ok ? "✓ " : ""}
                  {label}
                  {field === "colours" ? ` · ${data.ready.colours.length}` : ""}
                </span>
              );
            })}
            <span className={`chip ${picked.size > 0 ? "done" : "stale"}`} style={{ fontSize: 11 }}>
              {picked.size > 0 ? "✓ " : "⚠ "}Mockup templates · {picked.size}
              {dirty ? " · unsaved" : ""}
            </span>
          </span>
        </div>

        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
          <span className="body-sm">
            {picked.size === 0 ? (
              <>Pick at least one template below to generate.</>
            ) : blockers.length > 0 && !dirty ? (
              <>Can&apos;t generate yet — {blockers.join(", ")}.</>
            ) : (
              // live sum of the picked templates' yields — never a
              // multiplication (colour-locked templates count their one)
              <>
                <strong>{picked.size} {plural(picked.size, "template")}</strong> across your{" "}
                <strong>{data.ready.colours.length}</strong> {plural(data.ready.colours.length, "colour")} →{" "}
                <strong>{liveMockups} {plural(liveMockups, "mockup")}</strong> to generate
                {builtGraphics > 0 ? <> + {builtGraphics} info {builtGraphics === 1 ? "graphic" : "graphics"}</> : null}
                {dirty ? <span className="hint"> · unsaved — save below to apply</span> : null}
              </>
            )}
          </span>
          <span className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
            {generated.length > 0 && generated.length === data.tiles.length && job?.status !== "running" ? (
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 12 }}
                disabled={genBusy}
                title="Re-render every tile — replaces the existing images"
                onClick={() => {
                  if (window.confirm("Re-render all mockups? Existing renders are replaced.")) generate(true);
                }}
              >
                Regenerate all
              </button>
            ) : null}
            <button
              className="btn btn-primary"
              disabled={genBusy || job?.status === "running" || blockers.length > 0 || dirty}
              title={dirty ? "Save the template assignment first" : blockers.length > 0 ? blockers.join(", ") : undefined}
              onClick={() => generate(false)}
            >
              {genBusy || job?.status === "running" ? <span className="spinner" /> : "⟳ "}
              Generate mockups
            </button>
          </span>
        </div>
        {job ? (
          <div className="stack-12" style={{ gap: 4 }}>
            {job.status === "running" ? (
              <span className="body-sm">
                Rendering on the server — {job.done}/{job.total} done. Safe to navigate away; progress
                lands on this listing either way.
              </span>
            ) : job.status === "interrupted" ? (
              <div className="callout blocked">
                Run interrupted at {job.done}/{job.total} ({job.rendered} rendered) — Generate again
                picks up only what&apos;s missing.
                {job.results.filter((r) => !r.ok).slice(0, 1).map((r) => (
                  <span key={r.name} style={{ display: "block" }}>✕ {r.name} — {r.detail}</span>
                ))}
              </div>
            ) : (
              <span className="body-sm">
                ✓ Run complete — {job.rendered} of {job.total} rendered.
                {job.results.some((r) => !r.ok) ? " Failures listed below by tile." : ""}
              </span>
            )}
            {job.results.filter((r) => !r.ok).length > 0 && job.status !== "interrupted" ? (
              <div className="stack-12" style={{ gap: 2 }}>
                {job.results.filter((r) => !r.ok).map((r) => (
                  <span key={r.name + r.detail} className="hint" style={{ color: "var(--status-blocked, #b3423a)" }}>
                    ✕ {r.name} — {r.detail}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {genError ? <div className="callout blocked">{genError}</div> : null}
      </div>

      {/* the picker — rows with thumbnail, coverage and per-listing yield */}
      <div className="card supporting">
        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "baseline" }}>
          <Kicker>TEMPLATES FOR THIS LISTING</Kicker>
          <span className="body-sm" style={{ fontWeight: 700, color: "var(--status-done, #3e7a4e)" }}>
            {picked.size} of {data.allTemplates.length} selected
          </span>
        </div>
        <span className="hint">
          Pick the templates this listing uses. Only these feed the <strong>L5 slot pickers</strong>{" "}
          and set what gets generated.
          {data.productName ? <> Showing templates compatible with <strong>{data.productName}</strong>.</> : null}
        </span>

        {data.allTemplates.map((t) => {
          const on = picked.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() =>
                setPicked((cur) => {
                  const next = new Set(cur);
                  if (next.has(t.id)) next.delete(t.id);
                  else next.add(t.id);
                  return next;
                })
              }
              className="row-gap-12"
              style={{
                alignItems: "center",
                width: "100%",
                textAlign: "left",
                fontFamily: "inherit",
                cursor: "pointer",
                border: `1.5px solid ${on ? "var(--status-done, #bee0d5)" : "var(--border-soft, #e7e0ce)"}`,
                borderRadius: 11,
                padding: "10px 14px",
                background: on ? "var(--surface-panel-accent, #e4f0e9)" : "#fff",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: `2px solid ${on ? "var(--status-done, #2e9e88)" : "#cbbe9b"}`,
                  background: on ? "var(--status-done, #2e9e88)" : "#fff",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  flex: "none",
                }}
              >
                {on ? "✓" : ""}
              </span>
              <TemplateThumb t={t} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap", fontWeight: 600, fontSize: 14 }}>
                  {t.name}
                  {t.shotType ? <span className="chip neutral" style={{ fontSize: 10 }}>{t.shotType.toUpperCase()}</span> : null}
                  {!t.hasGeometry ? <span className="chip stale" style={{ fontSize: 10 }}>no geometry</span> : null}
                </span>
                <span className="hint" style={{ display: "block", marginTop: 2 }}>
                  {t.coverage.length === 0 ? (
                    "no variants in this listing's colours yet"
                  ) : t.colourLocked ? (
                    <span style={{ color: "var(--status-stale, #b8792a)", fontWeight: 700 }}>
                      {t.coverage[0]} only · colour-locked
                    </span>
                  ) : (
                    <>{t.coverage.length} {plural(t.coverage.length, "colour")} · {t.coverage.join(", ")}</>
                  )}
                </span>
              </span>
              <span style={{ textAlign: "right", flex: "none", fontSize: 12, fontWeight: 700, color: "var(--status-done, #2e9e88)" }}>
                {t.yield} {plural(t.yield, "mockup")}
                <span className="hint" style={{ display: "block", fontWeight: 500, fontSize: 10 }}>for this listing</span>
              </span>
            </button>
          );
        })}
        {data.allTemplates.length === 0 ? (
          <span className="hint">No templates for this product yet — create one in the Library.</span>
        ) : null}

        {assignError ? <div className="callout blocked">{assignError}</div> : null}
        <div className="row-gap-12" style={{ alignItems: "center", flexWrap: "wrap" }}>
          {dirty ? (
            <>
              <button className="btn btn-save" onClick={saveAssignment} disabled={assignBusy}>
                <Spinner active={assignBusy} />
                Save template assignment
              </button>
              <button className="btn btn-tertiary" disabled={assignBusy} onClick={() => setPicked(new Set(data.shortlist))}>
                Revert
              </button>
            </>
          ) : null}
          <a className="btn btn-tertiary" href="/library" style={{ marginLeft: dirty ? "auto" : 0 }}>
            ＋ Create a new template in the Library →
          </a>
        </div>
        {data.hidden.count > 0 ? (
          <span className="hint" style={{ borderTop: "1px dashed var(--border-soft, #e7e0ce)", paddingTop: 8 }}>
            Hidden: {data.hidden.count} {plural(data.hidden.count, "template")} for other products
            {data.hidden.example ? <> (e.g. {data.hidden.example})</> : null} — not compatible with
            this listing&apos;s {data.productName ?? "product"}.
          </span>
        ) : null}
      </div>

      {data.tiles.length > 0 ? (
        <div className="card supporting">
          <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
            <Kicker>
              PRODUCT MOCKUPS · {approved.length} OF {data.tiles.length} APPROVED
            </Kicker>
            <span className="row-gap-8">
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 12, padding: "4px 10px" }}
                disabled={generated.length === 0}
                onClick={() => {
                  for (const t of generated) {
                    if (verdictOf(t) === "flagged") void setVerdict(t, "approved");
                  }
                }}
              >
                Approve all
              </button>
              <button
                className={`btn ${onlyAttention ? "btn-secondary" : "btn-tertiary"}`}
                style={{ fontSize: 12, padding: "4px 10px" }}
                onClick={() => setOnlyAttention((v) => !v)}
              >
                {onlyAttention ? "Show all" : `Needs attention · ${attention.length}`}
              </button>
            </span>
          </div>

          {groups.map((tiles) => {
            const visible = tiles.filter(shown);
            if (visible.length === 0) return null;
            return (
              <div key={tiles[0].templateId} className="stack-12" style={{ gap: 6 }}>
                <span className="row-gap-8" style={{ alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{tiles[0].templateName}</span>
                  {tiles[0].shotType ? (
                    <span className="chip neutral" style={{ fontSize: 10 }}>{tiles[0].shotType}</span>
                  ) : null}
                </span>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                    gap: 12,
                  }}
                >
                  {visible.map((t) => {
                    const v = verdictOf(t);
                    return (
                      <div key={key(t)} className="card" style={{ padding: 0, overflow: "hidden", gap: 0 }}>
                        <div
                          style={{
                            aspectRatio: "1 / 1",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "var(--surface-sunk, #f4efe2)",
                          }}
                        >
                          {t.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={t.url} alt={`${t.templateName} — ${t.colour}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <span className="hint" style={{ fontSize: 11 }}>not generated</span>
                          )}
                        </div>
                        <div className="row-gap-8" style={{ padding: "7px 10px", alignItems: "center", justifyContent: "space-between" }}>
                          <span className="body-sm" style={{ fontWeight: 600 }}>{t.colour}</span>
                          <span className={`chip ${v === "approved" ? "done" : v === "flagged" ? "stale" : "neutral"}`} style={{ fontSize: 10 }}>
                            {v === "approved" ? "approved" : v === "flagged" ? "flagged" : "pending"}
                          </span>
                        </div>
                        <div style={{ display: "flex", borderTop: "1px solid var(--border-soft, #e7e2d6)" }}>
                          <button
                            className="btn btn-tertiary"
                            style={{ flex: 1, fontSize: 11, padding: "5px", borderRadius: 0 }}
                            disabled={t.url === null}
                            onClick={() => setVerdict(t, "approved")}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-tertiary"
                            style={{ flex: 1, fontSize: 11, padding: "5px", borderRadius: 0, borderLeft: "1px solid var(--border-soft, #e7e2d6)" }}
                            disabled={t.url === null}
                            onClick={() => setVerdict(t, "flagged")}
                          >
                            Flag
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="card supporting">
        <Kicker>BRANDED INFO GRAPHICS · FROM THE PRODUCT RECORD</Kicker>
        <span className="hint">
          Reused by every listing on this blueprint — L5 pulls them into their named slots, so they
          aren&apos;t part of the approve/send flow here.
        </span>
        <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
          {data.infoGraphics.map((g) =>
            g.url ? (
              <span key={g.label} className="chip done" style={{ fontSize: 11 }} title={g.url}>
                ✓ {g.label}
              </span>
            ) : (
              <span
                key={g.label}
                className="chip stale"
                style={{ fontSize: 11 }}
                title="L5 has a Graphic Card slot waiting for this — add the link on the Product record"
              >
                {g.label} — needed
              </span>
            )
          )}
        </div>
      </div>

      <div className="card supporting">
        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
          <span className="hint" style={{ flex: "1 1 260px" }}>
            Approved mockups drop into matching image slots at L5, by shot type and colour. Flagged
            and ungenerated ones stay here until they&apos;re ready.
          </span>
          <button
            className="btn btn-save"
            disabled={approved.length === 0 || sendBusy}
            title={approved.length === 0 ? "Nothing generated yet" : undefined}
            onClick={sendApproved}
          >
            <Spinner active={sendBusy} />
            Send {approved.length} approved → image slots
          </button>
        </div>
        {sendReport ? (
          <div className="stack-12" style={{ gap: 2 }}>
            {sendReport.map((r) => (
              <span key={r.name + r.detail} className="hint" style={{ color: r.ok ? undefined : "var(--status-blocked, #b3423a)" }}>
                {r.ok ? "✓" : "✕"} {r.name} — {r.detail}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
