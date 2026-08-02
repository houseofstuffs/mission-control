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
import { useRouter } from "next/navigation";
import { Kicker, Spinner } from "./ui";
import { apiCall, apiJson } from "@/lib/api";
import { downscaleImage } from "@/lib/downscale";
import { nativeDimensions, cropFeasible, cropToStandardSize, type CropRect } from "@/lib/mockupCrop";
import {
  PIPELINE_TYPES,
  BLEND_MODES,
  FIT_MODES,
  DEFAULT_BLEND,
  DEFAULT_FIT,
  DEFAULT_QUAD,
  MOCKUP_CROP_SIZE,
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
}

/* ---------- corner placement ---------- */

const MIN_SIDE = 0.04; // a quad can't collapse smaller than 4% of the image

function isRectangle(q: Quad): boolean {
  const e = 0.002;
  return (
    Math.abs(q[0].y - q[1].y) < e &&
    Math.abs(q[3].y - q[2].y) < e &&
    Math.abs(q[0].x - q[3].x) < e &&
    Math.abs(q[1].x - q[2].x) < e
  );
}

function rectQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/**
 * The print-area editor, two modes:
 *
 * LOCKED (default) — the area is a rectangle. Drag inside to move it; pull a
 * corner to resize, and both dimensions scale together so the shape's ratio
 * never drifts mid-adjustment. Between that and the renderer's contain-fit
 * (artwork keeps its own proportions inside the area), artwork can't be
 * squashed by an editing slip.
 *
 * FREE — each corner independent, for genuinely angled shots. A saved quad
 * that isn't a rectangle opens here.
 *
 * Coordinates normalized 0–1 so the quad survives every resize between
 * preview and render.
 */
