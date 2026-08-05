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
import { useRef, useState } from "react";
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

export function PlacementModal({
  listingId,
  designId,
  variantId,
  variantName,
  colour,
  quad,
  current,
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/designs/${designId}/thumb`}
                  alt=""
                  draggable={false}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    transform: `translate(${p.dx * 100}%, ${p.dy * 100}%) rotate(${p.rot}deg) scale(${p.scale})`,
                    pointerEvents: "none",
                  }}
                />
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
