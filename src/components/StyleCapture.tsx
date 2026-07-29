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
import { AutoTextarea } from "./AutoTextarea";
import { CopyIconButton } from "./CopyIconButton";

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

// Same working order as the Styles detail view: prompts near the top,
// layout mechanics (composition, slots) at the bottom.
const FIELDS: Array<{ key: keyof Draft; label: string; copyable?: boolean }> = [
  { key: "description", label: "DESCRIPTION — LOOK ONLY, NO SUBJECT MATTER", copyable: true },
  { key: "reusablePrompt", label: "REUSABLE PROMPT", copyable: true },
  { key: "typePrompt", label: "TYPE PROMPT — LETTERING", copyable: true },
  { key: "typography", label: "TYPOGRAPHY", copyable: true },
  { key: "keywordBank", label: "KEYWORD BANK", copyable: true },
  { key: "printsBeautifullyOn", label: "PRINTS BEAUTIFULLY ON" },
  { key: "worksWithTweaksOn", label: "WORKS WITH TWEAKS ON" },
  { key: "avoidOn", label: "AVOID ON" },
  { key: "ruleOfThumb", label: "RULE OF THUMB" },
  { key: "composition", label: "COMPOSITION — LAYOUT IN SLOT TERMS", copyable: true },
  { key: "slots", label: "SLOTS — APPLY MODE'S FILL-IN FIELDS" },
];

const JOB_KEY = "stuffs-capture-job";

export function StyleCapture({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [serverPreview, setServerPreview] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [open, setOpen] = useState(!compact);
  const inputRef = useRef<HTMLInputElement>(null);

  const generating = jobId !== null && !draft;

  function clearJob() {
    setJobId(null);
    setServerPreview(null);
    try {
      localStorage.removeItem(JOB_KEY);
    } catch {}
  }

  // Resume a capture started before navigating away — the job kept running
  // server-side; pick its result back up.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(JOB_KEY);
    } catch {}
    if (stored) {
      setJobId(stored);
      setOpen(true);
    }
  }, []);

  // Poll the job until the draft arrives.
  useEffect(() => {
    if (!jobId || draft) return;
    let cancelled = false;
    async function check() {
      const res = await fetch(`/api/styles/capture?job=${jobId}`);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.status === 404 ? "That capture expired — drop the reference again." : "Couldn't check the capture job.");
        clearJob();
        return;
      }
      const json = await res.json();
      if (json.status === "done") {
        setDraft(json.style as Draft);
        if (json.imageDataUrl) setServerPreview(json.imageDataUrl as string);
      } else if (json.status === "error") {
        setError(json.error ?? "Capture failed");
        clearJob();
      }
    }
    check();
    const t = setInterval(check, 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, draft]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Ctrl+V anywhere on the page drops the clipboard image in — no need to
  // click the tile first. Only while the panel is open and awaiting an image.
  useEffect(() => {
    if (!open || draft) return;
    function onPaste(e: ClipboardEvent) {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (f) {
        e.preventDefault();
        take(f);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  function take(f: File | undefined | null) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Reference must be an image.");
      return;
    }
    setError(null);
    setSaved(null);
    setDraft(null);
    // A fresh reference always resets the panel — without this, a job
    // orphaned by a deploy kept "generating" forever and bricked the button.
    clearJob();
    setFile(f);
  }

  async function generate() {
    if (!file) return;
    setError(null);
    const form = new FormData();
    form.append("image", file, file.name);
    if (hint.trim()) form.append("hint", hint.trim());
    const res = await fetch("/api/styles/capture", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Capture failed");
    else {
      setJobId(json.jobId as string);
      try {
        localStorage.setItem(JOB_KEY, json.jobId as string);
      } catch {}
    }
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    setError(null);
    const form = new FormData();
    for (const [k, v] of Object.entries(draft)) form.append(k, String(v ?? ""));
    if (file) form.append("image", file, file.name);
    if (jobId) form.append("jobId", jobId);
    const res = await fetch("/api/styles", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Save failed");
    else {
      setSaved(draft.name);
      setDraft(null);
      setFile(null);
      setHint("");
      clearJob();
      router.refresh();
    }
    setBusy(null);
  }

  function discard() {
    setDraft(null);
    // No local file means the image only exists in the finished job —
    // clear it so the tile is genuinely empty rather than half-resumed.
    if (!file) clearJob();
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
          {/* split layout, same as the ideas quick capture: form left, drop
              zone right, equal halves (stacks on narrow screens) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, alignItems: "stretch" }}>
            <div className="stack-12">
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
                <button className="btn btn-primary" onClick={generate} disabled={!file || generating}>
                  {generating ? <span className="spinner" /> : null}
                  {generating ? "Reading the reference" : "Capture"}
                </button>
                {file && !generating ? (
                  <button className="btn btn-tertiary" onClick={() => setFile(null)}>
                    Remove
                  </button>
                ) : null}
                {generating ? (
                  <button className="btn btn-tertiary" onClick={clearJob}>
                    Cancel
                  </button>
                ) : null}
              </div>
              {generating ? (
                <span className="hint">Runs on the server — safe to leave this page and come back.</span>
              ) : null}
            </div>

            <button
              className="drop-tile"
              style={{
                minHeight: 180,
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
              {previewUrl || serverPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={(previewUrl || serverPreview)!}
                  alt=""
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <>
                  <span style={{ fontSize: 26, lineHeight: 1, color: "var(--text-on-mint-title)" }}>+</span>
                  <span className="kicker" style={{ color: "var(--text-on-mint-title)" }}>
                    DROP, PASTE (CTRL+V) OR CLICK
                  </span>
                </>
              )}
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => take(e.target.files?.[0])}
          />
        </>
      ) : (
        <>
          <div className="body-sm muted">
            Review and edit anything it got wrong, then save. If any field names what the
            reference actually depicted, generalise it into a slot — a style should work for
            a completely different subject.
          </div>
          {/* save up top too — skim the whole draft, save, then tweak the top
              fields without scrolling back down */}
          <div className="row-gap-12">
            <button className="btn btn-primary" onClick={save} disabled={busy !== null || !draft.name.trim()}>
              {busy === "save" ? <span className="spinner" /> : null}
              Save to Styles
            </button>
            <button className="btn btn-tertiary" onClick={discard} disabled={busy !== null}>
              Discard
            </button>
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
              <div className="row-gap-8" style={{ alignItems: "center" }}>
                <label className="kicker" htmlFor={`cap-${f.key}`}>{f.label}</label>
                {f.copyable ? <CopyIconButton text={draft[f.key]} label={f.label} /> : null}
              </div>
              <AutoTextarea
                id={`cap-${f.key}`}
                value={draft[f.key]}
                onChange={(v) => setDraft({ ...draft, [f.key]: v })}
              />
            </div>
          ))}
          <div className="row-gap-12">
            <button className="btn btn-primary" onClick={save} disabled={busy !== null || !draft.name.trim()}>
              {busy === "save" ? <span className="spinner" /> : null}
              Save to Styles
            </button>
            <button className="btn btn-tertiary" onClick={discard} disabled={busy !== null}>
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
