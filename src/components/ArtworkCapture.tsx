"use client";

/**
 * C2's output capture: a lightweight snapshot of the selected generation
 * (drop / paste / click — powers the Kanban thumbnail) plus the link to the
 * master file. The master belongs in Drive/S3 (spec §3.6) — the snapshot is
 * a preview, never the asset.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";

export interface ArtworkData {
  designId: string;
  snapshotUrl: string | null;
  artworkLink: string;
}

export function ArtworkCapture({ data }: { data: ArtworkData }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [link, setLink] = useState(data.artworkLink);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
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

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (f) {
        e.preventDefault();
        setError(null);
        setFile(f);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const dirty = file !== null || link !== data.artworkLink;

  async function save() {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("artworkLink", link);
    if (file) form.append("snapshot", file, file.name);
    const res = await fetch(`/api/designs/${data.designId}`, { method: "PATCH", body: form });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Save failed");
    else {
      setFile(null);
      router.refresh();
    }
    setBusy(false);
  }

  const shownPreview = previewUrl || data.snapshotUrl;

  return (
    <div className="card supporting">
      <Kicker>SELECTED ARTWORK — C2&apos;S OUTPUT</Kicker>
      {error ? <div className="callout blocked">{error}</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, alignItems: "stretch" }}>
        <div className="stack-12">
          <div className="field">
            <label className="kicker" htmlFor="art-link">MASTER FILE LINK (DRIVE / KITTL)</label>
            <input
              id="art-link"
              className="input"
              placeholder="https://… — the full-res file lives in Drive, not here"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </div>
          <div className="row-gap-12">
            <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
              {busy ? <span className="spinner" /> : null}
              Save artwork
            </button>
            {file ? (
              <button className="btn btn-tertiary" onClick={() => setFile(null)} disabled={busy}>
                Remove snapshot
              </button>
            ) : null}
          </div>
          <span className="hint">
            The snapshot feeds the Kanban thumbnail and downstream reference; the master stays in Drive.
          </span>
        </div>

        <button
          className="drop-tile"
          style={{
            minHeight: 160,
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
            const f = e.dataTransfer.files?.[0];
            if (f?.type.startsWith("image/")) {
              setError(null);
              setFile(f);
            }
          }}
        >
          {shownPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shownPreview}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <>
              <span style={{ fontSize: 26, lineHeight: 1, color: "var(--text-on-mint-title)" }}>+</span>
              <span className="kicker" style={{ color: "var(--text-on-mint-title)" }}>
                DROP, PASTE (CTRL+V) OR CLICK — SNAPSHOT
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
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setError(null);
            setFile(f);
          }
        }}
      />
    </div>
  );
}