function QuadEditor({
  src,
  quad,
  onChange,
  squareOnly = false,
}: {
  src: string;
  quad: Quad;
  onChange: (q: Quad) => void;
  /** hides the unlock-corners toggle — the resize math already preserves whatever ratio a quad starts with, so a square-initialized quad stays square through every drag as long as it's never unlocked */
  squareOnly?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(() => squareOnly || isRectangle(quad));
  // drag session — captured at pointerdown so mid-drag math has a stable base
  const session = useRef<
    | { kind: "corner"; index: number }
    | { kind: "resize"; anchor: { x: number; y: number }; sx: 1 | -1; sy: 1 | -1; w0: number; h0: number }
    | { kind: "move"; offX: number; offY: number; w: number; h: number }
    | null
  >(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    function move(e: PointerEvent) {
      const box = boxRef.current?.getBoundingClientRect();
      const s = session.current;
      if (!box || !s) return;
      const px = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
      const py = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));

      if (s.kind === "corner") {
        onChange(quad.map((p, i) => (i === s.index ? { x: px, y: py } : p)) as Quad);
        return;
      }
      if (s.kind === "move") {
        const x = Math.min(1 - s.w, Math.max(0, px - s.offX));
        const y = Math.min(1 - s.h, Math.max(0, py - s.offY));
        onChange(rectQuad(x, y, s.w, s.h));
        return;
      }
      // resize: uniform scale about the opposite corner — ratio can't drift
      const roomX = s.sx > 0 ? 1 - s.anchor.x : s.anchor.x;
      const roomY = s.sy > 0 ? 1 - s.anchor.y : s.anchor.y;
      const sMax = Math.min(roomX / s.w0, roomY / s.h0);
      const sMin = MIN_SIDE / Math.min(s.w0, s.h0);
      const dx = Math.max(0, (px - s.anchor.x) * s.sx) / s.w0;
      const dy = Math.max(0, (py - s.anchor.y) * s.sy) / s.h0;
      const k = Math.min(sMax, Math.max(sMin, Math.max(dx, dy)));
      const w = s.w0 * k;
      const h = s.h0 * k;
      onChange(
        rectQuad(s.sx > 0 ? s.anchor.x : s.anchor.x - w, s.sy > 0 ? s.anchor.y : s.anchor.y - h, w, h)
      );
    }
    const stop = () => {
      session.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [dragging, quad, onChange]);

  function startCorner(index: number) {
    if (!locked) {
      session.current = { kind: "corner", index };
    } else {
      const anchor = quad[(index + 2) % 4];
      const corner = quad[index];
      session.current = {
        kind: "resize",
        anchor: { ...anchor },
        sx: corner.x >= anchor.x ? 1 : -1,
        sy: corner.y >= anchor.y ? 1 : -1,
        w0: Math.max(MIN_SIDE, Math.abs(corner.x - anchor.x)),
        h0: Math.max(MIN_SIDE, Math.abs(corner.y - anchor.y)),
      };
    }
    setDragging(true);
  }

  function startMove(e: React.PointerEvent) {
    if (!locked) return;
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = (e.clientX - box.left) / box.width;
    const py = (e.clientY - box.top) / box.height;
    const x = Math.min(...quad.map((p) => p.x));
    const y = Math.min(...quad.map((p) => p.y));
    session.current = {
      kind: "move",
      offX: px - x,
      offY: py - y,
      w: Math.max(...quad.map((p) => p.x)) - x,
      h: Math.max(...quad.map((p) => p.y)) - y,
    };
    setDragging(true);
  }

  function toggleMode() {
    if (locked) {
      setLocked(false);
      return;
    }
    // locking a skewed quad squares it up to its bounding box — visible,
    // deliberate, and exactly what "stop letting me skew this" means
    const x = Math.min(...quad.map((p) => p.x));
    const y = Math.min(...quad.map((p) => p.y));
    onChange(rectQuad(x, y, Math.max(...quad.map((p) => p.x)) - x, Math.max(...quad.map((p) => p.y)) - y));
    setLocked(true);
  }

  const LABELS = ["TL", "TR", "BR", "BL"];
  return (
    <div className="stack-12">
      <div ref={boxRef} style={{ position: "relative", userSelect: "none", touchAction: "none" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" style={{ width: "100%", display: "block", borderRadius: 10 }} draggable={false} />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          <polygon
            points={quad.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
            fill="rgba(31,72,151,0.14)"
            stroke="var(--blueberry, #1f4897)"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* the move surface — the rectangle's own interior */}
        {locked ? (
          <div
            onPointerDown={startMove}
            style={{
              position: "absolute",
              left: `${Math.min(...quad.map((p) => p.x)) * 100}%`,
              top: `${Math.min(...quad.map((p) => p.y)) * 100}%`,
              width: `${(Math.max(...quad.map((p) => p.x)) - Math.min(...quad.map((p) => p.x))) * 100}%`,
              height: `${(Math.max(...quad.map((p) => p.y)) - Math.min(...quad.map((p) => p.y))) * 100}%`,
              cursor: "move",
            }}
          />
        ) : null}
        {quad.map((p, i) => (
          <button
            key={i}
            aria-label={locked ? `Resize from ${LABELS[i]}` : `Corner ${LABELS[i]}`}
            onPointerDown={(e) => {
              e.preventDefault();
              startCorner(i);
            }}
            style={{
              position: "absolute",
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              transform: "translate(-50%, -50%)",
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: "2px solid #fff",
              background: "var(--blueberry, #1f4897)",
              color: "#fff",
              fontSize: 8,
              fontWeight: 700,
              cursor: locked ? "nwse-resize" : "grab",
              padding: 0,
            }}
          >
            {LABELS[i]}
          </button>
        ))}
      </div>
      <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <span className="hint" style={{ flex: 1 }}>
          {squareOnly
            ? "Drag inside to position · pull a corner to resize — stays square."
            : locked
              ? "Drag inside to position · pull a corner to resize (ratio stays put)."
              : "Each corner moves free — for angled shots. TL, TR, BR, BL."}
        </span>
        {squareOnly ? null : (
          <button type="button" className="chip count" style={{ cursor: "pointer", border: "none" }} onClick={toggleMode}>
            {locked ? "unlock corners" : "lock ratio"}
          </button>
        )}
      </div>
    </div>
  );
}

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

export function MockupTemplateIntake() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    ? "Name the template."
    : !pipeline
      ? "Pick a pipeline type — it decides the rest of the form."
      : !base
        ? "Every template needs a base image."
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
        ＋ New mockup template
      </button>
    );
  }

  return (
    <div className="card supporting stack-12">
      <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
        <div className="field" style={{ flex: "2 1 220px" }}>
          <label className="kicker" htmlFor="mt-name">TEMPLATE NAME</label>
          <input id="mt-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field" style={{ flex: "2 1 220px" }}>
          <label className="kicker" htmlFor="mt-src">SOURCE LINK</label>
          <input id="mt-src" className="input" placeholder="https://… (Drive, marketplace)" value={sourceLink} onChange={(e) => setSourceLink(e.target.value)} />
        </div>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label className="kicker" htmlFor="mt-pipe">PIPELINE — CHOOSE FIRST</label>
          <select id="mt-pipe" className="select" value={pipeline} onChange={(e) => setPipeline(e.target.value)}>
            <option value="">What kind of template is this?</option>
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
        {t.shotName ? <span className="chip neutral" title="Base Image is a standardized crop from this shot">{t.shotName}</span> : null}
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
          {t.sourceLink ? (
            <a className="body-sm" href={t.sourceLink} target="_blank" rel="noreferrer">source ↗</a>
          ) : null}
        </div>
      )}

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
}

