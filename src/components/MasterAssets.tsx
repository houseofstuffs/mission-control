"use client";

/**
 * C7's output — everything durable the creative workflow produces.
 *
 * The refined PSD is the master asset (spec §3.6); the master PNG is
 * EXPORTED FROM IT after cleanup, so both land here rather than earlier. The
 * final preview replaces the C2 generation thumbnail on the Kanban board —
 * the raw generation carries the board until there's something better.
 *
 * Files live in Drive/S3; Notion holds links. The snapshot is a downrezzed
 * preview, never the asset.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker, Spinner } from "./ui";
import { apiCall, apiJson } from "@/lib/api";
import { downscaleImage } from "@/lib/downscale";

export interface MasterAssetsData {
  designId: string;
  psdLink: string;
  psdSavedAt: string | null;
  masterPngLink: string;
  snapshotUrl: string | null;
}

export function MasterAssets({ data }: { data: MasterAssetsData }) {
  const router = useRouter();
  const [psd, setPsd] = useState(data.psdLink);
  const [png, setPng] = useState(data.masterPngLink);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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

  const dirty = file !== null || psd !== data.psdLink || png !== data.masterPngLink;

  async function save() {
    setBusy(true);
    setError(null);
    // uploads go to the POST subroute — multipart on PATCH doesn't survive
    let res;
    if (file) {
      const form = new FormData();
      form.append("psdLink", psd);
      form.append("artworkLink", png);
      // shrink first: a full-res generation is far too big to upload whole
      const small = await downscaleImage(file);
      form.append("snapshot", small, small.name);
      res = await apiCall(`/api/designs/${data.designId}/snapshot`, { method: "POST", body: form });
    } else {
      res = await apiJson(`/api/designs/${data.designId}`, "PATCH", { psdLink: psd, artworkLink: png });
    }
    if (!res.ok) setError(res.error);
    else {
      setFile(null);
      router.refresh();
    }
    setBusy(false);
  }

  const shownPreview = previewUrl || data.snapshotUrl;

  return (
    <div className="card supporting">
      <Kicker>MASTER ASSETS — C7&apos;S OUTPUT</Kicker>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, alignItems: "stretch" }}>
        <div className="stack-12">
          <div className="field">
            <label className="kicker" htmlFor="ma-psd">PSD MASTER — LAYERED, OPENS IN PHOTOPEA OR PHOTOSHOP</label>
            <input
              id="ma-psd"
              className="input"
              placeholder="https://…"
              value={psd}
              onChange={(e) => setPsd(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="kicker" htmlFor="ma-png">MASTER PNG — EXPORTED FROM THE REFINED PSD, TRANSPARENT</label>
            <input
              id="ma-png"
              className="input"
              placeholder="https://…"
              value={png}
              onChange={(e) => setPng(e.target.value)}
            />
          </div>
          <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
              <Spinner active={busy} />
              Save master assets
            </button>
            {file ? (
              <button className="btn btn-tertiary" onClick={() => setFile(null)} disabled={busy}>
                Remove preview
              </button>
            ) : null}
          </div>
          {error ? <div className="callout blocked">{error}</div> : null}
          <span className="hint">
            {data.psdSavedAt
              ? `PSD saved ${data.psdSavedAt} · unblocks the C8 validation gate.`
              : "C8 won't pass without the PSD — it's the master asset."}
          </span>
        </div>

        <button
          className="drop-tile"
          style={{
            minHeight: 170,
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
                FINAL PREVIEW — REPLACES THE THUMBNAIL
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
