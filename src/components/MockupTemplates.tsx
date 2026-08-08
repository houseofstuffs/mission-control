"use client";

/**
 * Mockup template intake + cards (Library).
 *
 * The intake asks for the pipeline type FIRST because it decides everything
 * after it: Simple Placement wants a base photo and four corners; Full
 * Displacement wants base + displacement map, with shadow/highlight as
 * genuinely optional extras. One save at the end — the corner placement
 * happens on the local preview BEFORE upload, so an incomplete Simple
 * Placement template can't be saved at all.
 *
 * Cards render a test drop: artwork in, finished PNG back. The route reads
 * the pipeline off the record — there is no method picker anywhere here.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Kicker, Spinner } from "./ui";
import { apiCall, apiJson } from "@/lib/api";
import { downscaleImage } from "@/lib/downscale";
import { detectColour, classifyFolder, type ClassifiedFile } from "@/lib/colourFromFilename";
import { SHOT_TYPES } from "@/config/images";
import {
  nativeDimensions,
  cropOutputSize,
  cropSquarePixels,
  cropToStandardSize,
  maxCenteredSquare,
  rectNormalizedSize,
  type CropRect,
} from "@/lib/mockupCrop";
import { QuadEditor, rectToQuad, quadToRect, type Dims } from "./QuadEditor";
import { PrintRegionModal } from "./PrintRegionModal";
import {
  PIPELINE_TYPES,
  BLEND_MODES,
  FIT_MODES,
  DEFAULT_BLEND,
  DEFAULT_FIT,
  DEFAULT_QUAD,
  MOCKUP_CROP_SIZE,
  MOCKUP_CROP_MIN,
  DEFAULT_CROP_RECT,
  type Quad,
} from "@/config/mockups";

export interface MockupTemplateCard {
  id: string;
  name: string;
  /** base photo through the thumb proxy — card-sized, cacheable */
  thumbUrl: string | null;
  pipelineType: string;
  surface: string;
  blend: string;
  quadSet: boolean;
  fit: string;
  garmentColor: string;
  baseImageUrl: string | null;
  hasDisplacement: boolean;
  hasShadow: boolean;
  hasHighlight: boolean;
  sourceLink: string;
  /** set only for colour variants created via the shot-crop batch flow */
  shotName: string | null;
  /** the owning template's id — how variants group under their template card */
  shotId: string | null;
  /** whether the ORIGINAL Drive source file id is stored — Adjust crop can
   *  load the real photo directly; false = legacy import, ask for the link */
  hasSource: boolean;
  /** where Adjust crop's box starts: the variant's own stored rect, else
   *  the shot's shared rect, else null (defaults to a centred box) */
  sourceCropRect: CropRect | null;
}

/* ---------- corner placement ---------- */

/* ---------- one upload slot ---------- */

