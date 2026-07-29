"use client";

/**
 * Capture mode UI — drop a reference image, generate a draft Style record,
 * edit anything the model got wrong, then save to Notion.
 *
 * Nothing is written until you press Save: a bad generation costs nothing.
 * Used both in Library and at the bottom of the C1 step card in the runner.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";

interface Draft {
  name: string;
  category: string;
  description: string;
  composition: string;
  slots: string;
  typography: string;
  keywordBank: string;
  reusablePrompt: string;
  typePrompt: string;
  printsBeautifullyOn: string;
  worksWithTweaksOn: string;
  avoidOn: string;
  ruleOfThumb: string;
}

const FIELDS: Array<{ key: keyof Draft; label: string; rows?: number }> = [
  { key: "description", label: "DESCRIPTION — LOOK ONLY, NO SUBJECT MATTER", rows: 3 },
  { key: "composition", label: "COMPOSITION — LAYOUT IN SLOT TERMS", rows: 3 },
  { key: "slots", label: "SLOTS", rows: 1 },
  { key: "typography", label: "TYPOGRAPHY", rows: 2 },
  { key: "keywordBank", label: "KEYWORD BANK", rows: 3 },
  { key: "reusablePrompt", label: "REUSABLE PROMPT", rows: 6 },
  { key: "typePrompt", label: "TYPE PROMPT — LETTERING", rows: 3 },
  { key: "printsBeautifullyOn", label: "PRINTS BEAUTIFULLY ON", rows: 2 },
  { key: "worksWithTweaksOn", label: "WORKS WITH TWEAKS ON", rows: 2 },
  { key: "avoidOn", label: "AVOID ON", rows: 2 },
  { key: "ruleOfThumb", label: "RULE OF THUMB", rows: 2 },
];

export function StyleCapture({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [open, setOpen] = useState(!compact);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function take(f: File | undefined | null) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Reference must be an image.");
      return;
    }
    setError(null);
    setSaved(null);
    setDraft(null);
    setFile(f);
  }

  async function generate() {
    if (!file) return;
    setBusy("generate");
    setError(null);
    const form = new FormData();
    form.append("image", file, file.name);
    if (hint.trim()) form.append("hint", hint.trim());
    const res = await fetch("/api/styles/capture", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Capture failed");
    else setDraft(json.style as Draft);
    setBusy(null);
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    setError(null);
    const form = new FormData();
    for (const [k, v] of Object.entries(draft)) form.append(k, String(v ?? ""));
    if (file) form.append("image", file, file.name);
    const res = await fetch("/api/styles", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Save failed");
    else {
      setSaved(draft.name);
      setDraft(null);
      setFile(null);
      setHint("");
      router.refresh();
    }
    setBusy(null);
  }

  if (compact && !open) {
    return (
      <button className="btn btn-tertiary" onClick={() => setOpen(true)}>
        Capture a style from a reference
      </button>
    );
  }

  return (
    <div className="card supporting">
      <div className="row-gap-12" style={{ justifyContent: "space-between" }}>
        <Kicker>CAPTURE A STYLE</Kicker>
        {compact ? (
          <button className="btn btn-tertiary" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => setOpen(false)}>
            Close
          </button>
        ) : null}
      </div>

      {saved ? (
        <div className="callout stale" style={{ background: "#eef8f4", borderColor: "#68c2a9", color: "#134a3a" }}>
          Saved &ldquo;{saved}&rdquo; to your Styles. Refresh to see it in Library.
        </div>
      ) : null}
      {error ? <div className="callout blocked">{error}</div> : null}

      {!draft ? (
        <>
          <button
            className="drop-tile"
            style={{
              minHeight: 120,
              ...(dragOver ? { outline: "2px dashed var(--blueberry)", outlineOffset: 4 } : {}),
            }}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              take(e.dataTransfer.files?.[0]);
            }}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" style={{ maxHeight: 160, maxWidth: "100%", objectFit: "contain" }} />
            ) : (
              <>
                <span style={{ fontSize: 26, lineHeight: 1, color: "var(--text-on-mint-title)" }}>+</span>
                <span className="kicker" style={{ color: "var(--text-on-mint-title)" }}>
                  DROP A REFERENCE
                </span>
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => take(e.target.files?.[0])}
          />
          <div className="field">
            <label className="kicker" htmlFor="cap-hint">ANYTHING IT SHOULD KNOW (OPTIONAL)</label>
            <input
              id="cap-hint"
              className="input"
              placeholder="e.g. this is my own artwork, prints on dark garments"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
            />
          </div>
          <div className="row-gap-12">
            <button className="btn btn-primary" onClick={generate} disabled={!file || busy !== null}>
              {busy === "generate" ? <span className="spinner" /> : null}
              {busy === "generate" ? "Reading the reference" : "Capture style"}
            </button>
            {file ? (
              <button className="btn btn-tertiary" onClick={() => setFile(null)} disabled={busy !== null}>
                Remove
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="body-sm muted">
            Review and edit anything it got wrong, then save. If any field names what the
            reference actually depicted, generalise it into a slot — a style should work for
            a completely different subject.
          </div>
          <div className="row-gap-12" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 240px" }}>
              <label className="kicker" htmlFor="cap-name">NAME</label>
              <input
                id="cap-name"
                className="input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="kicker" htmlFor="cap-cat">CATEGORY</label>
              <select
                id="cap-cat"
                className="select"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              >
                {["Humor", "Minimalist", "Retro", "Illustrative", "Moody"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          {FIELDS.map((f) => (
            <div key={f.key} className="field">
              <label className="kicker" htmlFor={`cap-${f.key}`}>{f.label}</label>
              <textarea
                id={`cap-${f.key}`}
                className="textarea"
                rows={f.rows ?? 3}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              />
            </div>
          ))}
          <div className="row-gap-12">
            <button className="btn btn-primary" onClick={save} disabled={busy !== null || !draft.name.trim()}>
              {busy === "save" ? <span className="spinner" /> : null}
              Save to Styles
            </button>
            <button className="btn btn-tertiary" onClick={() => setDraft(null)} disabled={busy !== null}>
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
