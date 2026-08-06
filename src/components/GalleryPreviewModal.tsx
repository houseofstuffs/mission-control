"use client";

/**
 * The buyer's-eye pass — L5's slots as a full-screen carousel, in slot
 * order, graphic cards included. Approving rows one at a time is not the
 * same judgment as scrolling the gallery the way Etsy will show it; this
 * is the scroll.
 *
 * Empty slots render as labelled placeholders on purpose (operator's
 * call): a gap you can SEE is a decision — a gap that's skipped is a
 * surprise at push time.
 *
 * Portalled to the body like every modal (transformed ancestors would
 * cage it), sized to the WINDOW: square main image at min(72vh, usable
 * width), filmstrip of numbered thumbs below, arrows / arrow keys /
 * pen-or-finger swipe, Escape closes.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface GallerySlide {
  position: number;
  label: string;
  status: string;
  /** empty = a planned gap, shown as a placeholder */
  assetRef: string;
}

export function GalleryPreviewModal({
  slides,
  onClose,
}: {
  slides: GallerySlide[];
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [idx, setIdx] = useState(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx((i) => Math.min(slides.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, onClose]);

  // keep the highlighted thumb in view as the index moves
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-thumb="${idx}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [idx]);

  if (!mounted || slides.length === 0) return null;
  const cur = slides[idx];

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(24, 22, 16, 0.92)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "14px 16px",
        gap: 10,
        touchAction: "pan-y",
      }}
      onPointerDown={(e) => {
        swipe.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(e.clientY - s.y)) {
          setIdx((i) => (dx < 0 ? Math.min(slides.length - 1, i + 1) : Math.max(0, i - 1)));
        }
      }}
    >
      {/* header: where am I, and the way out */}
      <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, color: "#f2ead6" }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>
          slot {cur.position} · {cur.label}
        </span>
        <span style={{ fontSize: 12, opacity: 0.75 }}>{cur.status}</span>
        <span style={{ fontSize: 12, opacity: 0.6, marginLeft: "auto" }}>
          {idx + 1} / {slides.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          style={{
            background: "none",
            border: "2px solid rgba(242, 234, 214, 0.5)",
            color: "#f2ead6",
            borderRadius: 999,
            width: 34,
            height: 34,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      {/* the image, as big as the window allows, never scrolling */}
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}
      >
        <button
          type="button"
          aria-label="Previous"
          disabled={idx === 0}
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          style={{
            background: "none",
            border: "none",
            color: idx === 0 ? "rgba(242,234,214,0.25)" : "#f2ead6",
            fontSize: 34,
            cursor: idx === 0 ? "default" : "pointer",
            padding: "0 4px",
            flex: "none",
          }}
        >
          ‹
        </button>
        <div
          style={{
            width: "min(72vh, calc(100% - 108px))",
            aspectRatio: "1 / 1",
            background: "#26221a",
            borderRadius: 14,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {cur.assetRef ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cur.assetRef}
              alt={`Slot ${cur.position} — ${cur.label}`}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              draggable={false}
            />
          ) : (
            <span style={{ color: "rgba(242,234,214,0.55)", fontSize: 14, textAlign: "center", padding: 20 }}>
              empty — slot {cur.position}
              <br />
              <span style={{ fontSize: 12, opacity: 0.8 }}>{cur.label} · {cur.status}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="Next"
          disabled={idx === slides.length - 1}
          onClick={() => setIdx((i) => Math.min(slides.length - 1, i + 1))}
          style={{
            background: "none",
            border: "none",
            color: idx === slides.length - 1 ? "rgba(242,234,214,0.25)" : "#f2ead6",
            fontSize: 34,
            cursor: idx === slides.length - 1 ? "default" : "pointer",
            padding: "0 4px",
            flex: "none",
          }}
        >
          ›
        </button>
      </div>

      {/* the filmstrip: full running order, current highlighted, tap to jump */}
      <div
        ref={stripRef}
        style={{
          flex: "none",
          width: "100%",
          display: "flex",
          gap: 8,
          overflowX: "auto",
          padding: "4px 2px 8px",
        }}
      >
        {slides.map((sl, i) => (
          <button
            key={sl.position}
            type="button"
            data-thumb={i}
            onClick={() => setIdx(i)}
            title={`slot ${sl.position} · ${sl.label}`}
            style={{
              flex: "none",
              width: 64,
              height: 64,
              borderRadius: 9,
              overflow: "hidden",
              position: "relative",
              border: i === idx ? "3px solid #ffd00d" : "2px solid rgba(242,234,214,0.25)",
              background: "#26221a",
              padding: 0,
              cursor: "pointer",
            }}
          >
            {sl.assetRef ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sl.assetRef}
                alt=""
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover", opacity: i === idx ? 1 : 0.75 }}
                draggable={false}
              />
            ) : null}
            <span
              style={{
                position: "absolute",
                left: 3,
                top: 2,
                fontSize: 10,
                fontWeight: 800,
                color: "#f2ead6",
                textShadow: "0 1px 2px rgba(0,0,0,0.8)",
              }}
            >
              {sl.position}
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
