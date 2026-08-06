"use client";

/**
 * L4's placement tool — how THIS design sits inside the print region.
 * The third adjustment in the family, listing-scoped by design:
 * crop = the photo (variant), quad = the printable zone (template),
 * placement = the design in that zone (this listing).
 *
 * The preview is a fast 2D approximation — base thumb, region outline,
 * design thumb transformed live (drag to move, sliders for scale and
 * rotation). The exact perspective render happens server-side on save,
 * when the parent regenerates the affected tiles. Opens at the CURRENT
 * placement, never a reset to defaults.
 */
import { useEffect, useRef, useState } from "react";
import { Kicker, Spinner } from "./ui";
import { ModalShell } from "./ModalShell";
import { apiJson } from "@/lib/api";
import {
  clampPlacement,
  isIdentityPlacement,
  IDENTITY_PLACEMENT,
  type ArtPlacement,
  type PlacementMap,
  type Quad,
} from "@/config/mockups";

interface ContentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function PlacementModal({
  listingId,
  designId,
  variantId,
  variantName,
  colour,
  quad,
  current,
  printArea,
  onClose,
  onSaved,
}: {
  listingId: string;
  designId: string | null;
  variantId: string;
  variantName: string;
  colour: string;
  /** the variant's print region, for the preview overlay */
  quad: Quad | null;
  /** the listing's stored placement map — the modal edits into it */
  current: PlacementMap;
  /** the REAL print area, for the printed-size readout */
  printArea: {
    wPx: number | null;
    hPx: number | null;
    wIn: number | null;
    hIn: number | null;
    dpi: number;
    dpiAssumed: boolean;
  };
  onClose: () => void;
  onSaved: (scope: "all" | "variant") => void;
}) {
  const hasOverride = Boolean(current.perVariant[variantId]);
  // open at the state that's actually rendering THIS tile (never reset)
  const [scope, setScope] = useState<"all" | "variant">(hasOverride ? "variant" : "all");
  const [p, setP] = useState<ArtPlacement>(
    current.perVariant[variantId] ?? current.default ?? IDENTITY_PLACEMENT
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- the REAL master, alpha intact — the preview composites what the
  // renderer composites. The C2 snapshot thumb painted transparency as
  // solid black and hid where the art actually ends.
  const [masterUrl, setMasterUrl] = useState<string | null>(null);
  const [masterDims, setMasterDims] = useState<{ width: number; height: number } | null>(null);
  const [content, setContent] = useState<ContentBox | null>(null);
  const [masterFallback, setMasterFallback] = useState(false);
  useEffect(() => {
    if (!designId) return;
    let revoke: string | null = null;
    (async () => {
      try {
        const res = await fetch(`/api/designs/${designId}/master-preview`, { cache: "no-store" });
        if (!res.ok) {
          setMasterFallback(true);
          return;
        }
        const w = Number(res.headers.get("x-master-width"));
        const h = Number(res.headers.get("x-master-height"));
        const cw = Number(res.headers.get("x-content-width"));
        const chh = Number(res.headers.get("x-content-height"));
        const blob = await res.blob();
        revoke = URL.createObjectURL(blob);
        setMasterUrl(revoke);
        setMasterDims(w && h ? { width: w, height: h } : null);
        setContent(
          cw && chh
            ? {
                left: Number(res.headers.get("x-content-left")) || 0,
                top: Number(res.headers.get("x-content-top")) || 0,
                width: cw,
                height: chh,
              }
            : null
        );
      } catch {
        setMasterFallback(true);
      }
    })();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [designId]);

  // ---- print truth: how big the VISIBLE art prints, independent of the
  // mockup. Printify fits the FILE to the area; empty canvas prints as
  // nothing but still shrinks the art's share. Placement never enters —
  // Printify doesn't know about it.
  const areaAspect = printArea.wPx && printArea.hPx ? printArea.wPx / printArea.hPx : null;
  const masterAspect = masterDims ? masterDims.width / masterDims.height : null;
  let fileFracW = 1;
  let fileFracH = 1;
  if (areaAspect && masterAspect) {
    if (masterAspect > areaAspect) fileFracH = areaAspect / masterAspect;
    else fileFracW = masterAspect / areaAspect;
  }
  const contentFracW = content && masterDims ? content.width / masterDims.width : 1;
  const contentFracH = content && masterDims ? content.height / masterDims.height : 1;
  const printedW = printArea.wIn ? printArea.wIn * fileFracW * contentFracW : null;
  const printedH = printArea.hIn ? printArea.hIn * fileFracH * contentFracH : null;

  // drag-to-move on the preview: pointer deltas become dx/dy fractions
  const previewRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; dx0: number; dy0: number; boxW: number; boxH: number } | null>(null);

  const xs = quad?.map((q) => q.x) ?? [0.3, 0.7, 0.7, 0.3];
  const ys = quad?.map((q) => q.y) ?? [0.3, 0.3, 0.7, 0.7];
  const box = {
    left: Math.min(...xs),
    top: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };

  function startDrag(e: React.PointerEvent) {
    const el = previewRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { startX: e.clientX, startY: e.clientY, dx0: p.dx, dy0: p.dy, boxW: r.width * box.w, boxH: r.height * box.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDrag(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    setP((cur) =>
      clampPlacement({
        ...cur,
        dx: d.dx0 + (e.clientX - d.startX) / Math.max(1, d.boxW),
        dy: d.dy0 + (e.clientY - d.startY) / Math.max(1, d.boxH),
      })
    );
  }
  function endDrag() {
    drag.current = null;
  }

  async function save() {
    setBusy(true);
    setError(null);
    const perVariant = { ...current.perVariant };
    let dflt = current.default;
    if (scope === "variant") {
      if (isIdentityPlacement(p) && !current.default) delete perVariant[variantId];
      else perVariant[variantId] = p;
    } else {
      dflt = isIdentityPlacement(p) ? null : p;
    }
    const res = await apiJson(`/api/listings/${listingId}`, "PATCH", {
      mockupPlacement: { default: dflt, perVariant },
    });
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    setBusy(false);
    onSaved(scope);
  }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <ModalShell label={`Place artwork — ${variantName}`} width="min(920px, 92vw)" busy={busy} onClose={onClose}>
        <Kicker>PLACE ARTWORK · {variantName.toUpperCase()} — {colour.toUpperCase()}</Kicker>

        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }} className="stack-12">
          <span className="hint">
            Drag the design to move it · sliders for size and tilt. The preview is a flat
            approximation — the saved render applies the template&apos;s true perspective and fit.
          </span>

          {/* the preview: base thumb, region outline, design transformed live */}
          <div
            ref={previewRef}
            style={{
              position: "relative",
              width: "min(100%, calc(52vh * 1))",
              margin: "0 auto",
              aspectRatio: "1 / 1",
              background: "var(--surface-sunk, #f4efe2)",
              borderRadius: 10,
              overflow: "hidden",
              touchAction: "none",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/mockup-templates/${variantId}/thumb`}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
              draggable={false}
            />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
              <polygon
                points={(quad ?? []).map((q) => `${q.x * 100},${q.y * 100}`).join(" ")}
                fill="none"
                stroke="#fff"
                strokeWidth="1"
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
                style={{ mixBlendMode: "difference", opacity: 0.65 }}
              />
            </svg>
            {designId ? (
              <div
                onPointerDown={startDrag}
                onPointerMove={onDrag}
                onPointerUp={endDrag}
                style={{
                  position: "absolute",
                  left: pct(box.left),
                  top: pct(box.top),
                  width: pct(box.w),
                  height: pct(box.h),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "move",
                }}
              >
                {/* the FILE CANVAS gets its own dashed outline: a master
                    with empty space renders art smaller than its canvas,
                    and where the file ends should be visible, not
                    guessable. The img inside keeps the master's alpha. */}
                <div
                  style={{
                    ...(masterDims
                      ? {
                          aspectRatio: `${masterDims.width} / ${masterDims.height}`,
                          ...(masterDims.width / masterDims.height >= box.w / Math.max(box.h, 0.0001)
                            ? { width: "100%" }
                            : { height: "100%" }),
                        }
                      : { maxWidth: "100%", maxHeight: "100%" }),
                    maxWidth: "100%",
                    maxHeight: "100%",
                    border: "1.5px dashed rgba(255,255,255,0.55)",
                    boxSizing: "border-box",
                    transform: `translate(${p.dx * 100}%, ${p.dy * 100}%) rotate(${p.rot}deg) scale(${p.scale})`,
                    pointerEvents: "none",
                    display: "flex",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={masterUrl ?? `/api/designs/${designId}/thumb`}
                    alt=""
                    draggable={false}
                    style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
                  />
                </div>
              </div>
            ) : (
              <span className="hint" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                no design linked — placement still saves
              </span>
            )}
          </div>

          <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <label className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              size
              <input
                type="range"
                min={20}
                max={300}
                step={1}
                value={Math.round(p.scale * 100)}
                onChange={(e) => setP((cur) => clampPlacement({ ...cur, scale: Number(e.target.value) / 100 }))}
                style={{ width: 150 }}
              />
              <span style={{ width: 44, fontWeight: 700 }}>{Math.round(p.scale * 100)}%</span>
            </label>
            <label className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              tilt
              <input
                type="range"
                min={-45}
                max={45}
                step={1}
                value={Math.round(p.rot)}
                onChange={(e) => setP((cur) => clampPlacement({ ...cur, rot: Number(e.target.value) }))}
                style={{ width: 130 }}
              />
              <span style={{ width: 36, fontWeight: 700 }}>{Math.round(p.rot)}°</span>
            </label>
            <button
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "3px 10px" }}
              onClick={() => setP(IDENTITY_PLACEMENT)}
            >
              Reset
            </button>
          </div>

          {/* print truth — what actually comes off the printer, which
              placement can never change */}
          {masterFallback ? (
            <div className="callout stale" style={{ fontSize: 12 }}>
              Couldn&apos;t load the design master (Drive?) — previewing the flattened snapshot, so
              transparency and true art size may be misrepresented here. The render itself is
              unaffected.
            </div>
          ) : masterDims ? (
            <div className="callout" style={{ fontSize: 12 }}>
              <strong>Printed for real:</strong>{" "}
              {printedW && printedH && printArea.wIn && printArea.hIn ? (
                <>
                  visible art ≈ {printedW.toFixed(1)}″ × {printedH.toFixed(1)}″ on the{" "}
                  {printArea.wIn.toFixed(printArea.wIn % 1 ? 1 : 0)}″ ×{" "}
                  {printArea.hIn.toFixed(printArea.hIn % 1 ? 1 : 0)}″ print area
                  <span className="hint">
                    {" "}
                    @ {printArea.dpi} DPI{printArea.dpiAssumed ? " (assumed — set Print DPI on the product if this provider differs)" : ""}
                  </span>
                </>
              ) : (
                <>
                  visible art fills ≈ {Math.round(fileFracW * contentFracW * 100)}% ×{" "}
                  {Math.round(fileFracH * contentFracH * 100)}% of the print area
                </>
              )}
              {content && masterDims && (contentFracW < 0.98 || contentFracH < 0.98) ? (
                <>
                  {" "}· the file is {masterDims.width}×{masterDims.height}px but its visible art is only{" "}
                  {content.width}×{content.height}px — empty canvas prints as nothing yet shrinks the
                  art&apos;s share of the area
                </>
              ) : null}
            </div>
          ) : null}
          {!isIdentityPlacement(p) ? (
            <div className="callout stale" style={{ fontSize: 12 }}>
              ⚠ Placement changes the <strong>mockup only</strong> — Printify prints the uploaded
              file at its own placement. If you scale here, make the same change in Printify, or the
              photos will promise a bigger print than the buyer gets.
            </div>
          ) : null}

          <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <label className="body-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="radio" name="place-scope" checked={scope === "all"} onChange={() => setScope("all")} />
              All tiles in this listing
            </label>
            <label className="body-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="radio" name="place-scope" checked={scope === "variant"} onChange={() => setScope("variant")} />
              Only {variantName} — {colour}
            </label>
            {hasOverride && scope === "all" ? (
              <span className="hint" style={{ color: "var(--status-stale, #b8792a)" }}>
                this tile has its own override — saving &quot;all&quot; won&apos;t change it
              </span>
            ) : null}
          </div>
        </div>

        <div style={{ flex: "none" }} className="stack-12">
          <span className="hint">
            Saved on the LISTING (this design) — templates and other listings are untouched.
            Affected tiles regenerate on save.
          </span>
          {error ? <div className="callout blocked">{error}</div> : null}
          <div className="row-gap-8" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button className="btn btn-tertiary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-secondary" onClick={save} disabled={busy}>
              <Spinner active={busy} />
              Save &amp; regenerate {scope === "all" ? "all tiles" : "this tile"}
            </button>
          </div>
        </div>
    </ModalShell>
  );
}
