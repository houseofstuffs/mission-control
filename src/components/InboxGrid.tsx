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

export function InboxGrid({ ideas, niches }: { ideas: IdeaCardData[]; niches: NicheOption[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  return (
    <div className="stack-22">
      {/* quick capture — drop zone, paste target, and form in one */}
      <div
        className="card supporting"
        style={dragOver ? { borderColor: "var(--blueberry)", background: "var(--hover-blue-pale)" } : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          takeFile(e.dataTransfer.files?.[0]);
        }}
        onPaste={(e) => {
          const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
          if (file) {
            e.preventDefault();
            takeFile(file);
          }
        }}
      >
        <div className="kicker">QUICK CAPTURE</div>
        <div className="row-gap-12" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "1 1 220px" }}>
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
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label className="kicker" htmlFor="cap-url">URL</label>
            <input id="cap-url" className="input" placeholder="https://…" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          </div>
          <div className="field">
            <label className="kicker" htmlFor="cap-occ">OCCASION</label>
            <select id="cap-occ" className="select" value={occasion} onChange={(e) => setOccasion(e.target.value)}>
              {OCCASIONS.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="kicker" htmlFor="cap-date">OCCASION DATE</label>
            <input id="cap-date" type="date" className="input" value={occasionDate} onChange={(e) => setOccasionDate(e.target.value)} />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label className="kicker" htmlFor="cap-lead">LEAD DAYS</label>
            <input id="cap-lead" type="number" className="input" placeholder="e.g. 45" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
          </div>
          <button
            className="btn btn-primary"
            onClick={capture}
            disabled={saving || (!name.trim() && !pendingFile)}
          >
            {saving ? <span className="spinner" /> : null}
            {saving && pendingFile ? "Uploading" : "Capture"}
          </button>
        </div>
        <div className="field">
          <input className="input" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="row-gap-12">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              style={{ height: 56, borderRadius: 10, border: "2px solid var(--border-faint)" }}
            />
          ) : null}
          {pendingFile ? (
            <>
              <span className="body-sm">{pendingFile.name}</span>
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
            </>
          ) : (
            <span className="hint">
              Drag an image here, paste a screenshot, or{" "}
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  font: "inherit",
                  color: "var(--blueberry)",
                  cursor: "pointer",
                }}
              >
                browse
              </button>
              . With an image attached, the name is optional.
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => takeFile(e.target.files?.[0])}
          />
        </div>
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
              <img src={idea.imageUrl} alt="" style={{ borderRadius: 10, maxHeight: 140, objectFit: "cover" }} />
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
                <button className="btn btn-secondary" disabled={busyId === idea.id}
                  onClick={() => triage(idea.id, { action: "promote", nicheName: idea.title })}>
                  Promote to niche
                </button>
                {niches.length > 0 ? (
                  <select
                    className="select input-compact"
                    style={{ width: 150, height: 32 }}
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) triage(idea.id, { action: "attach", nicheId: e.target.value });
                    }}
                  >
                    <option value="" disabled>Attach to niche…</option>
                    {niches.map((n) => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                  </select>
                ) : null}
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
    </div>
  );
}
