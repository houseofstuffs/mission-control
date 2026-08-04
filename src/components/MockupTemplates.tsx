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
import {
  nativeDimensions,
  cropOutputSize,
  cropSquarePixels,
  cropToStandardSize,
  maxCenteredSquare,
  rectNormalizedSize,
  type CropRect,
} from "@/lib/mockupCrop";
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
  centerGuides = false,
}: {
  src: string;
  quad: Quad;
  onChange: (q: Quad) => void;
  /** hides the unlock-corners toggle — the resize math already preserves whatever ratio a quad starts with, so a square-initialized quad stays square through every drag as long as it's never unlocked */
  squareOnly?: boolean;
  /** dashed canvas-centre lines plus solid lines through the box's own centre — centring is done when the two pairs coincide */
  centerGuides?: boolean;
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
          {centerGuides
            ? (() => {
                // full-span lines rather than a small crosshair: when the
                // solid pair sits on the dashed pair, the crop is centred —
                // no eyeballing of distances required
                const cx = (quad.reduce((a, p) => a + p.x, 0) / 4) * 100;
                const cy = (quad.reduce((a, p) => a + p.y, 0) / 4) * 100;
                const dash = { stroke: "rgba(42,53,64,0.4)", strokeWidth: 1, strokeDasharray: "3 3" } as const;
                const solid = { stroke: "rgba(31,72,151,0.55)", strokeWidth: 1 } as const;
                return (
                  <>
                    <line x1="50" y1="0" x2="50" y2="100" {...dash} vectorEffect="non-scaling-stroke" />
                    <line x1="0" y1="50" x2="100" y2="50" {...dash} vectorEffect="non-scaling-stroke" />
                    <line x1={cx} y1="0" x2={cx} y2="100" {...solid} vectorEffect="non-scaling-stroke" />
                    <line x1="0" y1={cy} x2="100" y2={cy} {...solid} vectorEffect="non-scaling-stroke" />
                  </>
                );
              })()
            : null}
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
  importJob: { status: "running" | "complete" | "interrupted"; done: number; total: number; imported: number } | null;
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
}: {
  s: MockupShotOption;
  driveConnected: boolean;
  variants: MockupTemplateCard[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [name, setName] = useState(s.name);
  const [link, setLink] = useState(s.driveFolderLink);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // variants collapsed by default — the card is for recognition, the
  // expansion is for work on one template's colours
  const [showVariants, setShowVariants] = useState(false);

  async function saveEdits() {
    setBusy(true);
    setError(null);
    const res = await apiJson(`/api/mockup-shots/${s.id}`, "PATCH", {
      name: name.trim(),
      driveFolderLink: link.trim(),
    });
    if (!res.ok) setError(res.error);
    else {
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
              title="Rename, or change the Drive folder link"
              onClick={() => {
                setName(s.name);
                setLink(s.driveFolderLink);
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
            <span className={`chip ${s.printRegionQuad ? "done" : "stale"}`}>
              {s.printRegionQuad ? "print region set" : "no print region"}
            </span>
            <span className="chip count">
              {s.existingColours.length} {s.existingColours.length === 1 ? "colour" : "colours"}
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
                <span className="chip done">imported {s.importJob.imported}/{s.importJob.total} ✓</span>
              ) : (
                <span className="chip stale" title="Some files failed — open ＋ Add colour variants for the per-file reasons">
                  imported {s.importJob.imported}/{s.importJob.total} — some failed
                </span>
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
    </div>
  );
}

export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  connectedAt: string | null;
}

type Dims = { width: number; height: number };

/**
 * The quad is normalized to the image box, so a true pixel square needs
 * DIFFERENT normalized width and height on a non-square photo. Getting
 * this right is what makes the dragged box, the preview and the written
 * file agree — a normalized square renders visibly wide on a landscape
 * shot while claiming to be square.
 */
function rectToQuad(r: CropRect, dims: Dims): Quad {
  const { w, h } = rectNormalizedSize(dims.width, dims.height, r);
  return rectQuad(r.x, r.y, w, h);
}

function quadToRect(q: Quad, dims: Dims): CropRect {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  // both axes describe the same square in pixels; average them so a
  // rounding drift during a drag can't bias one direction
  const side = ((Math.max(...xs) - x) * dims.width + (Math.max(...ys) - y) * dims.height) / 2;
  return { x, y, size: side / Math.min(dims.width, dims.height) };
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
function TemplateDefine({ onSaved, onClose }: { onSaved: (name: string) => void; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [driveLink, setDriveLink] = useState("");
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
}: {
  templates: MockupTemplateCard[];
  shots: MockupShotOption[];
  palette: string[];
  drive: DriveStatus;
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
    if (err) setDriveError(err);
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
          onSaved={(saved) => {
            setSavedNotice(`Template "${saved}" saved — add its colours with ＋ Add colour variants.`);
            setOpenForm(null);
          }}
          onClose={() => setOpenForm(null)}
        />
      ) : null}
      {savedNotice ? <div className="callout">{savedNotice}</div> : null}
      {driveNotice ? <span className="hint">{driveNotice}</span> : null}
      {driveError ? <div className="callout blocked">Google Drive: {driveError}</div> : null}
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
