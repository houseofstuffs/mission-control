"use client";

/**
 * C6's record — WHICH texture was used, and how it was applied.
 *
 * The choice writes to the design's Texture relation, which is what makes the
 * Library's "used in N" counts real: favourites derive from usage, never a
 * hand-maintained list. A texture missing from the library can be added here
 * rather than in Notion.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker, Spinner } from "./ui";
import { AutoTextarea } from "./AutoTextarea";
import { apiCall, apiJson } from "@/lib/api";

export interface TextureData {
  designId: string;
  textureId: string | null;
  textureDetail: string;
  snapshotUrl: string | null;
  textures: Array<{ id: string; name: string; source: string }>;
}

export function TexturePick({ data }: { data: TextureData }) {
  const router = useRouter();
  const [textureId, setTextureId] = useState(data.textureId ?? "");
  const [detail, setDetail] = useState(data.textureDetail);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSource, setNewSource] = useState("Kittl");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the artwork is textured AND knocked out by now — the best thumbnail the
  // board can have before C7's refined export replaces it
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [backdrop, setBackdrop] = useState("auto");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dirty = file !== null || textureId !== (data.textureId ?? "") || detail !== data.textureDetail;

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function save() {
    setBusy(true);
    setError(null);
    // uploads go to the POST subroute — multipart on PATCH doesn't survive
    let res;
    if (file) {
      const form = new FormData();
      form.append("textureId", textureId || "");
      form.append("textureDetail", detail);
      form.append("snapshot", file, file.name);
      form.append("snapshotBackdrop", backdrop);
      res = await apiCall(`/api/designs/${data.designId}/snapshot`, { method: "POST", body: form });
    } else {
      res = await apiJson(`/api/designs/${data.designId}`, "PATCH", {
        textureId: textureId || null,
        textureDetail: detail,
      });
    }
    if (!res.ok) setError(res.error);
    else {
      setFile(null);
      router.refresh();
    }
    setBusy(false);
  }

  async function addTexture() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    const res = await apiJson<{ record: { id: string } }>("/api/textures", "POST", {
      name: newName.trim(),
      source: newSource,
    });
    if (!res.ok) setError(res.error);
    else {
      // attach it straight away — adding one here means you just used it
      const attach = await apiJson(`/api/designs/${data.designId}`, "PATCH", {
        textureId: res.data.record.id,
        textureDetail: detail,
      });
      if (!attach.ok) setError(attach.error);
      else {
        setAdding(false);
        setNewName("");
        router.refresh();
      }
    }
    setBusy(false);
  }

  return (
    <div className="card supporting">
      <Kicker>TEXTURE USED — C6&apos;S OUTPUT</Kicker>
      {adding ? (
        <div className="row-gap-12" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "1 1 200px" }}>
            <label className="kicker" htmlFor="tx-new">TEXTURE NAME</label>
            <input
              id="tx-new"
              className="input"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTexture();
                if (e.key === "Escape") setAdding(false);
              }}
            />
          </div>
          <div className="field">
            <label className="kicker" htmlFor="tx-src">SOURCE</label>
            <select id="tx-src" className="select" value={newSource} onChange={(e) => setNewSource(e.target.value)}>
              <option>Kittl</option>
              <option>Owned file</option>
            </select>
          </div>
          <button className="btn btn-secondary" onClick={addTexture} disabled={busy || !newName.trim()}>
            <Spinner active={busy} />
            Add + use
          </button>
          <button className="btn btn-tertiary" onClick={() => setAdding(false)} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="field">
          <label className="kicker" htmlFor="tx-pick">WHICH TEXTURE</label>
          <select
            id="tx-pick"
            className="select"
            style={{ maxWidth: 340 }}
            value={textureId}
            onChange={(e) => {
              if (e.target.value === "__new__") setAdding(true);
              else setTextureId(e.target.value);
            }}
          >
            <option value="">No texture on this design</option>
            {data.textures.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.source ? ` · ${t.source.toLowerCase()}` : ""}
              </option>
            ))}
            <option value="__new__">＋ New texture…</option>
          </select>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, alignItems: "stretch" }}>
        <div className="stack-12">
          <div className="field">
            <label className="kicker" htmlFor="tx-detail">HOW IT WAS APPLIED — MASK OR OVERLAY, STRENGTH</label>
            <AutoTextarea
              id="tx-detail"
              placeholder="e.g. mask at 60%, grain eats the edges"
              value={detail}
              onChange={setDetail}
            />
          </div>
          {file ? (
            <div className="field">
              <label className="kicker" htmlFor="tx-bg">IF TRANSPARENT, PREVIEW ON</label>
              <select
                id="tx-bg"
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
              Save texture
            </button>
            {file ? (
              <button className="btn btn-tertiary" onClick={() => setFile(null)} disabled={busy}>
                Remove preview
              </button>
            ) : null}
          </div>
          {error ? <div className="callout blocked">{error}</div> : null}
          <span className="hint">
            Textured and knocked out — good enough to be the board&apos;s thumbnail now. C7&apos;s
            refined export replaces it later.
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
          {previewUrl || data.snapshotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={(previewUrl || data.snapshotUrl)!}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <>
              <span style={{ fontSize: 26, lineHeight: 1, color: "var(--text-on-mint-title)" }}>+</span>
              <span className="kicker" style={{ color: "var(--text-on-mint-title)" }}>
                THUMBNAIL — TEXTURED + KNOCKED OUT
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
