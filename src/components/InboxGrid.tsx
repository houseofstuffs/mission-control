"use client";

/**
 * Ideas inbox — capture is one action, triage happens here at a desk
 * (spec §4.3). Ideas promote to Niches (gate: Unevaluated), attach to
 * existing niches, or get discarded. Seasonal lead-time math surfaces which
 * ideas must enter creative this week.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Single-part Notion upload cap; free-plan workspaces enforce ~5MB server-side. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface IdeaCardData {
  id: string;
  title: string;
  status: string;
  captureType: string;
  sourceUrl: string | null;
  note: string;
  occasion: string | null;
  occasionDate: string | null;
  leadTimeDays: number | null;
  enterCreativeBy: string | null;
  nicheName: string | null;
  imageUrl: string | null;
}

export interface NicheOption {
  id: string;
  name: string;
  gate: string;
}

const OCCASIONS = [
  "", "Halloween", "Christmas", "Valentine's Day", "Mother's Day", "Father's Day",
  "Easter", "St. Patrick's Day", "Thanksgiving", "Graduation",
];

function ymd(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** nth occurrence of a weekday (0=Sun) in a month (1-based) of a year. */
function nthWeekday(year: number, month1: number, weekday: number, n: number): string {
  const first = new Date(year, month1 - 1, 1).getDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return ymd(year, month1, day);
}

/** Gregorian Easter (Meeus/Jones/Butcher algorithm). */
function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

function dateInYear(occasion: string, year: number): string | null {
  switch (occasion) {
    case "Halloween": return ymd(year, 10, 31);
    case "Christmas": return ymd(year, 12, 25);
    case "Valentine's Day": return ymd(year, 2, 14);
    case "St. Patrick's Day": return ymd(year, 3, 17);
    case "Mother's Day": return nthWeekday(year, 5, 0, 2); // 2nd Sunday of May
    case "Father's Day": return nthWeekday(year, 6, 0, 3); // 3rd Sunday of June
    case "Thanksgiving": return nthWeekday(year, 11, 4, 4); // 4th Thursday of November
    case "Easter": return easter(year);
    default: return null;
  }
}

/** Auto-fill with the NEXT occurrence of an occasion (US dates): this year's
 * date if it hasn't passed, otherwise next year's — floating holidays are
 * recomputed for the new year, not just year-bumped. Graduation has no
 * single date, so it stays manual. Always editable after. */
function occasionDateFor(occasion: string, today: Date): string | null {
  const year = today.getFullYear();
  const thisYear = dateInYear(occasion, year);
  if (!thisYear) return null;
  const todayStr = ymd(year, today.getMonth() + 1, today.getDate());
  return thisYear >= todayStr ? thisYear : dateInYear(occasion, year + 1);
}

