"use client";

/**
 * The scrim + panel every modal sits in, PORTALED to document.body.
 *
 * The portal isn't ceremony: `position: fixed` resolves against the
 * nearest transformed ancestor, not the viewport, and `.idea-card:hover`
 * applies a 1px lift — so a modal opened from a Library card rendered
 * trapped inside that card's column, at card width. Any future transform
 * anywhere in the tree would do it again. Rendering outside the tree
 * makes "fills the window" true by construction.
 *
 * Sizing is viewport-relative for the same reason across the board: the
 * app has a 1280px min-width, but a modal must fit the WINDOW, which is
 * often narrower.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ModalShell({
  label,
  width = "min(1000px, 92vw)",
  busy = false,
  onClose,
  children,
}: {
  label: string;
  /** CSS width — always viewport-capped, never a bare pixel value */
  width?: string;
  /** blocks scrim-dismiss while a save is in flight */
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes — the habit every modal trains
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          width,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 18,
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
