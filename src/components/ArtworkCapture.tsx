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
import { BusyNote } from "./BusyNote";
import { apiCall } from "@/lib/api";

export interface ArtworkData {
  designId: string;
  snapshotUrl: string | null;
  artworkLink: string;
  winningModel: string;
}

export function ArtworkCapture({ data }: { data: ArtworkData }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [link, setLink] = useState(data.artworkLink);
  const [model, setModel] = useState(data.winningModel);
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

  const dirty = file !== null || link !== data.artworkLink || model !== data.winningModel;

  async function save() {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("artworkLink", link);
    form.append("winningModel", model);
    if (file) form.append("snapshot", file, file.name);
    const res = await apiCall(`/api/designs/${data.designId}`, { method: "PATCH", body: form });
    if (!res.ok) setError(res.error);
    else {
      setFile(null);
      router.refresh();
    }
    setBusy(false); // always runs — apiCall never rejects
  }

  const shownPreview = previewUrl || data.snapshotUrl;

  return (
    <div className="card supporting">
      <Kicker>SELECTED ARTWORK — C2&apos;S OUTPUT</Kicker>
      {error ? <div className="callout blocked">{error}</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, alignItems: "stretch" }}>
        <div className="stack-12">
          <div className="field">
            <label className="kicker" htmlFor="art-link">MASTER PNG LINK — TRANSPARENT BACKGROUND</label>
            <input
              id="art-link"
              className="input"
              placeholder="https://… — wherever the master file lives, tool-agnostic"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="kicker" htmlFor="art-model">GENERATION MODEL — WHICH ONE WON</label>
            <input
              id="art-model"
              className="input"
              list="gen-models"
              placeholder="e.g. Ideogram, Flux, DALL·E, Midjourney…"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <datalist id="gen-models">
              <option value="Kittl — Ideogram" />
              <option value="Kittl — Flux" />
              <option value="Kittl — DALL·E" />
              <option value="Kittl — Stable Diffusion" />
              <option value="Midjourney" />
              <option value="ChatGPT / GPT Image" />
              <option value="Ideogram" />
              <option value="Flux" />
            </datalist>
            <span className="hint">Logged per design — after ten designs this shows which model earns its keep.</span>
          </div>
          <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
              {busy ? <span className="spinner" /> : null}
              Save artwork
            </button>
            {file && !busy ? (
              <button className="btn btn-tertiary" onClick={() => setFile(null)}>
                Remove snapshot
              </button>
            ) : null}
            <BusyNote active={busy} label={file ? "Uploading snapshot" : "Saving"} />
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
