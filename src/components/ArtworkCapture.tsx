"use client";

/**
 * C2's output — which generation won, and the board's first thumbnail.
 *
 * This snapshot is the raw generation: no text, no texture, not knocked out.
 * That's deliberate — the board needs a picture from the moment artwork
 * exists, and this one carries it until C7 exports the finished master and
 * replaces it. Durable files are captured at C7, not here.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker, Spinner } from "./ui";
import { apiCall, apiJson } from "@/lib/api";

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
  const [model, setModel] = useState(data.winningModel);
  // transparent artwork needs a backdrop to read as a thumbnail; auto picks
  // the contrasting one. Affects the preview only, never the master.
  const [backdrop, setBackdrop] = useState("auto");
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

  const dirty = file !== null || model !== data.winningModel;

  async function save() {
    setBusy(true);
    setError(null);
    // uploads go to the POST subroute — multipart on PATCH doesn't survive
    let res;
    if (file) {
      const form = new FormData();
      form.append("winningModel", model);
      form.append("snapshot", file, file.name);
      form.append("snapshotBackdrop", backdrop);
      res = await apiCall(`/api/designs/${data.designId}/snapshot`, { method: "POST", body: form });
    } else {
      res = await apiJson(`/api/designs/${data.designId}`, "PATCH", { winningModel: model });
    }
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
      <Kicker>SELECTED GENERATION — C2&apos;S OUTPUT</Kicker>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, alignItems: "stretch" }}>
        <div className="stack-12">
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
          {file ? (
            <div className="field">
              <label className="kicker" htmlFor="art-bg">IF TRANSPARENT, PREVIEW ON</label>
              <select
                id="art-bg"
                className="select"
                style={{ maxWidth: 260 }}
                value={backdrop}
                onChange={(e) => setBackdrop(e.target.value)}
              >
                <option value="auto">Auto — contrast with the artwork</option>
                <option value="white">White</option>
                <option value="black">Black</option>
                <option value="transparent">Keep transparent</option>
              </select>
            </div>
          ) : null}
          <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
              <Spinner active={busy} />
              Save artwork
            </button>
            {file ? (
              <button className="btn btn-tertiary" onClick={() => setFile(null)} disabled={busy}>
                Remove snapshot
              </button>
            ) : null}
          </div>
          {error ? <div className="callout blocked">{error}</div> : null}
          <span className="hint">
            Gives the board a picture from the moment artwork exists. The finished master PNG and
            PSD are captured at C7, and the final preview replaces this thumbnail then.
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
