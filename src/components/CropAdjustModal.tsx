"use client";

/**
 * L4's crop-adjust modal — the SAME re-crop tool as the Library card,
 * at working size. The review grid is where an off-centre frame is
 * SEEN, so the fix opens right there: big centred canvas, square box
 * with centre guides, live "crop yields Npx" readout.
 *
 * Saving re-crops from the ORIGINAL source and replaces the stored
 * variant file — everywhere the template is used, permanently — and the
 * server re-maps the print-region quad to the new framing in the same
 * write, so crop and corners can't drift out of sync. The parent then
 * regenerates just the affected tiles.
 */
import { useEffect, useRef, useState } from "react";
import { Kicker, Spinner } from "./ui";
import { apiJson } from "@/lib/api";
import { QuadEditor, rectToQuad, quadToRect, type Dims } from "./QuadEditor";
import { cropSquarePixels, type CropRect } from "@/lib/mockupCrop";
import { DEFAULT_CROP_RECT, MOCKUP_CROP_MIN } from "@/config/mockups";

export function CropAdjustModal({
  variantId,
  variantName,
  onClose,
  onSaved,
}: {
  variantId: string;
  variantName: string;
  onClose: () => void;
  /** fired after a successful re-crop — the parent regenerates the tile(s) */
  onSaved: (result: { size: number; quad: "remapped" | "remapped-clipped" | "unmapped" }) => void;
}) {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcDims, setSrcDims] = useState<Dims | null>(null);
  const [needsLink, setNeedsLink] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [rect, setRect] = useState<CropRect>(DEFAULT_CROP_RECT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (loadedFor.current === variantId) return;
    loadedFor.current = variantId;
    void load();
    return () => {
      setSrcUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId]);

  async function load(link?: string) {
    setBusy(true);
    setError(null);
    try {
      const qs = link ? `?link=${encodeURIComponent(link)}` : "";
      const res = await fetch(`/api/mockup-templates/${variantId}/source${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.needsSource) setNeedsLink(true);
        else setError(json?.error ?? `Couldn't load the source photo (${res.status}).`);
      } else {
        const w = Number(res.headers.get("x-source-width"));
        const h = Number(res.headers.get("x-source-height"));
        // the rect the variant's CURRENT framing came from — start there,
        // so "nudge it right a touch" is a small drag, not a re-derivation
        let startRect: CropRect = DEFAULT_CROP_RECT;
        try {
          const raw = res.headers.get("x-source-crop-rect");
          const parsed = raw ? JSON.parse(raw) : null;
          if (parsed && typeof parsed.x === "number" && typeof parsed.y === "number" && typeof parsed.size === "number") {
            startRect = parsed;
          }
        } catch {
          /* fall back to centred */
        }
        const blob = await res.blob();
        setSrcUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setSrcDims(w && h ? { width: w, height: h } : null);
        setRect(startRect);
        setNeedsLink(false);
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    }
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiJson<{ size?: number; quad?: "remapped" | "remapped-clipped" | "unmapped" }>(
      `/api/mockup-templates/${variantId}/recrop`,
      "POST",
      { rect, ...(linkInput.trim() ? { driveLink: linkInput.trim() } : {}) },
      120_000
    );
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    setBusy(false);
    onSaved({ size: res.data.size ?? 0, quad: res.data.quad ?? "unmapped" });
  }

  const px = srcDims ? cropSquarePixels(srcDims.width, srcDims.height, rect) : null;
  const under = px !== null && px < MOCKUP_CROP_MIN;

  return (
    <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="modal stack-12"
        role="dialog"
        aria-label={`Adjust crop — ${variantName}`}
        style={{ width: "min(1040px, 94vw)", maxHeight: "94vh", overflowY: "auto" }}
      >
        <div className="row-gap-12" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
          <Kicker>ADJUST CROP · {variantName.toUpperCase()}</Kicker>
          {px !== null ? (
            <span
              className="body-sm"
              style={{ fontWeight: 700, color: under ? "var(--status-blocked, #b3423a)" : "var(--status-done, #3e7a4e)" }}
            >
              crop yields {px}px{under ? ` — under the ${MOCKUP_CROP_MIN}px floor` : ""}
            </span>
          ) : null}
        </div>

        {needsLink ? (
          <>
            <span className="hint">
              This variant predates source tracking, so the original photo&apos;s location isn&apos;t
              stored. Paste its Drive share link once — it&apos;s remembered from then on.
            </span>
            <input
              className="input"
              placeholder="https://drive.google.com/file/d/…"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              autoFocus
            />
            <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
              <button className="btn btn-secondary" disabled={busy || !linkInput.trim()} onClick={() => load(linkInput.trim())}>
                <Spinner active={busy} />
                Load source photo
              </button>
              <button className="btn btn-tertiary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
            </div>
          </>
        ) : srcUrl && srcDims ? (
          <>
            <span className="hint">
              Drag the box to where this photo&apos;s garment sits — the solid centre lines meet the
              dashed ones when it&apos;s centred. The print region re-maps to the new framing
              automatically.
            </span>
            <QuadEditor
              src={srcUrl}
              squareOnly
              centerGuides
              quad={rectToQuad(rect, srcDims)}
              onChange={(q) => setRect(quadToRect(q, srcDims))}
            />
            <div className="callout" style={{ fontSize: 12 }}>
              Saving replaces the stored variant file <strong>everywhere this template is used</strong> —
              every listing that generates from it inherits the new framing. Renders made with the old
              frame keep it until regenerated (this listing&apos;s affected tiles regenerate on save).
            </div>
            {error ? <div className="callout blocked">{error}</div> : null}
            <div className="row-gap-8" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="btn btn-tertiary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-secondary" onClick={save} disabled={busy || under}>
                <Spinner active={busy} />
                Re-crop &amp; replace
              </button>
            </div>
          </>
        ) : (
          <>
            {error ? <div className="callout blocked">{error}</div> : null}
            <span className="hint">
              {error ? (
                <button className="btn btn-tertiary" style={{ fontSize: 12 }} onClick={() => load()}>
                  Retry
                </button>
              ) : (
                <>
                  <Spinner active /> loading the source photo from Drive…
                </>
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
