"use client";

/**
 * L4 — generate mockups. The automated pipeline plus its review gate.
 *
 * The renderer itself is Phase 3 (hosted PSD compositing), so this ships
 * as a shell: the readiness check, the plan and the grid are computed from
 * real records today, and every tile is a REAL planned template × colour
 * combination rather than a placeholder. When the renderer lands, those
 * same tiles gain an image and Approve/Flag starts meaning something —
 * the layout doesn't change.
 *
 * Approve-by-default is deliberate: the operator flags the misses, rather
 * than clicking through a dozen good ones to bless each.
 */
import { useMemo, useState } from "react";
import { Kicker } from "./ui";

export interface MockupTile {
  templateId: string;
  templateName: string;
  shotType: string;
  colour: string;
  /** the composited image, once Phase 3 renders it. Null = not generated yet. */
  url: string | null;
}

export interface MockupsData {
  listingId: string;
  ready: {
    printifyProduct: boolean;
    psdMaster: boolean;
    /** variants offered for this listing's colours — the L5 filter, reused */
    templateCount: number;
    colours: string[];
  };
  tiles: MockupTile[];
  /** the Product's reusable graphics — built once per blueprint, not per listing */
  infoGraphics: Array<{ label: string; url: string }>;
}

type Verdict = "approved" | "flagged";

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

const READY_LABEL: Array<[keyof MockupsData["ready"], string]> = [
  ["printifyProduct", "Printify product"],
  ["psdMaster", "PSD master"],
  ["templateCount", "Mockup templates"],
  ["colours", "Mockup colours"],
];

export function GenerateMockupsPanel({ data }: { data: MockupsData }) {
  // Approve/Flag lives in the browser for now: with nothing rendered there
  // is no image for a verdict to attach to, and persisting a judgement
  // about an image that doesn't exist would be inventing state.
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [onlyAttention, setOnlyAttention] = useState(false);

  const key = (t: MockupTile) => `${t.templateId}:${t.colour}`;
  const verdictOf = (t: MockupTile): Verdict | null =>
    t.url === null ? null : verdicts[key(t)] ?? "approved";

  const generated = data.tiles.filter((t) => t.url !== null);
  const approved = generated.filter((t) => verdictOf(t) === "approved");
  const attention = data.tiles.filter((t) => t.url === null || verdictOf(t) === "flagged");

  /** true when every template is colour-neutral, so templates x colours really is the count */
  const evenMatrix = data.tiles.length === data.ready.templateCount * data.ready.colours.length;

  const blockers = [
    !data.ready.printifyProduct ? "no Printify product" : null,
    !data.ready.psdMaster ? "no PSD master" : null,
    data.ready.templateCount === 0 ? "no mockup templates for these colours" : null,
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
      <div className="card supporting">
        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
          <Kicker>READY TO GENERATE</Kicker>
          <span className="row-gap-8" style={{ flexWrap: "wrap" }}>
            {READY_LABEL.map(([field, label]) => {
              const v = data.ready[field];
              const ok = typeof v === "number" ? v > 0 : Array.isArray(v) ? v.length > 0 : Boolean(v);
              const detail =
                field === "templateCount"
                  ? ` · ${data.ready.templateCount}`
                  : field === "colours"
                    ? ` · ${data.ready.colours.length}`
                    : "";
              return (
                <span
                  key={label}
                  className={`chip ${ok ? "done" : "stale"}`}
                  style={{ fontSize: 11 }}
                  title={field === "colours" && ok ? data.ready.colours.join(", ") : undefined}
                >
                  {ok ? "✓ " : ""}
                  {label}
                  {detail}
                </span>
              );
            })}
          </span>
        </div>

        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
          <span className="body-sm">
            {blockers.length > 0 ? (
              <>Can&apos;t generate yet — {blockers.join(", ")}.</>
            ) : evenMatrix ? (
              <>
                <strong>{data.ready.templateCount}</strong> {plural(data.ready.templateCount, "template")} ×{" "}
                <strong>{data.ready.colours.length}</strong> {plural(data.ready.colours.length, "colour")} ={" "}
                <strong>
                  {data.tiles.length} {plural(data.tiles.length, "mockup")}
                </strong>
                {data.infoGraphics.length > 0 ? <> + {data.infoGraphics.length} info graphics</> : null}
              </>
            ) : (
              // a colour-locked template composites onto its own colour
              // only, so the tile count isn't templates × colours — showing
              // the multiplication anyway would print a false sum
              <>
                <strong>
                  {data.tiles.length} {plural(data.tiles.length, "mockup")}
                </strong>{" "}
                from {data.ready.templateCount} {plural(data.ready.templateCount, "template")} across{" "}
                {data.ready.colours.length} {plural(data.ready.colours.length, "colour")} — some
                templates are locked to one colour
                {data.infoGraphics.length > 0 ? <> · + {data.infoGraphics.length} info graphics</> : null}
              </>
            )}
          </span>
          {/* The compositor is Phase 3. A button that looked live and did
              nothing would be worse than one that says why it can't. */}
          <button className="btn btn-primary" disabled title="Hosted PSD compositing arrives in Phase 3">
            ⟳ Generate mockups
          </button>
        </div>
        <span className="hint">
          Compositing runs in Phase 3 — until then this plans the run and shows exactly which
          template × colour pairs it will produce.
        </span>
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
                onClick={() => setVerdicts({})}
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
                            onClick={() => setVerdicts((c) => ({ ...c, [key(t)]: "approved" }))}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-tertiary"
                            style={{ flex: 1, fontSize: 11, padding: "5px", borderRadius: 0, borderLeft: "1px solid var(--border-soft, #e7e2d6)" }}
                            disabled={t.url === null}
                            onClick={() => setVerdicts((c) => ({ ...c, [key(t)]: "flagged" }))}
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

      {data.infoGraphics.length > 0 ? (
        <div className="card supporting">
          <Kicker>BRANDED INFO GRAPHICS · FROM THE PRODUCT RECORD</Kicker>
          <span className="hint">
            Reused by every listing on this blueprint — L5 pulls them into their named slots, so they
            aren&apos;t part of the approve/send flow here.
          </span>
          <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
            {data.infoGraphics.map((g) => (
              <span key={g.label} className="chip done" style={{ fontSize: 11 }} title={g.url}>
                ✓ {g.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card supporting">
        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
          <span className="hint" style={{ flex: "1 1 260px" }}>
            Approved mockups drop into matching image slots at L5, by shot type and colour. Flagged
            and ungenerated ones stay here until they&apos;re ready.
          </span>
          <button className="btn btn-save" disabled={approved.length === 0} title={approved.length === 0 ? "Nothing generated yet" : undefined}>
            Send {approved.length} approved → image slots
          </button>
        </div>
      </div>
    </div>
  );
}