function rectToQuad(r: CropRect): Quad {
  return rectQuad(r.x, r.y, r.size, r.size);
}

function quadToRect(q: Quad): CropRect {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  // squareOnly guarantees width === height, but average defensively in case
  // a stale non-square quad ever gets passed in
  const size = (Math.max(...xs) - x + (Math.max(...ys) - y)) / 2;
  return { x, y, size };
}

interface ShotColorRow {
  key: number;
  file: File | null;
  color: string;
  dims: { width: number; height: number } | null;
}

/**
 * Batch intake for one photo shoot's colour variants — draw the crop
 * rectangle ONCE against the reference photo (or reuse an existing shot's
 * saved one), and it applies to every colour uploaded here and every one
 * added to this shot later. Scoped to Simple Placement: each resulting
 * template still gets its own "Re-place corners" pass afterward, same as
 * any Simple Placement template — the crop decides framing, not print area.
 */
function MockupShotIntake({ shots }: { shots: MockupShotOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shotChoice, setShotChoice] = useState<string>(""); // "" = new shot
  const [newShotName, setNewShotName] = useState("");
  const [rect, setRect] = useState<CropRect>(DEFAULT_CROP_RECT);
  const [rows, setRows] = useState<ShotColorRow[]>([
    { key: 0, file: null, color: "", dims: null },
    { key: 1, file: null, color: "", dims: null },
  ]);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(2);

  const existingShot = shots.find((s) => s.id === shotChoice) ?? null;
  const savedRect = existingShot?.cropRect ?? null;
  const activeRect = savedRect ?? rect;
  const drawingNew = !savedRect;

  useEffect(() => {
    const first = rows.find((r) => r.file)?.file ?? null;
    if (!first) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(first);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => r.file).join()]);

  async function setFile(key: number, file: File | null) {
    const dims = file ? await nativeDimensions(file) : null;
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, file, dims } : r)));
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
  const infeasible = activeRows.filter(
    (r) => r.dims && !cropFeasible(r.dims.width, r.dims.height, activeRect, MOCKUP_CROP_SIZE)
  );
  const shotName = existingShot?.name ?? newShotName.trim();
  const blocked = !shotName
    ? "Name the shot (or pick an existing one)."
    : activeRows.length === 0
      ? "Add at least one colour photo."
      : activeRows.some((r) => !r.color.trim())
        ? "Every photo needs its garment colour."
        : infeasible.length > 0
          ? `${infeasible.length} photo${infeasible.length === 1 ? "" : "s"} can't produce a sharp ${MOCKUP_CROP_SIZE}×${MOCKUP_CROP_SIZE} crop at this framing — shrink the rectangle or drop them.`
          : null;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      let shotId = existingShot?.id ?? null;
      if (!shotId) {
        const res = await apiJson<{ record?: { id: string } }>("/api/mockup-shots", "POST", { name: shotName });
        if (!res.ok || !res.data.record) throw new Error(res.error ?? "Couldn't create the shot.");
        shotId = res.data.record.id;
      }
      for (const row of activeRows) {
        if (!row.file) continue;
        const cropped = await cropToStandardSize(row.file, activeRect, MOCKUP_CROP_SIZE);
        const form = new FormData();
        form.append("name", `${shotName} — ${row.color.trim()}`);
        form.append("pipelineType", "Simple Placement");
        form.append("blendMode", DEFAULT_BLEND);
        form.append("fitMode", DEFAULT_FIT);
        form.append("garmentColor", row.color.trim());
        form.append("shotId", shotId);
        form.append("quad", JSON.stringify(DEFAULT_QUAD));
        form.append("baseImage", cropped);
        const res = await apiCall("/api/mockup-templates", { method: "POST", body: form });
        if (!res.ok) throw new Error(res.error ?? "Upload failed.");
      }
      if (drawingNew) {
        const res = await apiJson(`/api/mockup-shots/${shotId}`, "PATCH", { cropRect: activeRect });
        if (!res.ok) throw new Error(res.error ?? "Couldn't save the shot's crop.");
      }
      setOpen(false);
      setShotChoice("");
      setNewShotName("");
      setRect(DEFAULT_CROP_RECT);
      setRows([
        { key: 0, file: null, color: "", dims: null },
        { key: 1, file: null, color: "", dims: null },
      ]);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button className="btn btn-secondary" onClick={() => setOpen(true)}>
        ＋ New mockup shot (colour batch)
      </button>
    );
  }

  return (
    <div className="card supporting stack-12">
      <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label className="kicker" htmlFor="ms-shot">SHOT</label>
          <select
            id="ms-shot"
            className="select"
            value={shotChoice}
            onChange={(e) => setShotChoice(e.target.value)}
          >
            <option value="">＋ New shot…</option>
            {shots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.cropRect ? " · crop set" : ""}
              </option>
            ))}
          </select>
        </div>
        {!existingShot ? (
          <div className="field" style={{ flex: "2 1 220px" }}>
            <label className="kicker" htmlFor="ms-name">SHOT NAME</label>
            <input
              id="ms-name"
              className="input"
              placeholder="e.g. CC1466 Model 1"
              value={newShotName}
              onChange={(e) => setNewShotName(e.target.value)}
            />
          </div>
        ) : (
          <span className="hint" style={{ alignSelf: "center" }}>
            {savedRect
              ? "This shot already has a crop — new colours reuse it automatically."
              : "This shot has no crop yet — draw one below."}
          </span>
        )}
      </div>

      <div className="stack-12">
        {rows.map((row, i) => (
          <div key={row.key} className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <FileSlot
              label={`COLOUR ${i + 1} PHOTO`}
              file={row.file}
              onFile={(f) => setFile(row.key, f)}
            />
            <div className="field" style={{ flex: "1 1 140px" }}>
              <label className="kicker">GARMENT COLOR</label>
              <input
                className="input"
                placeholder="e.g. Pepper"
                value={row.color}
                onChange={(e) => setColor(row.key, e.target.value)}
              />
            </div>
            {row.dims ? (
              <span className={`chip ${infeasible.includes(row) ? "blocked" : "done"}`} style={{ fontSize: 11 }}>
                {row.dims.width}×{row.dims.height}
                {infeasible.includes(row) ? " — too small at this crop" : " ✓"}
              </span>
            ) : null}
            {rows.length > 1 ? (
              <button className="btn btn-tertiary" style={{ fontSize: 11, padding: "3px 7px" }} onClick={() => removeRow(row.key)}>
                ✕
              </button>
            ) : null}
          </div>
        ))}
        <button className="btn btn-tertiary" style={{ fontSize: 12, padding: "5px 10px", alignSelf: "flex-start" }} onClick={addRow}>
          + another colour
        </button>
      </div>

      {drawingNew && preview ? (
        <div className="field">
          <label className="kicker">CROP — SQUARE, APPLIES TO EVERY COLOUR ABOVE</label>
          <QuadEditor src={preview} quad={rectToQuad(rect)} onChange={(q) => setRect(quadToRect(q))} squareOnly />
        </div>
      ) : drawingNew ? (
        <span className="hint">Add a photo above to draw the crop against it.</span>
      ) : null}

      {error ? <div className="callout blocked">{error}</div> : null}
      <div className="row-gap-12">
        <button className="btn btn-primary" onClick={apply} disabled={busy || Boolean(blocked)} title={blocked ?? undefined}>
          <Spinner active={busy} />
          Crop &amp; save {activeRows.length || ""} colour{activeRows.length === 1 ? "" : "s"}
        </button>
        <button className="btn btn-tertiary" onClick={() => setOpen(false)} disabled={busy}>
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
}: {
  templates: MockupTemplateCard[];
  shots: MockupShotOption[];
}) {
  return (
    <section className="stack-12">
      <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <Kicker>MOCKUP TEMPLATES · {templates.length}</Kicker>
        <div className="row-gap-12">
          <MockupTemplateIntake />
          <MockupShotIntake shots={shots} />
        </div>
      </div>
      <div className="inbox-grid">
        {templates.map((t) => (
          <TemplateCard key={t.id} t={t} />
        ))}
        {templates.length === 0 ? (
          <div className="hint">No mockup templates yet — capture one with ＋ New mockup template.</div>
        ) : null}
      </div>
    </section>
  );
}
