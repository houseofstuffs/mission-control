"use client";

/**
 * The draggable-geometry editor shared by the Library intake flows and
 * L4's crop-adjust modal. One component, two shapes of work: free quads
 * (corner placement for print regions) and locked squares (crop boxes),
 * plus the rect ↔ quad bridges that let a square CropRect ride the same
 * editor. Extracted from MockupTemplates.tsx when L4 needed the editor
 * at modal size — the tiny in-card canvas wasn't precise enough to trust.
 */
import { useEffect, useRef, useState } from "react";
import { rectNormalizedSize, type CropRect } from "@/lib/mockupCrop";
import type { Quad } from "@/config/mockups";

export type Dims = { width: number; height: number };

const MIN_SIDE = 0.04; // a quad can't collapse smaller than 4% of the image

export function isRectangle(q: Quad): boolean {
  const e = 0.002;
  return (
    Math.abs(q[0].y - q[1].y) < e &&
    Math.abs(q[3].y - q[2].y) < e &&
    Math.abs(q[0].x - q[3].x) < e &&
    Math.abs(q[1].x - q[2].x) < e
  );
}

export function rectQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/**
 * The quad is normalized to the image box, so a true pixel square needs
 * DIFFERENT normalized width and height on a non-square photo. Getting
 * this right is what makes the dragged box, the preview and the written
 * file agree — a normalized square renders visibly wide on a landscape
 * shot while claiming to be square.
 */
export function rectToQuad(r: CropRect, dims: Dims): Quad {
  const { w, h } = rectNormalizedSize(dims.width, dims.height, r);
  return rectQuad(r.x, r.y, w, h);
}

export function quadToRect(q: Quad, dims: Dims): CropRect {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  // both axes describe the same square in pixels; average them so a
  // rounding drift during a drag can't bias one direction
  const side = ((Math.max(...xs) - x) * dims.width + (Math.max(...ys) - y) * dims.height) / 2;
  return { x, y, size: side / Math.min(dims.width, dims.height) };
}

export function QuadEditor({
  src,
  quad,
  onChange,
  squareOnly = false,
  centerGuides = false,
  ghost = null,
}: {
  src: string;
  quad: Quad;
  onChange: (q: Quad) => void;
  /** hides the unlock-corners toggle — the resize math already preserves whatever ratio a quad starts with, so a square-initialized quad stays square through every drag as long as it's never unlocked */
  squareOnly?: boolean;
  /** dashed canvas-centre lines plus solid lines through the box's own centre — centring is done when the two pairs coincide */
  centerGuides?: boolean;
  /** non-interactive dashed reference polygons (canvas-normalized) with a
   *  centre cross each — e.g. the print region ghosted under a crop box,
   *  so cropping is lining up two centres instead of eyeballing */
  ghost?: Quad[] | null;
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
          {(ghost ?? []).map((g, gi) => {
            const gx = (g.reduce((a, p) => a + p.x, 0) / 4) * 100;
            const gy = (g.reduce((a, p) => a + p.y, 0) / 4) * 100;
            // difference-blend white: visible on any photo without
            // shouting over it — a reference, not a control
            const stroke = { stroke: "#fff", strokeWidth: gi === 0 ? 1.4 : 1, strokeDasharray: "5 4" } as const;
            return (
              <g key={gi} style={{ mixBlendMode: "difference", opacity: 0.65 }}>
                <polygon
                  points={g.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
                  fill="none"
                  {...stroke}
                  vectorEffect="non-scaling-stroke"
                />
                <line x1={gx - 2.2} y1={gy} x2={gx + 2.2} y2={gy} stroke="#fff" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
                <line x1={gx} y1={gy - 2.2} x2={gx} y2={gy + 2.2} stroke="#fff" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
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