function FileSlot({
  label,
  hint,
  file,
  onFile,
}: {
  label: string;
  hint?: string;
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="field">
      <span className="kicker">{label}</span>
      <button
        className="drop-tile"
        style={{ minHeight: 64, ...(over ? { outline: "2px dashed var(--blueberry)", outlineOffset: 3 } : {}) }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f?.type.startsWith("image/")) onFile(f);
        }}
      >
        <span className="kicker" style={{ color: "var(--text-on-mint-title)" }}>
          {file ? file.name : `DROP ${label}`}
        </span>
      </button>
      {hint ? <span className="hint">{hint}</span> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ---------- intake ---------- */

export function MockupTemplateIntake({ onClose }: { onClose?: () => void } = {}) {
  const router = useRouter();
  // with onClose the section owns visibility (always open, unmounts to
  // close); standalone it keeps its own button, as before
  const [openLocal, setOpenLocal] = useState(false);
  const open = onClose ? true : openLocal;
  const setOpen = (v: boolean) => (onClose ? (v ? undefined : onClose()) : setOpenLocal(v));
  const [name, setName] = useState("");
  const [sourceLink, setSourceLink] = useState("");
  const [pipeline, setPipeline] = useState<string>("");
  const [base, setBase] = useState<File | null>(null);
  const [displacement, setDisplacement] = useState<File | null>(null);
  const [shadow, setShadow] = useState<File | null>(null);
  const [highlight, setHighlight] = useState<File | null>(null);
  const [quad, setQuad] = useState<Quad>(DEFAULT_QUAD);
  const [quadTouched, setQuadTouched] = useState(false);
  const [blend, setBlend] = useState<string>(DEFAULT_BLEND);
  const [fit, setFit] = useState<string>(DEFAULT_FIT);
  const [garmentColor, setGarmentColor] = useState("");
  const [basePreview, setBasePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!base) {
      setBasePreview(null);
      return;
    }
    const url = URL.createObjectURL(base);
    setBasePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [base]);

  const simple = pipeline === "Simple Placement";
  const full = pipeline === "Full Displacement";

  // Mirrors the server's §4 rules so the button explains itself, but the
  // server re-checks everything — a stale page can't sneak past.
  const blocked = !name.trim()
    ? "Name the variant."
    : !pipeline
      ? "Pick a pipeline type — it decides the rest of the form."
      : !base
        ? "Every variant needs a base image."
        : full && !displacement
          ? "Full Displacement needs a displacement map."
          : simple && !quadTouched
            ? "Place the four corners on the print area."
            : null;

  async function save() {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("name", name.trim());
    form.append("pipelineType", pipeline);
    form.append("blendMode", blend);
    form.append("fitMode", fit);
    if (garmentColor.trim()) form.append("garmentColor", garmentColor.trim());
    if (sourceLink.trim()) form.append("sourceLink", sourceLink.trim());
    if (simple || quadTouched) form.append("quad", JSON.stringify(quad));
    // Notion's free plan caps uploads around 5MB — shrink to Etsy's 2000px
    const put = async (key: string, f: File | null) => {
      if (f) form.append(key, await downscaleImage(f, 2000));
    };
    await put("baseImage", base);
    await put("displacementMap", displacement);
    await put("shadowLayer", shadow);
    await put("highlightLayer", highlight);

    const res = await apiCall("/api/mockup-templates", { method: "POST", body: form });
    if (!res.ok) setError(res.error);
    else {
      setOpen(false);
      setName(""); setSourceLink(""); setPipeline(""); setBase(null); setDisplacement(null);
      setShadow(null); setHighlight(null); setQuad(DEFAULT_QUAD); setQuadTouched(false);
      setBlend(DEFAULT_BLEND); setFit(DEFAULT_FIT); setGarmentColor("");
      router.refresh();
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button className="btn btn-secondary" onClick={() => setOpen(true)}>
        ＋ Single variant (advanced)
      </button>
    );
  }

  return (
    <div className="card supporting stack-12">
      <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
        <div className="field" style={{ flex: "2 1 220px" }}>
          <label className="kicker" htmlFor="mt-name">VARIANT NAME</label>
          <input id="mt-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field" style={{ flex: "2 1 220px" }}>
          <label className="kicker" htmlFor="mt-src">SOURCE LINK</label>
          <input id="mt-src" className="input" placeholder="https://… (Drive, marketplace)" value={sourceLink} onChange={(e) => setSourceLink(e.target.value)} />
        </div>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label className="kicker" htmlFor="mt-pipe">PIPELINE — CHOOSE FIRST</label>
          <select id="mt-pipe" className="select" value={pipeline} onChange={(e) => setPipeline(e.target.value)}>
            <option value="">What kind of variant is this?</option>
            {PIPELINE_TYPES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      {simple ? (
        <>
          <FileSlot label="BASE IMAGE" file={base} onFile={setBase} />
          {basePreview ? (
            <QuadEditor
              src={basePreview}
              quad={quad}
              onChange={(q) => {
                setQuad(q);
                setQuadTouched(true);
              }}
            />
          ) : null}
          <div className="field" style={{ maxWidth: 220 }}>
            <label className="kicker" htmlFor="mt-blend">BLEND MODE</label>
            <select id="mt-blend" className="select" value={blend} onChange={(e) => setBlend(e.target.value)}>
              {BLEND_MODES.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <span className="hint">
              Multiply suits LIGHT garments (ink sinks into fabric). On dark garments DTG lays a
              white underbase, so pick Normal — multiply over a dark photo crushes every colour.
            </span>
          </div>
        </>
      ) : null}

      {full ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <FileSlot label="BASE IMAGE" file={base} onFile={setBase} />
          <FileSlot label="DISPLACEMENT MAP" file={displacement} onFile={setDisplacement} />
          <FileSlot
            label="SHADOW LAYER"
            hint="Optional — skip if your source doesn't have this layer."
            file={shadow}
            onFile={setShadow}
          />
          <FileSlot
            label="HIGHLIGHT LAYER"
            hint="Optional — skip if your source doesn't have this layer."
            file={highlight}
            onFile={setHighlight}
          />
        </div>
      ) : null}

      {pipeline ? (
        <div className="field" style={{ maxWidth: 260 }}>
          <label className="kicker" htmlFor="mt-fit">ARTWORK FIT</label>
          <select id="mt-fit" className="select" value={fit} onChange={(e) => setFit(e.target.value)}>
            {FIT_MODES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <span className="hint">
            When artwork and area shapes disagree: fit shows the whole design; fill covers
            edge-to-edge, cropping equally; fill width anchors at the top and crops the bottom —
            folded garments, where the lower print disappears into the fold. Never stretched.
          </span>
        </div>
      ) : null}

      {pipeline ? (
        <div className="field" style={{ maxWidth: 260 }}>
          <label className="kicker" htmlFor="mt-color">GARMENT COLOR — AS PRINTIFY NAMES IT</label>
          <input
            id="mt-color"
            className="input"
            placeholder="e.g. Pepper (empty = colour-neutral)"
            value={garmentColor}
            onChange={(e) => setGarmentColor(e.target.value)}
          />
          <span className="hint">
            Templates are offered to a listing only in the colours it sells. Leave empty for
            posters and other colour-neutral layouts.
          </span>
        </div>
      ) : null}

      {error ? <div className="callout blocked">{error}</div> : null}
      <div className="row-gap-12">
        <button className="btn btn-primary" onClick={save} disabled={busy || Boolean(blocked)} title={blocked ?? undefined}>
          <Spinner active={busy} />
          Save template
        </button>
        <button className="btn btn-tertiary" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        {blocked && !busy ? <span className="hint">{blocked}</span> : null}
      </div>
    </div>
  );
}

/* ---------- cards + test render ---------- */

function TemplateCard({ t }: { t: MockupTemplateCard }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [editingQuad, setEditingQuad] = useState(false);
  const [quad, setQuad] = useState<Quad>(DEFAULT_QUAD);
  // kept downscaled so opacity tweaks re-render without re-picking the file
  const [artFile, setArtFile] = useState<File | null>(null);
  const [opacity, setOpacity] = useState(100);

  // ---- Adjust crop: a one-time re-crop from the SOURCE photo that
  // REPLACES the stored Base Image — for the photo framed differently
  // from its batch, where the shared rect lands the garment off-centre.
  // Not a render-time transform: fix once, every future listing inherits.
  const [adjustingCrop, setAdjustingCrop] = useState(false);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcDims, setSrcDims] = useState<Dims | null>(null);
  const [srcNeedsLink, setSrcNeedsLink] = useState(false);
  const [srcLinkInput, setSrcLinkInput] = useState("");
  const [cropRect, setCropRect] = useState<CropRect>(t.sourceCropRect ?? DEFAULT_CROP_RECT);
  const [cropResult, setCropResult] = useState<string | null>(null);

  function closeAdjust() {
    setAdjustingCrop(false);
    setSrcUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setSrcDims(null);
    setSrcNeedsLink(false);
  }

  async function loadSource(link?: string) {
    setBusy(true);
    setError(null);
    try {
      const qs = link ? `?link=${encodeURIComponent(link)}` : "";
      const res = await fetch(`/api/mockup-templates/${t.id}/source${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.needsSource) setSrcNeedsLink(true);
        else setError(json?.error ?? `Couldn't load the source photo (${res.status}).`);
      } else {
        const w = Number(res.headers.get("x-source-width"));
        const h = Number(res.headers.get("x-source-height"));
        const blob = await res.blob();
        setSrcUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setSrcDims(w && h ? { width: w, height: h } : null);
        setSrcNeedsLink(false);
        setCropRect(t.sourceCropRect ?? DEFAULT_CROP_RECT);
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    }
    setBusy(false);
  }

  async function saveCrop() {
    setBusy(true);
    setError(null);
    const res = await apiJson<{ size?: number }>(`/api/mockup-templates/${t.id}/recrop`, "POST", {
      rect: cropRect,
      ...(srcLinkInput.trim() ? { driveLink: srcLinkInput.trim() } : {}),
    });
    if (!res.ok) setError(res.error);
    else {
      setCropResult(
        `re-cropped → ${res.data.size ?? "?"}px — stored file replaced; regenerate existing mockups to pick it up`
      );
      closeAdjust();
      router.refresh();
    }
    setBusy(false);
  }

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function testRender(file: File, opacityPct: number) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("artwork", file);
    // preview knob: multiplies the artwork's own alpha, matching what ink
    // does with soft-alpha art on fabric. Never touches real exports.
    form.append("artworkOpacity", String(opacityPct / 100));
    // raw fetch: the response is a PNG, not the JSON apiCall expects
    try {
      const res = await fetch(`/api/mockup-templates/${t.id}/render`, { method: "POST", body: form });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? `Render failed (${res.status}).`);
      } else {
        const blob = await res.blob();
        setResult((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    }
    setBusy(false);
  }

  async function patchField(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await apiJson(`/api/mockup-templates/${t.id}`, "PATCH", body);
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(false);
  }

  async function saveQuad() {
    setBusy(true);
    setError(null);
    const res = await apiJson(`/api/mockup-templates/${t.id}`, "PATCH", { quad });
    if (!res.ok) setError(res.error);
    else {
      setEditingQuad(false);
      router.refresh();
    }
    setBusy(false);
  }

  const missingCorners = t.pipelineType === "Simple Placement" && !t.quadSet;

  return (
    <div className="idea-card">
      {t.thumbUrl && !editingQuad ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.thumbUrl} alt="" className="idea-thumb" />
      ) : null}
      <div className="title">{t.name}</div>
      <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
        <span className="chip count">{t.pipelineType || "no pipeline"}</span>
        {t.shotName ? <span className="chip neutral" title="Base Image is a standardized crop from this template">{t.shotName}</span> : null}
        {t.garmentColor ? <span className="chip neutral">{t.garmentColor}</span> : null}
        {t.surface ? <span className="chip neutral">{t.surface}</span> : null}
        {t.pipelineType === "Full Displacement" ? (
          <span className="chip neutral">
            map ✓{t.hasShadow ? " · shadow ✓" : ""}{t.hasHighlight ? " · highlight ✓" : ""}
          </span>
        ) : null}
        {t.fit === "Fill area" ? <span className="chip neutral">fills area</span> : null}
        {missingCorners ? <span className="chip stale">needs corners</span> : null}
      </div>

      {/* Both knobs are correctable in place — the wrong blend on a dark
          base is discovered at the first test render, not at intake. */}
      {!editingQuad ? (
        <div className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <select
            className="select input-compact"
            style={{ width: "auto", fontSize: 12 }}
            value={t.blend || DEFAULT_BLEND}
            disabled={busy}
            aria-label="Blend mode"
            title="Multiply sinks ink into LIGHT fabric. On dark garments DTG prints a white underbase — use Normal."
            onChange={(e) => patchField({ blendMode: e.target.value })}
          >
            {BLEND_MODES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <select
            className="select input-compact"
            style={{ width: "auto", fontSize: 12 }}
            value={t.fit || DEFAULT_FIT}
            disabled={busy}
            aria-label="Artwork fit"
            onChange={(e) => patchField({ fitMode: e.target.value })}
          >
            {FIT_MODES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </div>
      ) : null}

      {editingQuad && t.baseImageUrl ? (
        <>
          <QuadEditor src={t.baseImageUrl} quad={quad} onChange={setQuad} />
          <div className="row-gap-8">
            <button className="btn btn-secondary" onClick={saveQuad} disabled={busy}>
              <Spinner active={busy} />
              Save corners
            </button>
            <button className="btn btn-tertiary" onClick={() => setEditingQuad(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      ) : adjustingCrop ? (
        srcNeedsLink ? (
          <div className="stack-12" style={{ gap: 6 }}>
            <span className="hint">
              This variant was imported before source tracking, so the original photo&apos;s location
              isn&apos;t stored. Paste its Drive share link — it&apos;s remembered after this.
            </span>
            <input
              className="input"
              placeholder="https://drive.google.com/file/d/…"
              value={srcLinkInput}
              onChange={(e) => setSrcLinkInput(e.target.value)}
            />
            <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: "4px 12px" }}
                disabled={busy || !srcLinkInput.trim()}
                onClick={() => loadSource(srcLinkInput.trim())}
              >
                <Spinner active={busy} />
                Load source photo
              </button>
              <button className="btn btn-tertiary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={closeAdjust} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        ) : srcUrl && srcDims ? (
          <>
            <span className="hint">
              Drag the box to where THIS photo&apos;s garment sits — the centre guides line up when
              it&apos;s centred. Saving replaces the stored file for good.
            </span>
            <QuadEditor
              src={srcUrl}
              squareOnly
              centerGuides
              quad={rectToQuad(cropRect, srcDims)}
              onChange={(q) => setCropRect(quadToRect(q, srcDims))}
            />
            {(() => {
              const px = cropSquarePixels(srcDims.width, srcDims.height, cropRect);
              const under = px < MOCKUP_CROP_MIN;
              return (
                <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
                  <span className="hint" style={under ? { color: "var(--status-blocked, #b3423a)", fontWeight: 700 } : undefined}>
                    crop yields {px}px{under ? ` — under the ${MOCKUP_CROP_MIN}px floor, widen the box` : ""}
                  </span>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={saveCrop} disabled={busy || under}>
                    <Spinner active={busy} />
                    Re-crop &amp; replace
                  </button>
                  <button className="btn btn-tertiary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={closeAdjust} disabled={busy}>
                    Cancel
                  </button>
                </div>
              );
            })()}
          </>
        ) : (
          <span className="hint">
            <Spinner active />
            loading the source photo from Drive…
          </span>
        )
      ) : (
        <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
          <button
            className="btn btn-tertiary"
            style={{ fontSize: 12, padding: "5px 10px" }}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "Rendering…" : artFile ? "New artwork" : "Test render"}
          </button>
          {artFile ? (
            <label className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              ink
              <input
                type="range"
                min={20}
                max={100}
                step={5}
                value={opacity}
                disabled={busy}
                onChange={(e) => setOpacity(Number(e.target.value))}
                onPointerUp={() => artFile && testRender(artFile, opacity)}
                onKeyUp={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") testRender(artFile!, opacity);
                }}
                style={{ width: 90 }}
              />
              {opacity}%
            </label>
          ) : null}
          {t.baseImageUrl && t.pipelineType === "Simple Placement" ? (
            <button
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "5px 10px" }}
              disabled={busy}
              onClick={() => setEditingQuad(true)}
            >
              {t.quadSet ? "Re-place corners" : "Place corners"}
            </button>
          ) : null}
          {t.shotId ? (
            // crop problems (garment off-centre) are NOT quad problems —
            // this re-frames from the source; corners move art on the frame
            <button
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "5px 10px" }}
              disabled={busy}
              title="Re-frame this variant from its original photo — replaces the stored file, one time"
              onClick={() => {
                setCropResult(null);
                setAdjustingCrop(true);
                if (t.hasSource) void loadSource();
                else setSrcNeedsLink(true);
              }}
            >
              Adjust crop
            </button>
          ) : null}
          {t.sourceLink ? (
            <a className="body-sm" href={t.sourceLink} target="_blank" rel="noreferrer">source ↗</a>
          ) : null}
        </div>
      )}
      {cropResult ? (
        <span className="hint" style={{ color: "var(--status-done, #3e7a4e)" }}>✓ {cropResult}</span>
      ) : null}

      {error ? <div className="callout blocked">{error}</div> : null}
      {result ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result} alt="Test render" style={{ width: "100%", borderRadius: 10 }} />
          <a className="body-sm" href={result} download={`${t.name}-test.png`}>download ↓</a>
        </>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            // a full-res master is 20-40MB and truncates in transit; the
            // renderer samples at 2400px max — shrink once, reuse after
            const small = await downscaleImage(f, 2400);
            setArtFile(small);
            testRender(small, opacity);
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}

