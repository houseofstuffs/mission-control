"use client";

/**
 * Apply mode on the C1 step card (spec §9.2): pick 1-5 styles, fill the slots
 * with this design's actual content, add the copy, compose — one candidate
 * per style, plus up to two model-suggested directions from outside the
 * library. Candidates persist on the design immediately; the WINNER is
 * chosen at C2, after real generations, via the candidates board.
 *
 * Style choice is toggle pills grouped by category — all choices visible.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";
import { AutoTextarea } from "./AutoTextarea";
import { CopyIconButton } from "./CopyIconButton";

export interface StyleOption {
  id: string;
  name: string;
  category: string;
  slots: string;
}

export interface SavedPair {
  styleId: string | null;
  imagePrompt: string;
  textPrompt: string;
  textureNote: string;
}

export interface CandidateData {
  styleId: string | null;
  styleName: string;
  suggested: boolean;
  imagePrompt: string;
  textPrompt: string;
  textureNote: string;
  screeningPhrases: string;
  notes: string;
}

const CATEGORY_ORDER = ["Humor", "Minimalist", "Retro", "Illustrative", "Moody", ""];
const MAX_STYLES = 5;

function parseSlots(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ApplyPanel({
  designId,
  styles,
  saved,
  hasCandidates,
}: {
  designId: string;
  styles: StyleOption[];
  saved: SavedPair;
  hasCandidates: boolean;
}) {
  const router = useRouter();
  const hasSaved = Boolean(saved.imagePrompt || saved.textPrompt);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(saved.styleId ? [saved.styleId] : []);
  const [fills, setFills] = useState<Record<string, string>>({});
  const [copy, setCopy] = useState("");
  const [suggest, setSuggest] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = jobId !== null;
  const jobKey = `stuffs-compose-job:${designId}`;

  function clearJob() {
    setJobId(null);
    try {
      localStorage.removeItem(jobKey);
    } catch {}
  }

  // Resume a compose started before navigating away — it kept running
  // server-side and its result lands on the design record.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(jobKey);
    } catch {}
    if (stored) {
      setJobId(stored);
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    async function check() {
      const res = await fetch(`/api/prompts/compose?job=${jobId}`);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.status === 404 ? "That compose expired — hit Compose again." : "Couldn't check the compose job.");
        clearJob();
        return;
      }
      const json = await res.json();
      if (json.status === "done") {
        clearJob();
        router.refresh(); // candidates are on the design now; the board picks them up
      } else if (json.status === "error") {
        setError(json.error ?? "Compose failed");
        clearJob();
      }
    }
    check();
    const t = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // union of slots across every selected style, in canonical fill order:
  // HERO first, then MOTIF 1..n, anything else, COPY last
  const slots: string[] = [];
  for (const id of selected) {
    const s = styles.find((x) => x.id === id);
    for (const slot of parseSlots(s?.slots ?? "")) {
      if (!slots.includes(slot)) slots.push(slot);
    }
  }
  const slotRank = (slot: string): number => {
    if (/hero/i.test(slot)) return 0;
    const motif = slot.match(/motif\s*(\d+)/i);
    if (motif) return 10 + Number(motif[1]);
    if (/copy/i.test(slot)) return 100;
    return 50;
  };
  slots.sort((a, b) => slotRank(a) - slotRank(b));

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: styles.filter((s) => (s.category || "") === cat),
  })).filter((g) => g.items.length > 0);

  function toggle(id: string) {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_STYLES ? cur : [...cur, id]
    );
  }

  async function compose() {
    if (selected.length === 0) return;
    setError(null);
    const res = await fetch("/api/prompts/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designId, styleIds: selected, fills, copy, suggest }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Compose failed");
    else {
      setJobId(json.jobId as string);
      try {
        localStorage.setItem(jobKey, json.jobId as string);
      } catch {}
    }
  }

  if (!open) {
    return (
      <button className="btn btn-secondary" style={{ flex: "1 1 240px" }} onClick={() => setOpen(true)}>
        {hasCandidates || hasSaved ? "Candidates composed — recompose" : "Compose prompt candidates from styles"}
      </button>
    );
  }

  const total = selected.length + suggest;

  return (
    <div className="card supporting" style={{ flex: "1 1 100%" }}>
      <div className="row-gap-12" style={{ justifyContent: "space-between" }}>
        <Kicker>APPLY STYLES — COMPOSE C1 CANDIDATES</Kicker>
        <button className="btn btn-tertiary" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {styles.length === 0 ? (
        <div className="hint">No styles captured yet — capture one here, or on the Styles page.</div>
      ) : (
        <>
          <div className="body-sm muted">
            Pick 1-{MAX_STYLES} styles — you&apos;ll generate every candidate at C2 and crown the winner
            there, so choose for range, not certainty.
          </div>
          {/* style toggles — every choice visible, bundled by category */}
          <div className="stack-12">
            {byCategory.map((g) => (
              <div key={g.cat || "uncategorised"} className="field">
                <span className="kicker">{g.cat || "UNCATEGORISED"}</span>
                <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
                  {g.items.map((s) => {
                    const on = selected.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`btn ${on ? "btn-secondary" : "btn-tertiary"}`}
                        style={{ fontSize: 12, padding: "6px 12px" }}
                        onClick={() => toggle(s.id)}
                      >
                        {on ? "✓ " : ""}{s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="field">
            <label className="kicker" htmlFor="apply-suggest">NEW DIRECTIONS OUTSIDE THE LIBRARY</label>
            <select
              id="apply-suggest"
              className="select"
              style={{ width: 220 }}
              value={suggest}
              onChange={(e) => setSuggest(Number(e.target.value))}
            >
              <option value={0}>None — library styles only</option>
              <option value={1}>Suggest 1 extra direction</option>
              <option value={2}>Suggest 2 extra directions</option>
            </select>
          </div>

          {selected.length > 0 ? (
            <>
              {slots.length > 0 ? (
                <div className="stack-12">
                  {slots
                    .filter((slot) => !/copy/i.test(slot))
                    .map((slot) => (
                      <div key={slot} className="field">
                        <label className="kicker" htmlFor={`fill-${slot}`}>{slot.toUpperCase()} — SAME FILL FOR EVERY CANDIDATE</label>
                        <input
                          id={`fill-${slot}`}
                          className="input"
                          placeholder={
                            /hero/i.test(slot)
                              ? "the focal element — e.g. a margarita glass"
                              : "supporting imagery — e.g. limes and salt"
                          }
                          value={fills[slot] ?? ""}
                          onChange={(e) => setFills({ ...fills, [slot]: e.target.value })}
                        />
                      </div>
                    ))}
                </div>
              ) : (
                <div className="hint">
                  No slots on the selected styles — the subject goes in the copy field below.
                </div>
              )}
              <div className="field">
                <label className="kicker" htmlFor="apply-copy">COPY — EXACT TEXT ON THE DESIGN</label>
                <textarea
                  id="apply-copy"
                  className="textarea"
                  rows={2}
                  placeholder="leave empty if this design has no lettering"
                  value={copy}
                  onChange={(e) => setCopy(e.target.value)}
                />
              </div>
              <div className="row-gap-12">
                <button className="btn btn-primary" onClick={compose} disabled={busy}>
                  {busy ? <span className="spinner" /> : null}
                  {busy
                    ? "Composing"
                    : `Compose ${total} candidate${total === 1 ? "" : "s"}`}
                </button>
                {busy ? (
                  <span className="hint">Runs on the server — safe to leave this page and come back.</span>
                ) : hasCandidates ? (
                  <span className="hint">Recomposing replaces the current candidate set.</span>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      )}

      {error ? <div className="callout blocked">{error}</div> : null}
    </div>
  );
}

/**
 * The candidates board — shown on C1 and C2 whenever candidates exist.
 * Copy each image prompt into Kittl at C2; whichever generation wins,
 * "This one won" commits that candidate's pair to the design.
 */
/** The winner at C2 — full width, every field editable, saves via commit. */
function WinnerEditor({
  designId,
  winner,
  saved,
}: {
  designId: string;
  winner: CandidateData;
  saved: SavedPair;
}) {
  const router = useRouter();
  const [imagePrompt, setImagePrompt] = useState(saved.imagePrompt);
  const [textPrompt, setTextPrompt] = useState(saved.textPrompt);
  const [textureNote, setTextureNote] = useState(saved.textureNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    imagePrompt !== saved.imagePrompt || textPrompt !== saved.textPrompt || textureNote !== saved.textureNote;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/prompts/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        designId,
        commit: { styleId: winner.styleId, styleName: winner.styleName, imagePrompt, textPrompt, textureNote },
      }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Save failed");
    else router.refresh();
    setBusy(false);
  }

  return (
    <div className="card supporting stack-12">
      <div className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <Kicker>WINNER — {winner.styleName}</Kicker>
        {winner.suggested ? <span className="chip stale">new direction</span> : null}
        <span className="chip done">✓ winner</span>
      </div>
      {error ? <div className="callout blocked">{error}</div> : null}
      <div className="field">
        <div className="row-gap-8" style={{ alignItems: "center" }}>
          <label className="kicker" htmlFor="win-img">IMAGE PROMPT — FOR C2 (EDIT FREELY)</label>
          <CopyIconButton text={imagePrompt} label="image prompt" />
        </div>
        <AutoTextarea id="win-img" value={imagePrompt} onChange={setImagePrompt} />
      </div>
      <div className="field">
        <div className="row-gap-8" style={{ alignItems: "center" }}>
          <label className="kicker" htmlFor="win-txt">TEXT PROMPT — KITTL LAYER</label>
          <CopyIconButton text={textPrompt} label="text prompt" />
        </div>
        <AutoTextarea id="win-txt" value={textPrompt} onChange={setTextPrompt} />
      </div>
      <div className="field">
        <div className="row-gap-8" style={{ alignItems: "center" }}>
          <label className="kicker" htmlFor="win-tex">TEXTURE NOTE — FOR C5</label>
          <CopyIconButton text={textureNote} label="texture note" />
        </div>
        <AutoTextarea id="win-tex" placeholder="no texture — clean style" value={textureNote} onChange={setTextureNote} />
      </div>
      {winner.screeningPhrases ? <div className="hint">Screen: {winner.screeningPhrases}</div> : null}
      <div className="row-gap-12">
        <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
          {busy ? <span className="spinner" /> : null}
          Save revised prompts
        </button>
        {dirty ? <span className="hint">Unsaved changes — the revised version becomes the record</span> : null}
      </div>
    </div>
  );
}

export function CandidatesBoard({
  designId,
  candidates,
  chosenImagePrompt,
  focusWinner = false,
  saved,
}: {
  designId: string;
  candidates: CandidateData[];
  chosenImagePrompt: string;
  /** once a winner is committed, show only it (C2 view) */
  focusWinner?: boolean;
  /** the committed pair — the editable source of truth in winner view */
  saved?: SavedPair;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spunOff, setSpunOff] = useState<Record<number, { id: string; title: string }>>({});

  async function commit(c: CandidateData, i: number) {
    setBusy(i);
    setError(null);
    const res = await fetch("/api/prompts/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designId, commit: c }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Commit failed");
    else router.refresh();
    setBusy(null);
  }

  // a second winner is a second design — same niche/product, its own run
  async function spinOff(c: CandidateData, i: number) {
    setBusy(i);
    setError(null);
    const res = await fetch("/api/prompts/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designId, spinOff: c }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Spin-off failed");
    else {
      setSpunOff((cur) => ({ ...cur, [i]: { id: json.record.id as string, title: json.record.title as string } }));
      router.refresh();
    }
    setBusy(null);
  }

  const winnerChosen = Boolean(chosenImagePrompt) && candidates.some((c) => c.imagePrompt === chosenImagePrompt);
  const shown = focusWinner && winnerChosen ? candidates.filter((c) => c.imagePrompt === chosenImagePrompt) : candidates;

  // Winner view: the committed pair on the design is the working copy —
  // fully editable, so a hand-revised prompt drops straight in.
  if (focusWinner && winnerChosen && saved) {
    return (
      <WinnerEditor
        designId={designId}
        winner={shown[0]}
        saved={saved}
      />
    );
  }

  return (
    <div className="stack-12">
      <Kicker>
        {shown.length === 1 && winnerChosen
          ? `WINNER — ${shown[0].styleName}`
          : `CANDIDATES · ${candidates.length} — GENERATE EACH AT C2, THEN CROWN THE WINNER`}
      </Kicker>
      {error ? <div className="callout blocked">{error}</div> : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: shown.length === 1 ? "1fr" : "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        {shown.map((c, i) => {
          const chosen = Boolean(chosenImagePrompt) && c.imagePrompt === chosenImagePrompt;
          return (
            <div key={`${c.styleName}-${i}`} className="card supporting stack-12">
              <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
                <span className="title" style={{ fontSize: 14 }}>{c.styleName}</span>
                {c.suggested ? <span className="chip stale">new direction</span> : null}
                {chosen ? <span className="chip done">✓ winner</span> : null}
              </div>
              {c.notes ? <div className="hint">{c.notes}</div> : null}
              <div className="field">
                <div className="row-gap-8" style={{ alignItems: "center" }}>
                  <span className="kicker">IMAGE PROMPT — FOR C2</span>
                  <CopyIconButton text={c.imagePrompt} label={`${c.styleName} image prompt`} />
                </div>
                <div className="body-sm" style={{ whiteSpace: "pre-wrap" }}>{c.imagePrompt}</div>
              </div>
              <div className="field">
                <div className="row-gap-8" style={{ alignItems: "center" }}>
                  <span className="kicker">TEXT PROMPT — KITTL LAYER</span>
                  <CopyIconButton text={c.textPrompt} label={`${c.styleName} text prompt`} />
                </div>
                <div className="body-sm" style={{ whiteSpace: "pre-wrap" }}>{c.textPrompt}</div>
              </div>
              {c.textureNote ? (
                <div className="field">
                  <div className="row-gap-8" style={{ alignItems: "center" }}>
                    <span className="kicker">TEXTURE NOTE — FOR C5</span>
                    <CopyIconButton text={c.textureNote} label={`${c.styleName} texture note`} />
                  </div>
                  <div className="body-sm" style={{ whiteSpace: "pre-wrap" }}>{c.textureNote}</div>
                </div>
              ) : null}
              {c.screeningPhrases ? (
                <div className="hint">Screen: {c.screeningPhrases}</div>
              ) : null}
              <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
                {/* ONE button per card: crown first; once a winner exists,
                    the others' button converts to Spin off (a second winner
                    is a second design). */}
                {spunOff[i] ? (
                  <a className="chip done" href={`/designs/${spunOff[i].id}`}>
                    → {spunOff[i].title}
                  </a>
                ) : chosen ? null : winnerChosen ? (
                  <button
                    className="btn btn-secondary"
                    disabled={busy !== null}
                    onClick={() => spinOff(c, i)}
                    title="Gets its own design record, starting at C2"
                  >
                    {busy === i ? <span className="spinner" /> : null}
                    Spin off
                  </button>
                ) : (
                  <button className="btn btn-secondary" disabled={busy !== null} onClick={() => commit(c, i)}>
                    {busy === i ? <span className="spinner" /> : null}
                    Winning Prompt
                  </button>
                )}
                {c.suggested && chosen ? (
                  <span className="hint">Won as a new direction — capture it as a Style so it joins the library.</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