export function InboxGrid({
  ideas,
  niches,
  emptyHero,
}: {
  ideas: IdeaCardData[];
  niches: NicheOption[];
  /** server-rendered empty state, placed inside the drop-target area */
  emptyHero?: React.ReactNode;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // "+ New niche…" inline flow: which idea it's open for, and the typed name
  const [newNicheFor, setNewNicheFor] = useState<string | null>(null);
  const [newNicheName, setNewNicheName] = useState("");

  // quick capture form
  const [name, setName] = useState("");
  const [captureType, setCaptureType] = useState("Copy");
  const [sourceUrl, setSourceUrl] = useState("");
  const [note, setNote] = useState("");
  const [occasion, setOccasion] = useState("");
  const [occasionDate, setOccasionDate] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pendingFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  function takeFile(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Only images can be attached to an idea.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("That image is over 20MB — idea snapshots should be small; artwork belongs in Drive.");
      return;
    }
    setError(null);
    setPendingFile(file);
    setCaptureType("Photo");
  }

  async function capture() {
    if (!name.trim() && !pendingFile) return;
    setSaving(true);
    setError(null);
    // multipart when an image rides along; plain JSON otherwise
    let res: Response;
    if (pendingFile) {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("captureType", captureType);
      if (sourceUrl) form.append("sourceUrl", sourceUrl);
      if (note) form.append("note", note);
      if (occasion) form.append("occasion", occasion);
      if (occasionDate) form.append("occasionDate", occasionDate);
      if (leadTime) form.append("leadTimeDays", leadTime);
      form.append("image", pendingFile, pendingFile.name);
      res = await fetch("/api/ideas", { method: "POST", body: form });
    } else {
      res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          captureType,
          sourceUrl: sourceUrl || undefined,
          note: note || undefined,
          occasion: occasion || undefined,
          occasionDate: occasionDate || undefined,
          leadTimeDays: leadTime || undefined,
        }),
      });
    }
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Capture failed");
    else {
      setName(""); setSourceUrl(""); setNote(""); setOccasion(""); setOccasionDate(""); setLeadTime("");
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    }
    setSaving(false);
  }

  async function triage(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/ideas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Action failed");
    else router.refresh();
    setBusyId(null);
  }

  const urgent = ideas.filter(
    (i) =>
      i.status === "Inbox" &&
      i.enterCreativeBy &&
      new Date(i.enterCreativeBy).getTime() - Date.now() < 7 * 86400_000
  );

  // the COLORED BOX is the one and only drop target — the big mint hero when
  // the inbox is empty, a compact mint tile in the grid once ideas exist.
  // Paste (Ctrl+V) still works anywhere on the page; it has no target to miss.
  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      takeFile(e.dataTransfer.files?.[0]);
    },
  };

  return (
    <div
      className="stack-22"
      onPaste={(e) => {
        const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
        if (file) {
          e.preventDefault();
          takeFile(file);
        }
      }}
    >
      {/* quick capture */}
      <div className="card supporting">
        <div className="kicker">QUICK CAPTURE</div>
        {/* split layout, same as the styles capture panel: form left, drop
            zone right, equal halves (stacks on narrow screens) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, alignItems: "stretch" }}>
          <div className="stack-12">
            <div className="row-gap-12" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 200px" }}>
                <label className="kicker" htmlFor="cap-name">IDEA</label>
                <input id="cap-name" className="input" placeholder="One line is enough" value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") capture(); }} />
              </div>
              <div className="field">
                <label className="kicker" htmlFor="cap-type">TYPE</label>
                <select id="cap-type" className="select" value={captureType} onChange={(e) => setCaptureType(e.target.value)}>
                  <option>Copy</option><option>URL</option><option>Photo</option><option>Screengrab</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label className="kicker" htmlFor="cap-url">URL</label>
              <input id="cap-url" className="input" placeholder="https://…" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
            </div>
            <div className="row-gap-12" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="field">
                <label className="kicker" htmlFor="cap-occ">OCCASION</label>
                <select
                  id="cap-occ"
                  className="select"
                  value={occasion}
                  onChange={(e) => {
                    const chosen = e.target.value;
                    setOccasion(chosen);
                    const auto = occasionDateFor(chosen, new Date());
                    if (auto) setOccasionDate(auto); // pre-fill; the date field stays editable
                  }}
                >
                  {OCCASIONS.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="kicker" htmlFor="cap-date">OCCASION DATE</label>
                <input id="cap-date" type="date" className="input" value={occasionDate} onChange={(e) => setOccasionDate(e.target.value)} />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label className="kicker" htmlFor="cap-lead">LEAD DAYS</label>
                <input id="cap-lead" type="number" className="input" placeholder="e.g. 45" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <input className="input" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="row-gap-12">
              <button
                className="btn btn-primary"
                onClick={capture}
                disabled={saving || (!name.trim() && !pendingFile)}
              >
                {saving ? <span className="spinner" /> : null}
                {saving && pendingFile ? "Uploading" : "Capture"}
              </button>
            </div>
          </div>

          <div className="stack-12">
            <button
              className="drop-tile"
              {...dropHandlers}
              onClick={() => fileInputRef.current?.click()}
              style={{
                flex: 1,
                minHeight: 180,
                ...(dragOver ? { outline: "2px dashed var(--blueberry)", outlineOffset: 4 } : {}),
              }}
              aria-label="Drop an image to capture an idea"
            >
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
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
            {pendingFile ? (
              <div className="row-gap-12">
                <span className="body-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pendingFile.name}
                </span>
                <button
                  className="btn btn-tertiary"
                  style={{ fontSize: 12, padding: "5px 10px" }}
                  onClick={() => {
                    setPendingFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => takeFile(e.target.files?.[0])}
        />
      </div>

      {urgent.length > 0 ? (
        <div className="callout stale">
          {urgent.length} idea{urgent.length === 1 ? "" : "s"} need{urgent.length === 1 ? "s" : ""} to
          enter creative within a week to make {urgent[0].occasion || "their occasion"}:
          {" "}{urgent.map((i) => i.title).join(", ")}.
        </div>
      ) : null}

      {error ? <div className="callout blocked">{error}</div> : null}

      <div className="inbox-grid">
        {ideas.map((idea) => (
          <div key={idea.id} className="idea-card">
            {idea.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={idea.imageUrl} alt="" className="idea-thumb" />
            ) : null}
            <div className="title">{idea.title}</div>
            <div className="hint">
              {idea.captureType}
              {idea.occasion ? ` · ${idea.occasion}` : ""}
              {idea.enterCreativeBy ? ` · creative by ${idea.enterCreativeBy}` : ""}
            </div>
            {idea.note ? <div className="body-sm">{idea.note}</div> : null}
            {idea.sourceUrl ? (
              <a className="body-sm" href={idea.sourceUrl} target="_blank" rel="noreferrer">source ↗</a>
            ) : null}
            {idea.nicheName ? <div className="chip count">→ {idea.nicheName}</div> : null}
            {idea.status === "Inbox" ? (
              <div className="idea-actions">
                {newNicheFor === idea.id ? (
                  <>
                    <input
                      className="input input-compact"
                      style={{ width: 170, height: 32 }}
                      value={newNicheName}
                      autoFocus
                      placeholder="Niche name"
                      onChange={(e) => setNewNicheName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newNicheName.trim()) {
                          triage(idea.id, { action: "promote", nicheName: newNicheName.trim() });
                          setNewNicheFor(null);
                        }
                        if (e.key === "Escape") setNewNicheFor(null);
                      }}
                    />
                    <button className="btn btn-secondary" disabled={busyId === idea.id || !newNicheName.trim()}
                      onClick={() => {
                        triage(idea.id, { action: "promote", nicheName: newNicheName.trim() });
                        setNewNicheFor(null);
                      }}>
                      Create
                    </button>
                    <button className="btn btn-tertiary" onClick={() => setNewNicheFor(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <select
                    className="select input-compact"
                    style={{ width: 190, height: 32 }}
                    value=""
                    disabled={busyId === idea.id}
                    onChange={(e) => {
                      if (e.target.value === "__new__") {
                        setNewNicheName(idea.title); // prefill; edit or keep
                        setNewNicheFor(idea.id);
                      } else if (e.target.value) {
                        triage(idea.id, { action: "attach", nicheId: e.target.value });
                      }
                    }}
                  >
                    <option value="" disabled>Niche…</option>
                    {niches.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} · {n.gate.toLowerCase()}
                      </option>
                    ))}
                    <option value="__new__">＋ New niche…</option>
                  </select>
                )}
                <button className="btn btn-tertiary" disabled={busyId === idea.id}
                  onClick={() => triage(idea.id, { action: "discard" })}>
                  Discard
                </button>
              </div>
            ) : (
              <div className="row-gap-8">
                <span className={`chip ${idea.status === "Discarded" ? "neutral" : "done"}`}>{idea.status}</span>
                {idea.status === "Discarded" ? (
                  <button className="btn btn-tertiary" style={{ fontSize: 12, padding: "5px 10px" }}
                    disabled={busyId === idea.id}
                    onClick={() => triage(idea.id, { action: "restore" })}>
                    Restore
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
      {emptyHero ? (
        <div
          {...dropHandlers}
          onClick={() => fileInputRef.current?.click()}
          style={{
            cursor: "pointer",
            borderRadius: 20,
            ...(dragOver ? { background: "var(--hover-blue-pale)" } : {}),
          }}
        >
          {emptyHero}
        </div>
      ) : null}
    </div>
  );
}
