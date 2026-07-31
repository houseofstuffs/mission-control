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
import {
  PIPELINE_TYPES,
  BLEND_MODES,
  FIT_MODES,
  DEFAULT_BLEND,
  DEFAULT_FIT,
  DEFAULT_QUAD,
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
  baseImageUrl: string | null;
  hasDisplacement: boolean;
  hasShadow: boolean;
  hasHighlight: boolean;
  sourceLink: string;
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
function QuadEditor({ src, quad, onChange }: { src: string; quad: Quad; onChange: (q: Quad) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(() => isRectangle(quad));
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
          {locked
            ? "Drag inside to position · pull a corner to resize (ratio stays put)."
            : "Each corner moves free — for angled shots. TL, TR, BR, BL."}
        </span>
        <button type="button" className="chip count" style={{ cursor: "pointer", border: "none" }} onClick={toggleMode}>
          {locked ? "unlock corners" : "lock ratio"}
        </button>
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
      setBlend(DEFAULT_BLEND); setFit(DEFAULT_FIT);
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
            <span className="hint">Multiply sinks ink into fabric. Normal for stickers and frames.</span>
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
            When artwork and area shapes disagree: fit shows the whole design (garments);
            fill covers edge-to-edge and crops the overflow (die-cuts, full-bleed). Never stretched.
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

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function testRender(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("artwork", file);
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
        {t.surface ? <span className="chip neutral">{t.surface}</span> : null}
        {t.pipelineType === "Full Displacement" ? (
          <span className="chip neutral">
            map ✓{t.hasShadow ? " · shadow ✓" : ""}{t.hasHighlight ? " · highlight ✓" : ""}
          </span>
        ) : null}
        {t.fit === "Fill area" ? <span className="chip neutral">fills area</span> : null}
        {missingCorners ? <span className="chip stale">needs corners</span> : null}
      </div>

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
            {busy ? "Rendering…" : "Test render"}
          </button>
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
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) testRender(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function MockupTemplatesSection({ templates }: { templates: MockupTemplateCard[] }) {
  return (
    <section className="stack-12">
      <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <Kicker>MOCKUP TEMPLATES · {templates.length}</Kicker>
        <MockupTemplateIntake />
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