export interface MockupShotOption {
  id: string;
  name: string;
  cropRect: CropRect | null;
  /** the printable zone drawn at definition — every variant starts from it */
  printRegionQuad: Quad | null;
  /** where this template's colour photos live — the Drive auto-import lists it */
  driveFolderLink: string;
  /** colours already saved as variants under this template — the review list unticks them */
  existingColours: string[];
  /** cropped-sample preview through the thumb proxy; null for templates saved before samples were kept */
  thumbUrl: string | null;
  /** live counts for the delete guard — what removing this template orphans */
  variantCount: number;
  listingCount: number;
  /** the background Drive import's last known state — the card shows it so
   *  a run survives being navigated away from VISIBLY, not just technically */
  importJob: {
    status: "running" | "complete" | "interrupted";
    done: number;
    total: number;
    imported: number;
    /** when the run last wrote — "last import" needs a checkable date */
    at?: string;
    /** per-file failures, so a partial import is never just a count */
    failed?: Array<{ name: string; detail: string; fileId: string | null; colour: string | null }>;
  } | null;
  /** which garment this shoot is OF — L4 filters on it; empty = every listing */
  productId: string;
  /** HOW this shoot renders — Send's join key; empty = Send can't place its renders */
  shotType: string;
}

/** the product choices the template pickers offer */
export interface ProductOption {
  id: string;
  label: string;
}

