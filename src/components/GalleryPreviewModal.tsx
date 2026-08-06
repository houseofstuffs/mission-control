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
 * cage it), sized to the WINDOW: square main image at min(72vh, 900px,
 * usable width AND height), filmstrip of numbered thumbs below, arrows /
 * arrow keys / pen-or-finger swipe. Escape, the ✕, or a tap on the dark
 * surround closes — overlay only, never navigation.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface GallerySlide {
  /** slot record id — external asset refs are proxied through it */
  id: string;
  position: number;
  label: string;
  status: string;
  /** empty = a planned gap, shown as a placeholder */
  assetRef: string;
}

/**
 * Internal refs (our own /api/... routes) go straight into the <img>.
 * External ones — a hand-pasted Drive share link on a graphic-card slot —
 * would render Drive's HTML viewer page as a blank; those route through
 * the slot's asset-thumb proxy, which fetches the real bytes.
 */
function displayRef(sl: GallerySlide, size: 320 | 1200): string {
  if (!sl.assetRef) return "";
  if (sl.assetRef.startsWith("/")) return sl.assetRef;
  return `/api/image-slots/${sl.id}/asset-thumb?size=${size}`;
}

/**
 * The main image's square edge, from the window itself. This was a CSS
 * width formula once — width-only, so a short-wide window let the square's
 * HEIGHT overflow the flex column and bury the header and close button
 * under the image. Numbers over min(): 72vh, the operator's 900px hard
 * cap, usable width (arrows + padding), and usable height (header +
 * filmstrip + gaps ≈ 190px).
 */
function squareEdge(): number {
  if (typeof window === "undefined") return 550;
  return Math.max(
    220,
    Math.min(900, Math.floor(window.innerHeight * 0.72), window.innerWidth - 150, window.innerHeight - 190)
  );
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
  const [edge, setEdge] = useState(550);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const onResize = () => setEdge(squareEdge());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx((i) => Math.min(slides.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, onClose]);

  // keep the highlighted thumb in view — scroll ONLY the strip, by hand.
  // scrollIntoView walks every scrollable ancestor, and each call nudged
  // the page container a little further left; five slides in, the whole
  // carousel had drifted off-centre.
  useEffect(() => {
    const strip = stripRef.current;
    const thumb = strip?.querySelector<HTMLElement>(`[data-thumb="${idx}"]`);
    if (!strip || !thumb) return;
    strip.scrollTo({
      left: thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2,
      behavior: "smooth",
    });
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
      data-backdrop
      onPointerDown={(e) => {
        swipe.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
          setIdx((i) => (dx < 0 ? Math.min(slides.length - 1, i + 1) : Math.max(0, i - 1)));
          return;
        }
        // a stationary tap on the dark surround (not the image, not a
        // button) dismisses — overlay only, never navigation
        if (Math.hypot(dx, dy) < 10 && (e.target as HTMLElement).hasAttribute("data-backdrop")) {
          onClose();
        }
      }}
    >
      {/* header: where am I, and the way out — flex:none + zIndex so no
          sizing mistake below can ever bury the close button again */}
      <div style={{ flex: "none", zIndex: 1, width: "100%", display: "flex", alignItems: "center", gap: 12, color: "#f2ead6" }}>
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

      {/* the image, capped hard at min(72vh, 900px, usable width/height) */}
      <div
        data-backdrop
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
            width: edge,
            height: edge,
            flex: "none",
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
              src={displayRef(cur, 1200)}
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
                src={displayRef(sl, 320)}
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
