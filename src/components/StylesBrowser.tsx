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
import { AutoTextarea } from "./AutoTextarea";
import { CopyIconButton } from "./CopyIconButton";

export interface StyleCard {
  id: string;
  name: string;
  category: string;
  imageUrl: string | null;
  usedIn: number;
  fields: Record<string, string>; // form key → value
}

// Working order: the two prompts you actually copy sit at the top, layout
// mechanics (composition, slots — Apply mode's inputs) at the bottom.
const FIELDS: Array<{ key: string; label: string; copyable?: boolean }> = [
  { key: "description", label: "DESCRIPTION", copyable: true },
  { key: "reusablePrompt", label: "REUSABLE PROMPT", copyable: true },
  { key: "typePrompt", label: "TYPE PROMPT", copyable: true },
  { key: "typography", label: "TYPOGRAPHY", copyable: true },
  { key: "keywordBank", label: "KEYWORD BANK", copyable: true },
  { key: "printsBeautifullyOn", label: "PRINTS BEAUTIFULLY ON" },
  { key: "worksWithTweaksOn", label: "WORKS WITH TWEAKS ON" },
  { key: "avoidOn", label: "AVOID ON" },
  { key: "ruleOfThumb", label: "RULE OF THUMB" },
  { key: "composition", label: "COMPOSITION — LAYOUT SKELETON", copyable: true },
  { key: "slots", label: "SLOTS — APPLY MODE'S FILL-IN FIELDS" },
  { key: "notes", label: "NOTES" },
];


const CATEGORIES = ["Humor", "Minimalist", "Retro", "Illustrative", "Moody"];

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
                  {f.copyable ? <CopyIconButton text={draft[f.key] ?? ""} label={f.label} /> : null}
                </div>
                <AutoTextarea
                  id={`st-${f.key}`}
                  value={draft[f.key] ?? ""}
                  onChange={(v) => edit(f.key, v)}
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
          {/* one line, always — long names ellipsize rather than wrap */}
          <div className="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {s.name}
          </div>
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