/** " Aug 6" (leading space) — or nothing when the job predates the field */
function importDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : ` ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/**
 * Templates, listed. A template with no colours yet renders nowhere else on
 * this page — the variant grid is keyed off variants — so without this a
 * successful save looked exactly like a failed one: form closes, counts
 * unchanged, nothing new on screen.
 *
 * Edit and delete live here, on hover: name and Drive link are the two
 * fields that change after creation, and neither should need a Notion
 * detour. Everything references the template by id, so a rename is safe —
 * the server re-derives the "{template} - …" strings on variant names.
 */
function TemplateRow({
  s,
  driveConnected,
  variants,
  products,
}: {
  s: MockupShotOption;
  driveConnected: boolean;
  variants: MockupTemplateCard[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [name, setName] = useState(s.name);
  const [link, setLink] = useState(s.driveFolderLink);
  const [productId, setProductId] = useState(s.productId);
  const [shotType, setShotType] = useState(s.shotType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // variants collapsed by default — the card is for recognition, the
  // expansion is for work on one template's colours
  const [showVariants, setShowVariants] = useState(false);
  // re-sync's receipt — the button re-enabling silently read as a failed
  // loop, and a per-run count is also what catches a variant the stamp
  // missed (count printed < count on the button = something skipped)
  const [syncResult, setSyncResult] = useState<string | null>(null);
  // "some failed" expands to the per-file reasons — a partial import
  // surfaced only as a count is the silent-failure pattern this project
  // keeps paying for
  const [showFailed, setShowFailed] = useState(false);
  const [retryNote, setRetryNote] = useState<string | null>(null);

  async function retryFile(f: { name: string; fileId: string | null; colour: string | null }) {
    if (!f.fileId || !f.colour) return;
    setBusy(true);
    setRetryNote(null);
    const res = await apiJson<{ job?: unknown }>("/api/drive/import", "POST", {
      shotId: s.id,
      files: [{ id: f.fileId, name: f.name, colour: f.colour }],
    });
    setRetryNote(res.ok ? `↻ retrying ${f.name} — watch the import chip` : `✕ ${res.error}`);
    setBusy(false);
    router.refresh();
  }
  // the shot-level geometry fix: wrong region = wrong for every colour
  const [editingRegion, setEditingRegion] = useState(false);

  async function saveEdits() {
    setBusy(true);
    setError(null);
    const res = await apiJson(`/api/mockup-shots/${s.id}`, "PATCH", {
      name: name.trim(),
      driveFolderLink: link.trim(),
      productId,
      ...(shotType ? { shotType } : {}),
    });
    if (!res.ok) setError(res.error);
    else {
      // a type change only reaches Send once the variants carry it
      if (shotType && shotType !== s.shotType && variants.length > 0) {
        setSyncResult(`shot type saved — hit ⟳ Re-sync to stamp it onto the ${variants.length} ${variants.length === 1 ? "variant" : "variants"} (Send matches on the variant's type)`);
      }
      setMode("view");
      router.refresh();
    }
    setBusy(false);
  }

  async function destroy() {
    setBusy(true);
    setError(null);
    const res = await apiCall(`/api/mockup-shots/${s.id}`, { method: "DELETE" });
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(false);
  }

  const folderId = s.driveFolderLink.trim();
  return (
    <div className="idea-card">
      {s.thumbUrl ? (
        // the cropped sample — the frame every variant shares, which is
        // exactly what makes cards tellable apart at a glance
        // eslint-disable-next-line @next/next/no-img-element
        <img className="idea-thumb" src={s.thumbUrl} alt={`${s.name} sample`} loading="lazy" />
      ) : (
        <div
          className="idea-thumb"
          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <span className="hint">no sample kept</span>
        </div>
      )}

      <div className="row-gap-8" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <div className="title" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {s.name}
        </div>
        {mode === "view" ? (
          <span className="row-gap-8 hover-reveal">
            <button
              type="button"
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "3px 10px" }}
              title="Rename, or change the Drive folder, product or shot type"
              onClick={() => {
                setName(s.name);
                setLink(s.driveFolderLink);
                setProductId(s.productId);
                setShotType(s.shotType);
                setError(null);
                setMode("edit");
              }}
            >
              ✎ Edit
            </button>
            <button
              type="button"
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "3px 10px" }}
              title="Delete this template"
              onClick={() => {
                setError(null);
                setMode("confirm-delete");
              }}
            >
              🗑
            </button>
          </span>
        ) : null}
      </div>

      {mode === "edit" ? (
        <div className="stack-12" style={{ gap: 6 }}>
          <div className="field">
            <label className="kicker" htmlFor={`tr-name-${s.id}`} style={{ fontSize: 10 }}>TEMPLATE NAME</label>
            <input id={`tr-name-${s.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="kicker" htmlFor={`tr-link-${s.id}`} style={{ fontSize: 10 }}>GOOGLE DRIVE FOLDER</label>
            <input
              id={`tr-link-${s.id}`}
              className="input"
              placeholder="paste the folder link — blank removes it"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="kicker" htmlFor={`tr-prod-${s.id}`} style={{ fontSize: 10 }}>PRODUCT · WHICH GARMENT THIS SHOOT IS OF</label>
            <select
              id={`tr-prod-${s.id}`}
              className="select"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">any product (shown for every listing)</option>
              {products.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.label}</option>
              ))}
            </select>
            <span className="hint">L4&apos;s template picker filters on this, so it stays short as the library grows.</span>
          </div>
          <div className="field">
            <label className="kicker" htmlFor={`tr-shot-${s.id}`} style={{ fontSize: 10 }}>SHOT TYPE · HOW SEND MATCHES SLOTS</label>
            <select
              id={`tr-shot-${s.id}`}
              className="select"
              value={shotType}
              onChange={(e) => setShotType(e.target.value)}
            >
              <option value="">— not set (Send can&apos;t place these renders) —</option>
              {SHOT_TYPES.filter((t) => t !== "Video" && t !== "Graphic Card").map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <span className="hint">After changing it, run ⟳ Re-sync so the variants carry the new type.</span>
          </div>
          {name.trim() !== s.name && s.variantCount > 0 ? (
            <span className="hint">
              Renaming also renames its {s.variantCount} {s.variantCount === 1 ? "variant" : "variants"} to match.
            </span>
          ) : null}
          <div className="row-gap-8">
            <button className="btn btn-save" style={{ fontSize: 12, padding: "4px 12px" }} onClick={saveEdits} disabled={busy || !name.trim()}>
              <Spinner active={busy} />
              Save
            </button>
            <button className="btn btn-tertiary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setMode("view")} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : mode === "confirm-delete" ? (
        <div className="stack-12" style={{ gap: 6 }}>
          <div className="callout blocked">
            {s.variantCount > 0 || s.listingCount > 0 ? (
              <>
                This template has {s.variantCount} {s.variantCount === 1 ? "variant" : "variants"}
                {s.listingCount > 0
                  ? `, used in ${s.listingCount} ${s.listingCount === 1 ? "listing" : "listings"}`
                  : ""}{" "}
                — delete anyway? The variants stay and keep working; they only lose the shared
                geometry for future batches.
              </>
            ) : (
              <>Delete this template? It has no variants yet.</>
            )}
          </div>
          <div className="row-gap-8">
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={destroy} disabled={busy}>
              <Spinner active={busy} />
              Delete template
            </button>
            <button className="btn btn-tertiary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setMode("view")} disabled={busy}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="row-gap-12" style={{ flexWrap: "wrap", marginTop: 2 }}>
            <span className={`chip ${s.cropRect ? "done" : "stale"}`}>
              {s.cropRect ? "crop set" : "no crop"}
            </span>
            {/* the chip IS the fix — a region that's wrong for the shoot
                is wrong for every colour, so it's editable at the shot */}
            <button
              type="button"
              className={`chip ${s.printRegionQuad ? "done" : "stale"}`}
              style={{ cursor: "pointer" }}
              title="Re-place the print region on this template's sample — then push it to every variant"
              onClick={() => {
                setSyncResult(null);
                setEditingRegion(true);
              }}
            >
              {s.printRegionQuad ? "print region set ✎" : "no print region — draw it"}
            </button>
            {s.shotType ? (
              <span className="chip neutral">{s.shotType}</span>
            ) : (
              // the pill IS the fix — this exact gap failed every Send
              <button
                type="button"
                className="chip stale"
                style={{ cursor: "pointer" }}
                title="Send matches renders to slots by shot type — set it, then Re-sync"
                onClick={() => {
                  setName(s.name);
                  setLink(s.driveFolderLink);
                  setProductId(s.productId);
                  setShotType(s.shotType);
                  setError(null);
                  setMode("edit");
                }}
              >
                no shot type — Send can&apos;t match
              </button>
            )}
            {/* two different facts, labelled as such: lifetime library size
                vs the LAST RUN's file count — "14 colours · 3/3 ✓" read as
                a contradiction when they shared a bare number style */}
            <span className="chip count">
              {s.existingColours.length} {s.existingColours.length === 1 ? "colour" : "colours"} in library
            </span>
            {s.importJob ? (
              s.importJob.status === "running" ? (
                <span className="chip count" title="The Drive import runs on the server — open ＋ Add colour variants for details">
                  importing {s.importJob.done}/{s.importJob.total}…
                </span>
              ) : s.importJob.status === "interrupted" ? (
                <span className="chip stale" title="Re-list the folder in ＋ Add colour variants — already-imported colours are skipped">
                  import interrupted at {s.importJob.done}/{s.importJob.total}
                </span>
              ) : s.importJob.imported === s.importJob.total ? (
                <span className="chip done">
                  last import{importDate(s.importJob.at)} · {s.importJob.imported}/{s.importJob.total} files ✓
                </span>
              ) : (
                <button
                  type="button"
                  className="chip stale"
                  style={{ cursor: "pointer" }}
                  title="Show which files failed, and why"
                  onClick={() => setShowFailed((v) => !v)}
                >
                  last import{importDate(s.importJob.at)} · {s.importJob.imported}/{s.importJob.total} files — some
                  failed {showFailed ? "▴" : "▾"}
                </button>
              )
            ) : null}
            {folderId ? (
              driveConnected ? (
                <span className="chip done">Drive folder linked</span>
              ) : (
                // the pill IS the fix — a yellow label you can't act on is
                // just a longer way to feel stuck
                <a className="chip stale" href="/api/drive/oauth/start" title="Reconnect Google Drive" style={{ textDecoration: "none" }}>
                  Drive not connected — reconnect ↗
                </a>
              )
            ) : (
              <button
                type="button"
                className="chip"
                style={{ cursor: "pointer" }}
                title="Add the Drive folder this template's photos live in"
                onClick={() => {
                  setName(s.name);
                  setLink(s.driveFolderLink);
                  setError(null);
                  setMode("edit");
                }}
              >
                no Drive folder — add one
              </button>
            )}
          </div>
          {showFailed && (s.importJob?.failed?.length ?? 0) > 0 ? (
            <div className="stack-12" style={{ gap: 4, marginTop: 4 }}>
              {s.importJob!.failed!.map((f) => (
                <span key={f.name} className="hint" style={{ color: "var(--status-stale, #b8792a)" }}>
                  ✕ {f.name} — {f.detail}
                  {f.fileId && f.colour ? (
                    <button
                      className="btn btn-tertiary"
                      style={{ fontSize: 11, padding: "1px 8px", marginLeft: 8 }}
                      disabled={busy}
                      onClick={() => retryFile(f)}
                    >
                      retry this file
                    </button>
                  ) : null}
                </span>
              ))}
              {retryNote ? <span className="hint">{retryNote}</span> : null}
            </div>
          ) : null}
          {s.existingColours.length > 0 ? (
            <div className="hint" style={{ marginTop: 2 }}>{s.existingColours.join(" · ")}</div>
          ) : (
            <div className="hint" style={{ marginTop: 2 }}>
              No colours yet — use ＋ Add colour variants to populate it.
            </div>
          )}
          {variants.length > 0 ? (
            <button
              type="button"
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "3px 10px", alignSelf: "flex-start" }}
              title="Re-stamps every variant with this template's CURRENT print region and the default blend — for regions redrawn after import, and the old Multiply default"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(`Re-apply this template's print region + default blend to ${variants.length} ${variants.length === 1 ? "variant" : "variants"}?`)) return;
                setBusy(true);
                setError(null);
                setSyncResult(null);
                const res = await apiJson<{
                  updated?: number;
                  blend?: string;
                  shotType?: string | null;
                  staleFlagged?: number;
                  listingsAffected?: number;
                }>(`/api/mockup-shots/${s.id}/resync-variants`, "POST", {});
                if (!res.ok) setError(res.error);
                else {
                  const n = res.data.updated ?? 0;
                  const flagged = res.data.staleFlagged ?? 0;
                  // the receipt names EVERYTHING the run touched — a
                  // verdict flipping without a line here reads as the app
                  // acting on its own
                  setSyncResult(
                    [
                      `re-stamped ${n} ${n === 1 ? "variant" : "variants"}`,
                      res.data.shotType ? `shot type → ${res.data.shotType}` : "⚠ no shot type set on this template",
                      `blend → ${res.data.blend ?? "?"}`,
                      "quad refreshed",
                      flagged > 0
                        ? `${flagged} ${flagged === 1 ? "render" : "renders"} flagged stale across ${res.data.listingsAffected ?? "?"} ${res.data.listingsAffected === 1 ? "listing" : "listings"} (geometry moved) — regenerate flagged at L4`
                        : null,
                      n < variants.length ? `⚠ ${variants.length - n} not linked to this template — check their Shot relation` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  );
                  router.refresh();
                }
                setBusy(false);
              }}
            >
              ⟳ Re-sync {variants.length} {variants.length === 1 ? "variant" : "variants"}
            </button>
          ) : null}
          {syncResult ? (
            <span className="hint" style={{ color: "var(--status-done, #3e7a4e)" }}>✓ {syncResult}</span>
          ) : null}
          <button
            type="button"
            className="btn btn-tertiary"
            style={{ fontSize: 12, padding: "3px 10px", alignSelf: "flex-start" }}
            title="Re-place the printable zone on this template's sample photo"
            disabled={busy}
            onClick={() => {
              setSyncResult(null);
              setEditingRegion(true);
            }}
          >
            ⬚ Re-place print region
          </button>
          {variants.length > 0 ? (
            <button
              type="button"
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "3px 10px", alignSelf: "flex-start" }}
              aria-expanded={showVariants}
              onClick={() => setShowVariants((v) => !v)}
            >
              {showVariants ? "▾ Hide" : "▸ Show"} {variants.length}{" "}
              {variants.length === 1 ? "variant" : "variants"}
            </button>
          ) : null}
          {showVariants ? (
            <div className="stack-12" style={{ gap: 10 }}>
              {variants.map((t) => (
                <TemplateCard key={t.id} t={t} />
              ))}
            </div>
          ) : null}
        </>
      )}
      {error ? <div className="callout blocked">{error}</div> : null}
      {editingRegion ? (
        <PrintRegionModal
          shotId={s.id}
          shotName={s.name}
          sampleUrl={s.thumbUrl}
          variantCount={variants.length}
          current={s.printRegionQuad}
          onClose={() => setEditingRegion(false)}
          onDone={(message) => {
            setEditingRegion(false);
            setSyncResult(message);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  connectedAt: string | null;
}

interface ShotColorRow {
  key: number;
  file: File | null;
  color: string;
  dims: { width: number; height: number } | null;
}

/**
 * Step 1 of the two-phase flow: define the template — name, crop and
 * print region — from ONE sample photo, before any colour exists. The
 * sample is only a surface to draw on: it is discarded on save, and its
 * colour joins in step 2 like any other. Splitting definition from
 * population is what retires the all-at-once batch form — geometry is
 * decided once, variants are added against it forever after.
 */
function TemplateDefine({
  onSaved,
  onClose,
  products,
}: {
  onSaved: (name: string) => void;
  onClose: () => void;
  products: ProductOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [driveLink, setDriveLink] = useState("");
  const [productId, setProductId] = useState(products.length === 1 ? products[0].id : "");
  const [shotType, setShotType] = useState("");
  const [sample, setSample] = useState<File | null>(null);
  const [dims, setDims] = useState<Dims | null>(null);
  const [samplePreview, setSamplePreview] = useState<string | null>(null);
  const [rect, setRect] = useState<CropRect>(DEFAULT_CROP_RECT);
  const [phase, setPhase] = useState<"crop" | "region">("crop");
  const [croppedPreview, setCroppedPreview] = useState<string | null>(null);
  // the cropped sample as a File — uploaded with the save as the card thumbnail
  const [croppedFile, setCroppedFile] = useState<File | null>(null);
  const [regionQuad, setRegionQuad] = useState<Quad>(DEFAULT_QUAD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sample) {
      setSamplePreview(null);
      return;
    }
    const url = URL.createObjectURL(sample);
    setSamplePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [sample]);

  async function pickSample(f: File | null) {
    setSample(f);
    const d = f ? await nativeDimensions(f) : null;
    setDims(d);
    // start at the whole frame squared off — the common case, so it costs
    // no dragging; pulling in is easier than pushing out
    setRect(d ? maxCenteredSquare(d.width, d.height) : DEFAULT_CROP_RECT);
    setPhase("crop");
    setCroppedPreview(null);
  }

  // informational on the sample — the binding feasibility check runs per
  // photo at step 2, where the real variant files arrive
  const cropPx = dims ? cropSquarePixels(dims.width, dims.height, rect) : null;

  async function confirmCrop() {
    if (!sample) return;
    setBusy(true);
    setError(null);
    try {
      // preview-sized and never upscaled — this file goes nowhere
      const target = Math.max(64, Math.min(1200, cropPx ?? 1200));
      const { file } = await cropToStandardSize(sample, rect, target);
      setCroppedFile(file);
      setCroppedPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(file);
      });
      setPhase("region");
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    // multipart: the cropped sample rides along as the card thumbnail
    const form = new FormData();
    form.append("name", name.trim());
    form.append("cropRect", JSON.stringify(rect));
    form.append("printRegionQuad", JSON.stringify(regionQuad));
    if (driveLink.trim()) form.append("driveFolderLink", driveLink.trim());
    if (productId) form.append("productId", productId);
    if (shotType) form.append("shotType", shotType);
    if (croppedFile) form.append("sampleImage", croppedFile);
    const res = await apiCall("/api/mockup-shots", { method: "POST", body: form });
    if (!res.ok) setError(res.error);
    else {
      router.refresh();
      onSaved(name.trim());
    }
    setBusy(false);
  }

  const blocked = !name.trim()
    ? "Name the template."
    : !productId
      ? "Pick the product this shoot is of — L4's picker filters on it."
      : !shotType
        ? "Pick the shot type — Send matches renders to slots by it."
        : !sample
          ? "Import one sample photo to draw the geometry on."
          : phase !== "region"
            ? "Confirm the crop, then place the print region."
            : null;

  return (
    <div className="card supporting stack-12">
      <Kicker>STEP 1 · DEFINE THE TEMPLATE — GEOMETRY ONLY, NO COLOURS YET</Kicker>
      <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label className="kicker" htmlFor="td-name">TEMPLATE NAME</label>
          <input
            id="td-name"
            className="input"
            placeholder="e.g. CC1466 Flat Lay"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field" style={{ flex: "2 1 240px" }}>
          <label className="kicker" htmlFor="td-drive">GOOGLE DRIVE FOLDER · OPTIONAL</label>
          <input
            id="td-drive"
            className="input"
            placeholder="paste the folder link — the auto-import will read it"
            value={driveLink}
            onChange={(e) => setDriveLink(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label className="kicker" htmlFor="td-product">PRODUCT · WHICH GARMENT THIS SHOOT IS OF</label>
          <select id="td-product" className="select" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">pick the garment…</option>
            {products.map((pr) => (
              <option key={pr.id} value={pr.id}>{pr.label}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label className="kicker" htmlFor="td-shot-type">SHOT TYPE · HOW SEND MATCHES SLOTS</label>
          <select id="td-shot-type" className="select" value={shotType} onChange={(e) => setShotType(e.target.value)}>
            <option value="">pick the shot type…</option>
            {SHOT_TYPES.filter((t) => t !== "Video" && t !== "Graphic Card").map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <FileSlot
          label="SAMPLE PHOTO"
          hint="Any colour from the set — drawn on, then discarded. Its colour joins in step 2 like the rest."
          file={sample}
          onFile={pickSample}
        />
        {dims && cropPx != null ? (
          <span className={`chip ${cropPx < MOCKUP_CROP_MIN ? "stale" : "done"}`} style={{ fontSize: 11 }}>
            {dims.width}×{dims.height} · crop region {cropPx}px
            {cropPx < MOCKUP_CROP_MIN ? ` — under ${MOCKUP_CROP_MIN}: fine for geometry, weak as a variant` : ""}
          </span>
        ) : null}
      </div>

      {samplePreview && dims && phase === "crop" ? (
        <div className="field">
          <label className="kicker">CROP — SQUARE, SHARED BY EVERY FUTURE VARIANT</label>
          <QuadEditor
            src={samplePreview}
            quad={rectToQuad(rect, dims)}
            onChange={(q) => setRect(quadToRect(q, dims))}
            squareOnly
            centerGuides
          />
          <div className="row-gap-12" style={{ marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={confirmCrop} disabled={busy}>
              <Spinner active={busy} />
              Confirm crop → place print region
            </button>
          </div>
        </div>
      ) : null}

      {phase === "region" && croppedPreview ? (
        <div className="field">
          <label className="kicker">PRINT REGION — WHERE ARTWORK LANDS ON THE GARMENT</label>
          {/* same centre guides as the crop step — placing a print region
              off-centre by a few pixels is exactly as easy to do by eye */}
          <QuadEditor src={croppedPreview} quad={regionQuad} onChange={setRegionQuad} centerGuides />
          <span className="hint">
            Drawn on the cropped frame, so every variant inherits it exactly. Unlock the corners for
            folded or on-model shots — the zone is a quad, not just a rectangle, on purpose.
          </span>
          <div className="row-gap-12" style={{ marginTop: 8 }}>
            <button className="btn btn-tertiary" onClick={() => setPhase("crop")} disabled={busy}>
              ← Back to crop
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="callout blocked">{error}</div> : null}
      <div className="row-gap-12">
        <button className="btn btn-save" onClick={save} disabled={busy || Boolean(blocked)} title={blocked ?? undefined}>
          <Spinner active={busy} />
          Save template
        </button>
        <button className="btn btn-tertiary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {blocked && !busy ? <span className="hint">{blocked}</span> : null}
      </div>
    </div>
  );
}

/** Mirror of the server job record — what the poll returns. */
interface ImportJobView {
  status: "running" | "complete" | "interrupted";
  total: number;
  done: number;
  imported: number;
  results: Array<{ name: string; detail: string; ok: boolean }>;
}

/**
 * The Drive auto-import: list the template's folder, detect colours from
 * filenames, review, then hand the batch to a SERVER-SIDE job — fetch,
 * crop (sharp, same adaptive rules) and save all happen off the page, so
 * navigating away or closing the tab can't kill a run half-done. This
 * panel only starts the job and polls its progress; reopening it later
 * picks the same job back up.
 *
 * Google's Testing mode expires the connection weekly; every failure that
 * means "reconnect" is surfaced as exactly that, never a dead retry.
 */
function DriveImport({
  template,
  palette,
  drive,
}: {
  template: MockupShotOption;
  palette: string[];
  drive: DriveStatus;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<ClassifiedFile[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"list" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [job, setJob] = useState<ImportJobView | null>(null);
  const [subfolders, setSubfolders] = useState<Array<{ id: string; name: string }>>([]);

  // a job may already be running (or finished while this panel was closed)
  // — pick it up instead of pretending nothing happened
  useEffect(() => {
    let cancelled = false;
    apiCall<{ job?: ImportJobView | null }>(`/api/drive/import?shotId=${template.id}`).then((res) => {
      if (!cancelled && res.ok && res.data.job) setJob(res.data.job);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  // poll while running; on the flip to complete/interrupted, refresh so
  // existing-colour chips and the template card catch up
  useEffect(() => {
    if (job?.status !== "running") return;
    const timer = setInterval(async () => {
      const res = await apiCall<{ job?: ImportJobView | null }>(`/api/drive/import?shotId=${template.id}`);
      if (res.ok && res.data.job) {
        setJob(res.data.job);
        if (res.data.job.status !== "running") router.refresh();
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, template.id]);
  // hand corrections to the detected colour, by file id. Detection reads a
  // closed palette out of arbitrary supplier filenames, so it will be wrong
  // sometimes; the fix belongs on the row, not in an untick-and-redo cycle.
  const [override, setOverride] = useState<Record<string, string>>({});

  const have = new Set(template.existingColours.map((c) => c.toLowerCase()));
  const activeRect = template.cropRect;
  const detectedOf = (f: ClassifiedFile): string | null =>
    f.role.kind === "variant" ? f.role.colour : null;
  const colourOf = (f: ClassifiedFile): string | null => {
    const edited = override[f.id];
    if (edited !== undefined) return edited.trim() || null;
    return detectedOf(f);
  };

  async function list() {
    setBusy("list");
    setError(null);
    const res = await apiJson<{
      files?: Array<{ id: string; name: string }>;
      subfolders?: Array<{ id: string; name: string }>;
      needsReconnect?: boolean;
    }>(`/api/drive/folder?link=${encodeURIComponent(template.driveFolderLink)}`, "GET", undefined);
    if (!res.ok) {
      setError(res.error);
      if (res.data?.needsReconnect) setNeedsReconnect(true);
    } else {
      const classified = classifyFolder(res.data.files ?? [], palette);
      setFiles(classified);
      setSubfolders(res.data.subfolders ?? []);
      setOverride({});
      // everything with a fresh colour starts ticked; already-added
      // colours start unticked so a re-run doesn't duplicate them
      setPicked(
        new Set(
          classified
            .filter((f) => {
              const c = colourOf(f);
              return c !== null && !have.has(c.toLowerCase());
            })
            .map((f) => f.id)
        )
      );
    }
    setBusy(null);
  }

  async function importPicked() {
    if (!files || !activeRect) return;
    setBusy("import");
    setError(null);
    // effective colour, so a row corrected by hand imports like any other
    const targets = files
      .filter((f) => colourOf(f) !== null && picked.has(f.id))
      .map((f) => ({ id: f.id, name: f.name, colour: colourOf(f)! }));
    const res = await apiJson<{ job?: ImportJobView }>("/api/drive/import", "POST", {
      shotId: template.id,
      files: targets,
    });
    if (!res.ok) setError(res.error);
    else if (res.data.job) setJob(res.data.job); // polling takes it from here
    setBusy(null);
  }

  const importable = files?.filter((f) => colourOf(f) !== null) ?? [];

  return (
    <div className="well stack-12" style={{ gap: 8 }}>
      <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <Kicker>GOOGLE DRIVE — AUTO-IMPORT</Kicker>
        <span className="hint" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {template.driveFolderLink}
        </span>
      </div>

      {!drive.configured ? (
        <span className="hint">Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable the auto-import.</span>
      ) : needsReconnect || !drive.connected ? (
        <div className="row-gap-12" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <a className="btn btn-secondary" href="/api/drive/oauth/start">
            Connect Google Drive
          </a>
          <span className="hint">
            Read-only. Google&apos;s testing mode expires the connection roughly weekly — reconnecting
            here is the expected fix, not a fault.
          </span>
        </div>
      ) : (
        <>
          {!files ? (
            <div className="row-gap-12" style={{ alignItems: "center" }}>
              <button className="btn btn-secondary" onClick={list} disabled={busy !== null}>
                <Spinner active={busy === "list"} />
                List the folder
              </button>
              <span className="hint">Colours are detected from filenames — you review before anything imports.</span>
            </div>
          ) : (
            <>
              <div className="stack-12" style={{ gap: 4 }}>
                {files.map((f) => {
                  const colour = colourOf(f);
                  const already = colour ? have.has(colour.toLowerCase()) : false;
                  const detected = detectedOf(f);
                  return (
                    <div key={f.id} className="row-gap-8" style={{ alignItems: "center" }}>
                      <input
                        type="checkbox"
                        aria-label={`Import ${f.name}`}
                        checked={picked.has(f.id)}
                        disabled={busy !== null || !colour}
                        onChange={(e) =>
                          setPicked((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(f.id);
                            else next.delete(f.id);
                            return next;
                          })
                        }
                      />
                      <span
                        className={colour ? "body-sm" : "hint"}
                        style={{ flex: "1 1 180px", overflow: "hidden", textOverflow: "ellipsis" }}
                        title={f.name}
                      >
                        {f.name}
                      </span>
                      <input
                        className="input"
                        style={{ flex: "0 0 140px", fontSize: 12, padding: "4px 8px" }}
                        aria-label={`Colour for ${f.name}`}
                        placeholder={f.role.kind === "info-graphic" ? "not a colour" : "no colour matched"}
                        value={override[f.id] ?? detected ?? ""}
                        disabled={busy !== null}
                        onChange={(e) => {
                          const value = e.target.value;
                          setOverride((cur) => ({ ...cur, [f.id]: value }));
                          // typing a colour onto an unmatched row is the
                          // point — tick it so the correction isn't lost to
                          // a second click
                          setPicked((cur) => {
                            const next = new Set(cur);
                            if (value.trim()) next.add(f.id);
                            else next.delete(f.id);
                            return next;
                          });
                        }}
                      />
                      {already ? (
                        <span className="chip neutral" style={{ fontSize: 10 }} title="A variant in this colour already exists on this template">
                          already added
                        </span>
                      ) : f.role.kind === "info-graphic" ? (
                        <span className="chip stale" style={{ fontSize: 10 }}>
                          info graphic — Product&apos;s {f.role.role} link
                        </span>
                      ) : null}
                    </div>
                  );
                })}
                {files.length === 0 && subfolders.length > 0 ? (
                  <div className="callout blocked">
                    This folder holds {subfolders.length} subfolder{subfolders.length === 1 ? "" : "s"}, not
                    images — link one of them instead: {subfolders.map((s) => s.name).join(", ")}
                  </div>
                ) : files.length === 0 ? (
                  <span className="hint">This folder has no image files in it at all.</span>
                ) : importable.length === 0 ? (
                  <span className="hint">
                    No filename matched a palette colour. Type the colour on any row to import it anyway.
                  </span>
                ) : null}
              </div>
              <div className="row-gap-12" style={{ alignItems: "center", flexWrap: "wrap" }}>
                <button
                  className="btn btn-primary"
                  onClick={importPicked}
                  disabled={busy !== null || job?.status === "running" || picked.size === 0 || !activeRect}
                  title={!activeRect ? "This template has no saved geometry" : undefined}
                >
                  <Spinner active={busy === "import"} />
                  Import {picked.size} colour{picked.size === 1 ? "" : "s"} from Drive
                </button>
                <button className="btn btn-tertiary" onClick={list} disabled={busy !== null || job?.status === "running"}>
                  Re-list
                </button>
              </div>
            </>
          )}
          {job ? (
            <div className="stack-12" style={{ gap: 4 }}>
              {job.status === "running" ? (
                <span className="body-sm">
                  <Spinner active /> Importing on the server — {job.done}/{job.total} done. Safe to
                  navigate away or close the tab; progress lands on this template either way.
                </span>
              ) : job.status === "interrupted" ? (
                <div className="callout blocked">
                  Import interrupted at {job.done}/{job.total} ({job.imported} saved). Re-list the
                  folder — already-imported colours start unticked, so re-running only picks up the gaps.
                </div>
              ) : (
                <span className="body-sm">
                  ✓ Import complete — {job.imported} of {job.total} saved.
                </span>
              )}
              <div className="stack-12" style={{ gap: 2 }}>
                {job.results.map((r) => (
                  <span key={r.name + r.detail} className="hint" style={{ color: r.ok ? undefined : "var(--status-blocked, #b3423a)" }}>
                    {r.ok ? "✓" : "✕"} {r.name} — {r.detail}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {error ? <div className="callout blocked">{error}</div> : null}
        </>
      )}
    </div>
  );
}

/**
 * Step 2: add colour variants to an EXISTING template. Geometry is
 * inherited — the crop and print region were decided once at definition —
 * so this form is photos and colour names, nothing else. Colour is read
 * from each filename against the shop's own palette (the same detector
 * the Drive auto-import uses), and stays editable for the odd file that
 * defeats it. Manual drop is the fallback path; the Drive listing lands
 * once Google OAuth is configured.
 */
function AddVariants({
  shots,
  palette,
  drive,
  onClose,
}: {
  shots: MockupShotOption[];
  palette: string[];
  drive: DriveStatus;
  onClose: () => void;
}) {
  const router = useRouter();
  const [shotChoice, setShotChoice] = useState<string>(shots.find((s) => s.cropRect)?.id ?? "");
  const [rows, setRows] = useState<ShotColorRow[]>([
    { key: 0, file: null, color: "", dims: null },
    { key: 1, file: null, color: "", dims: null },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(2);

  const template = shots.find((s) => s.id === shotChoice) ?? null;
  const activeRect = template?.cropRect ?? null;

  async function setFile(key: number, file: File | null) {
    const dims = file ? await nativeDimensions(file) : null;
    // filename → colour, against the shop's own closed palette. Prefill
    // only — never overwrite something already typed.
    const guess = file ? detectColour(file.name, palette) : null;
    setRows((cur) =>
      cur.map((r) =>
        r.key === key ? { ...r, file, dims, color: r.color.trim() ? r.color : (guess ?? r.color) } : r
      )
    );
  }

  function setColor(key: number, color: string) {
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, color } : r)));
  }

  function addRow() {
    setRows((cur) => [...cur, { key: nextKey.current++, file: null, color: "", dims: null }]);
  }

  function removeRow(key: number) {
    setRows((cur) => (cur.length > 1 ? cur.filter((r) => r.key !== key) : cur));
  }

  const activeRows = rows.filter((r) => r.file);
  /** each row's own output side — adaptive, so one weak photo can't cap the rest */
  const outputSizeOf = (r: ShotColorRow): number | null =>
    r.dims && activeRect
      ? cropOutputSize(r.dims.width, r.dims.height, activeRect, MOCKUP_CROP_MIN, MOCKUP_CROP_SIZE)
      : null;
  const infeasible = activeRows.filter((r) => r.dims && activeRect && outputSizeOf(r) === null);
  const blocked = !template
    ? shots.length === 0
      ? "No templates yet — define one first with ＋ New template."
      : "Pick a template."
    : !activeRect
      ? "This template has no saved geometry — recreate it with ＋ New template."
      : activeRows.length === 0
        ? "Add at least one colour photo."
        : activeRows.some((r) => !r.color.trim())
          ? "Every photo needs its garment colour."
          : infeasible.length > 0
            ? `${infeasible.length} photo${infeasible.length === 1 ? "" : "s"} can't reach ${MOCKUP_CROP_MIN}×${MOCKUP_CROP_MIN} at this template's framing — use a bigger source file or redefine the template.`
            : null;

  async function apply() {
    if (!template || !activeRect) return;
    setBusy(true);
    setError(null);
    try {
      for (const row of activeRows) {
        if (!row.file) continue;
        const target = outputSizeOf(row) ?? MOCKUP_CROP_MIN;
        const { file: cropped, size } = await cropToStandardSize(row.file, activeRect, target);
        const form = new FormData();
        // {template} - {colour} - {px}: px is the ACTUAL adaptive output —
        // a tier label like "4K" on a 2513px file would be a lie
        form.append("name", `${template.name} - ${row.color.trim()} - ${size}`);
        form.append("pipelineType", "Simple Placement");
        form.append("blendMode", DEFAULT_BLEND);
        form.append("fitMode", DEFAULT_FIT);
        form.append("garmentColor", row.color.trim());
        form.append("shotId", template.id);
        // the print region decided at definition — no placeholder quad,
        // no mandatory per-variant "Re-place corners" afterwards
        form.append("quad", JSON.stringify(template.printRegionQuad ?? DEFAULT_QUAD));
        form.append("baseImage", cropped);
        const res = await apiCall("/api/mockup-templates", { method: "POST", body: form });
        if (!res.ok) throw new Error(res.error ?? "Upload failed.");
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="card supporting stack-12">
      <Kicker>STEP 2 · ADD COLOUR VARIANTS — GEOMETRY INHERITED FROM THE TEMPLATE</Kicker>
      <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label className="kicker" htmlFor="av-shot">TEMPLATE</label>
          <select
            id="av-shot"
            className="select"
            value={shotChoice}
            onChange={(e) => setShotChoice(e.target.value)}
          >
            <option value="">Pick a template…</option>
            {shots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.cropRect ? "" : " · no geometry"}
              </option>
            ))}
          </select>
        </div>
        {template && !template.driveFolderLink ? (
          <span className="hint" style={{ alignSelf: "center" }}>
            No Drive folder on this template — auto-import needs one, set at definition. Manual drop
            below still works.
          </span>
        ) : null}
      </div>

      {template?.driveFolderLink ? (
        <DriveImport template={template} palette={palette} drive={drive} />
      ) : null}

      <Kicker>OR DROP FILES MANUALLY</Kicker>
      <div className="stack-12">
        {rows.map((row, i) => (
          <div key={row.key} className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <FileSlot label={`COLOUR ${i + 1} PHOTO`} file={row.file} onFile={(f) => setFile(row.key, f)} />
            <div className="field" style={{ flex: "1 1 140px" }}>
              <label className="kicker">GARMENT COLOR</label>
              <input
                className="input"
                placeholder="e.g. Pepper"
                value={row.color}
                onChange={(e) => setColor(row.key, e.target.value)}
              />
            </div>
            {row.dims && activeRect ? (
              (() => {
                const out = outputSizeOf(row);
                return (
                  <span className={`chip ${out === null ? "blocked" : "done"}`} style={{ fontSize: 11 }}>
                    {row.dims.width}×{row.dims.height}
                    {out === null
                      ? ` — crop yields ${cropSquarePixels(row.dims.width, row.dims.height, activeRect)}px, under ${MOCKUP_CROP_MIN}`
                      : ` → ${out}×${out}`}
                  </span>
                );
              })()
            ) : null}
            {rows.length > 1 ? (
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 11, padding: "3px 7px" }}
                onClick={() => removeRow(row.key)}
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
        <button
          className="btn btn-tertiary"
          style={{ fontSize: 12, padding: "5px 10px", alignSelf: "flex-start" }}
          onClick={addRow}
        >
          + another colour
        </button>
      </div>
      <span className="hint">
        Colour is read from each filename against your product palette — prefilled, never final;
        check the field.
      </span>

      {error ? <div className="callout blocked">{error}</div> : null}
      <div className="row-gap-12">
        <button className="btn btn-primary" onClick={apply} disabled={busy || Boolean(blocked)} title={blocked ?? undefined}>
          <Spinner active={busy} />
          Crop &amp; save {activeRows.length || ""} colour{activeRows.length === 1 ? "" : "s"}
        </button>
        <button className="btn btn-tertiary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {blocked && !busy ? <span className="hint">{blocked}</span> : null}
      </div>
    </div>
  );
}

export function MockupTemplatesSection({
  templates,
  shots,
  palette,
  drive,
  products,
  duplicateVariants = 0,
}: {
  templates: MockupTemplateCard[];
  shots: MockupShotOption[];
  palette: string[];
  drive: DriveStatus;
  products: ProductOption[];
  /** exact-name variant twins — non-zero renders the one-click cleanup */
  duplicateVariants?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [driveNotice, setDriveNotice] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  // the OAuth callback lands back here with ?drive_connected= or
  // ?drive_error= — show it once, then strip it so a reload doesn't repeat
  useEffect(() => {
    const connected = searchParams.get("drive_connected");
    const err = searchParams.get("drive_error");
    if (!connected && !err) return;
    if (connected) setDriveNotice("Google Drive connected — templates with a folder link can auto-import now.");
    if (err) setDriveError(`Google Drive: ${err}`);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("drive_connected");
    params.delete("drive_error");
    router.replace(params.toString() ? `${pathname}?${params}` : pathname, { scroll: false });
    // one-time on arrival only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Exactly one form at a time — two of these open side by side, sharing
  // the page, was the overlapping-forms mess the two-phase flow retires.
  // A closed form unmounts entirely, so half-typed state can never leak
  // into the next open.
  const [openForm, setOpenForm] = useState<null | "define" | "variants" | "single">(null);
  const toggle = (k: "define" | "variants" | "single") =>
    setOpenForm((cur) => (cur === k ? null : k));
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // One-time bridge for templates saved before thumbnails existed: rebuild
  // the sample from the Drive folder + stored crop (Pepper-first picking).
  // With thumbnails missing it backfills the gaps; with none missing it
  // offers a re-pick over everything — the correction path for the first
  // run's wrong picks. Goes dormant by disinterest, not by vanishing.
  const missingThumbs = shots.filter((s) => !s.thumbUrl).length;
  const [deduping, setDeduping] = useState(false);
  const [dedupeReport, setDedupeReport] = useState<string | null>(null);
  async function dedupeVariants() {
    if (!window.confirm(`Remove ${duplicateVariants} duplicate variant${duplicateVariants === 1 ? "" : "s"}? One record of each name is kept; the extras are archived in Notion (recoverable from its trash).`)) {
      return;
    }
    setDeduping(true);
    setDriveError(null);
    const res = await apiJson<{ removed?: number; names?: string[] }>("/api/mockup-templates/dedupe", "POST", {}, 120_000);
    if (!res.ok) setDriveError(res.error);
    else {
      setDedupeReport(
        res.data.removed
          ? `Archived ${res.data.removed} duplicate${res.data.removed === 1 ? "" : "s"}: ${(res.data.names ?? []).join(", ")}`
          : "No duplicates found."
      );
      router.refresh();
    }
    setDeduping(false);
  }
  const [backfilling, setBackfilling] = useState(false);
  const [backfillReport, setBackfillReport] = useState<Array<{ name: string; ok: boolean; detail: string }> | null>(null);
  async function backfillThumbs(overwrite: boolean) {
    setBackfilling(true);
    setDriveError(null);
    const res = await apiJson<{ results?: Array<{ name: string; ok: boolean; detail: string }>; needsReconnect?: boolean }>(
      "/api/mockup-shots/backfill-thumbs",
      "POST",
      { overwrite },
      300_000 // several downloads + uploads — well past the default feel of "hung"
    );
    if (!res.ok) setDriveError(res.error);
    else {
      setBackfillReport(res.data.results ?? []);
      router.refresh();
    }
    setBackfilling(false);
  }

  return (
    <section className="stack-12">
      <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <Kicker>MOCKUP TEMPLATES · {shots.length}</Kicker>
        <div className="row-gap-12">
          <button className="btn btn-secondary" onClick={() => toggle("define")} aria-expanded={openForm === "define"}>
            ＋ New template
          </button>
          <button className="btn btn-secondary" onClick={() => toggle("variants")} aria-expanded={openForm === "variants"}>
            ＋ Add colour variants
          </button>
          <button className="btn btn-tertiary" onClick={() => toggle("single")} aria-expanded={openForm === "single"}>
            ＋ Single variant (advanced)
          </button>
        </div>
      </div>
      {openForm === "define" ? (
        <TemplateDefine
          products={products}
          onSaved={(saved) => {
            setSavedNotice(`Template "${saved}" saved — add its colours with ＋ Add colour variants.`);
            setOpenForm(null);
          }}
          onClose={() => setOpenForm(null)}
        />
      ) : null}
      {savedNotice ? <div className="callout">{savedNotice}</div> : null}
      {driveNotice ? <span className="hint">{driveNotice}</span> : null}
      {driveError ? <div className="callout blocked">{driveError}</div> : null}
      {duplicateVariants > 0 ? (
        <div className="row-gap-12" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={dedupeVariants} disabled={deduping}>
            <Spinner active={deduping} />
            Remove {duplicateVariants} duplicate {duplicateVariants === 1 ? "variant" : "variants"}
          </button>
          <span className="hint">
            Exact-name twins from a double import — one of each is kept, the extras are archived in
            Notion (recoverable from its trash).
          </span>
        </div>
      ) : null}
      {dedupeReport ? <span className="hint">{dedupeReport}</span> : null}
      {shots.length > 0 && drive.configured && drive.connected ? (
        <div className="row-gap-12" style={{ alignItems: "center", flexWrap: "wrap" }}>
          {missingThumbs > 0 ? (
            <button className="btn btn-tertiary" onClick={() => backfillThumbs(false)} disabled={backfilling}>
              <Spinner active={backfilling} />
              Backfill {missingThumbs} missing {missingThumbs === 1 ? "thumbnail" : "thumbnails"} from Drive
            </button>
          ) : (
            <button className="btn btn-tertiary" onClick={() => backfillThumbs(true)} disabled={backfilling}>
              <Spinner active={backfilling} />
              Re-pick all template thumbnails from Drive
            </button>
          )}
          <span className="hint">
            Prefers the Pepper shot (then any garment colour); info graphics are never picked.
            Templates without a folder link or crop keep what they have.
          </span>
        </div>
      ) : null}
      {backfillReport ? (
        <div className="stack-12" style={{ gap: 2 }}>
          {backfillReport.length === 0 ? <span className="hint">Nothing to backfill.</span> : null}
          {backfillReport.map((r) => (
            <span key={r.name + r.detail} className="hint" style={{ color: r.ok ? undefined : "var(--status-blocked, #b3423a)" }}>
              {r.ok ? "✓" : "✕"} {r.name} — {r.detail}
            </span>
          ))}
        </div>
      ) : null}
      {openForm === "variants" ? (
        <AddVariants shots={shots} palette={palette} drive={drive} onClose={() => setOpenForm(null)} />
      ) : null}
      {openForm === "single" ? <MockupTemplateIntake onClose={() => setOpenForm(null)} /> : null}
      <div className="inbox-grid">
        {shots.map((s) => (
          <TemplateRow
            key={s.id}
            s={s}
            driveConnected={drive.connected}
            variants={templates.filter((t) => t.shotId === s.id)}
            products={products}
          />
        ))}
        {shots.length === 0 ? (
          <div className="hint">No templates yet — ＋ New template defines the crop and print region once.</div>
        ) : null}
      </div>

      {/* variants live under their template now — this section exists only
          for strays with no template (single-variant advanced intakes) */}
      {(() => {
        const ungrouped = templates.filter((t) => !t.shotId);
        return ungrouped.length > 0 ? (
          <>
            <Kicker>UNGROUPED VARIANTS · {ungrouped.length}</Kicker>
            <div className="inbox-grid">
              {ungrouped.map((t) => (
                <TemplateCard key={t.id} t={t} />
              ))}
            </div>
          </>
        ) : null;
      })()}
    </section>
  );
}
