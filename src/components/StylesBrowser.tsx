"use client";

/**
 * Styles page body — grid of style cards; selecting one opens a split view:
 * reference image on the left, every field editable on the right, copy icon
 * per field. Prompts never appear at grid level (they're working material,
 * not browsing material). Delete archives to Notion's trash (30-day recovery)
 * and warns when designs still reference the style.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";

export interface StyleCard {
  id: string;
  name: string;
  category: string;
  imageUrl: string | null;
  usedIn: number;
  fields: Record<string, string>; // form key → value
}

const FIELDS: Array<{ key: string; label: string; rows: number; copyable?: boolean }> = [
  { key: "description", label: "DESCRIPTION", rows: 3, copyable: true },
  { key: "composition", label: "COMPOSITION", rows: 3, copyable: true },
  { key: "slots", label: "SLOTS", rows: 1 },
  { key: "typography", label: "TYPOGRAPHY", rows: 2, copyable: true },
  { key: "keywordBank", label: "KEYWORD BANK", rows: 2, copyable: true },
  { key: "reusablePrompt", label: "REUSABLE PROMPT", rows: 6, copyable: true },
  { key: "typePrompt", label: "TYPE PROMPT", rows: 3, copyable: true },
  { key: "printsBeautifullyOn", label: "PRINTS BEAUTIFULLY ON", rows: 2 },
  { key: "worksWithTweaksOn", label: "WORKS WITH TWEAKS ON", rows: 2 },
  { key: "avoidOn", label: "AVOID ON", rows: 2 },
  { key: "ruleOfThumb", label: "RULE OF THUMB", rows: 2 },
  { key: "notes", label: "NOTES", rows: 2 },
];

const CATEGORIES = ["Humor", "Minimalist", "Retro", "Illustrative", "Moody"];

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

export function StylesBrowser({ styles }: { styles: StyleCard[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const open = styles.find((s) => s.id === openId) ?? null;

  function openStyle(s: StyleCard) {
    setOpenId(s.id);
    setDraft({ name: s.name, category: s.category, ...s.fields });
    setDirty(false);
    setError(null);
    setConfirmDelete(false);
  }

  function edit(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  async function save() {
    if (!open) return;
    setBusy("save");
    setError(null);
    const res = await fetch(`/api/styles/${open.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Save failed");
    else {
      setDirty(false);
      router.refresh();
    }
    setBusy(null);
  }

  async function remove() {
    if (!open) return;
    setBusy("delete");
    setError(null);
    const res = await fetch(`/api/styles/${open.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Delete failed");
    else {
      setOpenId(null);
      router.refresh();
    }
    setBusy(null);
  }

  // ---- detail (split view) ----
  if (open) {
    return (
      <div className="stack-16">
        <div className="row-gap-12" style={{ justifyContent: "space-between" }}>
          <button className="btn btn-tertiary" onClick={() => setOpenId(null)}>
            ← All styles
          </button>
          <div className="row-gap-12">
            {dirty ? <span className="hint">Unsaved changes</span> : null}
            <button className="btn btn-primary" onClick={save} disabled={busy !== null || !dirty}>
              {busy === "save" ? <span className="spinner" /> : null}
              Save changes
            </button>
          </div>
        </div>

        {error ? <div className="callout blocked">{error}</div> : null}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 380px) 1fr", gap: 22, alignItems: "start" }}>
          {/* reference — stays in view while editing */}
          <div className="card supporting" style={{ position: "sticky", top: 16 }}>
            <Kicker>REFERENCE</Kicker>
            {open.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={open.imageUrl}
                alt=""
                style={{ width: "100%", borderRadius: 8, objectFit: "contain", background: "#fff" }}
              />
            ) : (
              <div className="hint">No reference image on this style.</div>
            )}
            <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
              <span className="chip neutral">{draft.category || open.category}</span>
              <span className="chip count">used in {open.usedIn}</span>
            </div>
            <button
              className="btn btn-tertiary"
              style={{ alignSelf: "flex-start" }}
              disabled={busy !== null}
              onClick={() => setConfirmDelete(true)}
            >
              Delete style
            </button>
          </div>

          {/* fields */}
          <div className="card stack-12">
            <div className="row-gap-12" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 260px" }}>
                <label className="kicker" htmlFor="st-name">NAME</label>
                <input
                  id="st-name"
                  className="input"
                  value={draft.name ?? ""}
                  onChange={(e) => edit("name", e.target.value)}
                />
              </div>
              <div className="field">
                <label className="kicker" htmlFor="st-cat">CATEGORY</label>
                <select
                  id="st-cat"
                  className="select"
                  value={draft.category ?? ""}
                  onChange={(e) => edit("category", e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            {FIELDS.map((f) => (
              <div key={f.key} className="field">
                <div className="row-gap-8" style={{ alignItems: "center" }}>
                  <label className="kicker" htmlFor={`st-${f.key}`}>{f.label}</label>
                  {f.copyable ? <CopyButton text={draft[f.key] ?? ""} /> : null}
                </div>
                <textarea
                  id={`st-${f.key}`}
                  className="textarea"
                  rows={f.rows}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => edit(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* delete confirm — archive to Notion trash, 30-day recovery */}
        {confirmDelete ? (
          <div className="modal-scrim" onClick={() => setConfirmDelete(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="card-title">Delete &ldquo;{open.name}&rdquo;?</div>
              {open.usedIn > 0 ? (
                <div className="callout blocked">
                  {open.usedIn} design{open.usedIn === 1 ? "" : "s"} reference this style. Their
                  relation will point at an archived page.
                </div>
              ) : null}
              <div className="body-sm muted">
                It moves to Notion&apos;s trash and is recoverable there for 30 days.
              </div>
              <div className="row-gap-12">
                <button className="btn btn-secondary" onClick={remove} disabled={busy !== null}>
                  {busy === "delete" ? <span className="spinner" /> : null}
                  Delete style
                </button>
                <button className="btn btn-tertiary" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ---- grid ----
  return (
    <div className="inbox-grid">
      {styles.map((s) => (
        <button key={s.id} className="idea-card" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => openStyle(s)}>
          {s.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.imageUrl} alt="" className="idea-thumb" />
          ) : null}
          <div className="title">{s.name}</div>
          <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
            {s.category ? <span className="chip neutral">{s.category}</span> : null}
            <span className="chip count">used in {s.usedIn}</span>
          </div>
        </button>
      ))}
      {styles.length === 0 ? (
        <div className="hint">No styles yet — capture one from a reference above.</div>
      ) : null}
    </div>
  );
}
