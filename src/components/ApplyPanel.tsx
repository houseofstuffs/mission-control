"use client";

/**
 * Apply mode on the C1 step card (spec §9.2): pick a style, fill its slots
 * with this design's actual content, add the copy, compose. The result is
 * editable before saving — the pair writes to the design record so C2/C3
 * read from Notion, not from a chat log.
 *
 * Style choice is buttons grouped by category — all choices visible at once.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";
import { AutoTextarea } from "./AutoTextarea";

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

const CATEGORY_ORDER = ["Humor", "Minimalist", "Retro", "Illustrative", "Moody", ""];

function parseSlots(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-tertiary"
      style={{ fontSize: 11, padding: "2px 8px", marginLeft: "auto" }}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

export function ApplyPanel({
  designId,
  styles,
  saved,
}: {
  designId: string;
  styles: StyleOption[];
  saved: SavedPair;
}) {
  const router = useRouter();
  const hasSaved = Boolean(saved.imagePrompt || saved.textPrompt);
  const [open, setOpen] = useState(false);
  const [styleId, setStyleId] = useState<string | null>(saved.styleId);
  const [fills, setFills] = useState<Record<string, string>>({});
  const [copy, setCopy] = useState("");
  const [imagePrompt, setImagePrompt] = useState(saved.imagePrompt);
  const [textPrompt, setTextPrompt] = useState(saved.textPrompt);
  const [textureNote, setTextureNote] = useState(saved.textureNote);
  const [screening, setScreening] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"compose" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const style = styles.find((s) => s.id === styleId) ?? null;
  const slots = style ? parseSlots(style.slots) : [];

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: styles.filter((s) => (s.category || "") === cat),
  })).filter((g) => g.items.length > 0);

  async function compose() {
    if (!styleId) return;
    setBusy("compose");
    setError(null);
    const res = await fetch("/api/prompts/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designId, styleId, fills, copy }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Compose failed");
    else {
      setImagePrompt(json.pair.imagePrompt ?? "");
      setTextPrompt(json.pair.textPrompt ?? "");
      setTextureNote(json.pair.textureNote ?? "");
      setScreening(json.pair.screeningPhrases ?? "");
      setNotes(json.pair.notes ?? "");
    }
    setBusy(null);
  }

  async function savePair() {
    setBusy("save");
    setError(null);
    const res = await fetch("/api/prompts/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designId, styleId, save: true, imagePrompt, textPrompt, textureNote }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Save failed");
    else {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
      router.refresh();
    }
    setBusy(null);
  }

  if (!open) {
    return (
      <button className="btn btn-secondary" onClick={() => setOpen(true)}>
        {hasSaved ? "Prompt pair saved — view / recompose" : "Compose prompt pair from a style"}
      </button>
    );
  }

  return (
    <div className="card supporting">
      <div className="row-gap-12" style={{ justifyContent: "space-between" }}>
        <Kicker>APPLY A STYLE — COMPOSE THE C1 PROMPT PAIR</Kicker>
        <button className="btn btn-tertiary" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {styles.length === 0 ? (
        <div className="hint">No styles captured yet — capture one below, or on the Styles page.</div>
      ) : (
        <>
          {/* style chooser — every choice visible, bundled by category */}
          <div className="stack-12">
            {byCategory.map((g) => (
              <div key={g.cat || "uncategorised"} className="field">
                <span className="kicker">{g.cat || "UNCATEGORISED"}</span>
                <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
                  {g.items.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`btn ${s.id === styleId ? "btn-secondary" : "btn-tertiary"}`}
                      style={{ fontSize: 12, padding: "6px 12px" }}
                      onClick={() => {
                        setStyleId(s.id);
                        setFills({});
                      }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {style ? (
            <>
              {slots.length > 0 ? (
                <div className="stack-12">
                  {slots
                    .filter((slot) => !/copy/i.test(slot))
                    .map((slot) => (
                      <div key={slot} className="field">
                        <label className="kicker" htmlFor={`fill-${slot}`}>{slot.toUpperCase()}</label>
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
                  This style has no slots listed — the subject goes in the copy field below, and the
                  composer treats it as a single-subject design.
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
                <button className="btn btn-primary" onClick={compose} disabled={busy !== null}>
                  {busy === "compose" ? <span className="spinner" /> : null}
                  {busy === "compose" ? "Composing" : imagePrompt ? "Recompose" : "Compose pair"}
                </button>
              </div>
            </>
          ) : null}
        </>
      )}

      {error ? <div className="callout blocked">{error}</div> : null}
      {savedFlash ? (
        <div className="callout stale" style={{ background: "#eef8f4", borderColor: "#68c2a9", color: "#134a3a" }}>
          Pair saved to the design — C2 and C3 read from here.
        </div>
      ) : null}

      {imagePrompt || textPrompt ? (
        <>
          {notes ? <div className="callout stale">{notes}</div> : null}
          <div className="field">
            <div className="row-gap-8" style={{ alignItems: "center" }}>
              <label className="kicker" htmlFor="apply-img">IMAGE PROMPT — FOR C2</label>
              <CopyButton text={imagePrompt} />
            </div>
            <AutoTextarea id="apply-img" value={imagePrompt} onChange={setImagePrompt} />
          </div>
          <div className="field">
            <div className="row-gap-8" style={{ alignItems: "center" }}>
              <label className="kicker" htmlFor="apply-txt">TEXT PROMPT — FOR C3 (KITTL LAYER)</label>
              <CopyButton text={textPrompt} />
            </div>
            <AutoTextarea id="apply-txt" value={textPrompt} onChange={setTextPrompt} />
          </div>
          <div className="field">
            <div className="row-gap-8" style={{ alignItems: "center" }}>
              <label className="kicker" htmlFor="apply-tex">TEXTURE NOTE — FOR C5 (SEPARATE LAYER, NEVER BAKED IN)</label>
              <CopyButton text={textureNote} />
            </div>
            <AutoTextarea
              id="apply-tex"
              placeholder="no texture — clean style"
              value={textureNote}
              onChange={setTextureNote}
            />
          </div>
          {screening ? (
            <div className="well">
              <Kicker>SCREEN THESE EXACT PHRASES</Kicker>
              <div className="body-sm" style={{ marginTop: 6 }}>{screening}</div>
            </div>
          ) : null}
          <div className="row-gap-12">
            <button className="btn btn-secondary" onClick={savePair} disabled={busy !== null}>
              {busy === "save" ? <span className="spinner" /> : null}
              Save pair to design
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
