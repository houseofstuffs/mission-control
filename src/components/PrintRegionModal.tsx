"use client";

/**
 * Re-place a TEMPLATE's print region — the shot-level fix for geometry
 * that's wrong for the shoot, not for one colour. Per-variant corners
 * don't scale: a region drawn badly is drawn badly for all 14 colours.
 *
 * Modal-sized for the same reason the crop tool is: the Library's card
 * column is too narrow to place corners you'd trust.
 *
 * Two steps on purpose. Saving writes the SHOT, which changes nothing
 * that renders — the compositor reads each VARIANT's own quad. The push
 * is what reaches renders, so it's offered explicitly, with the count of
 * renders it marks stale.
 */
import { useState } from "react";
import { Kicker, Spinner } from "./ui";
import { apiJson } from "@/lib/api";
import { QuadEditor } from "./QuadEditor";
import { ModalShell } from "./ModalShell";
import { DEFAULT_QUAD, type Quad } from "@/config/mockups";

interface SyncResult {
  updated?: number;
  moved?: number;
  staleFlagged?: number;
  listingsAffected?: number;
}

export function PrintRegionModal({
  shotId,
  shotName,
  sampleUrl,
  variantCount,
  current,
  onClose,
  onDone,
}: {
  shotId: string;
  shotName: string;
  /** the cropped sample — the frame every variant shares */
  sampleUrl: string | null;
  variantCount: number;
  current: Quad | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [quad, setQuad] = useState<Quad>(current ?? DEFAULT_QUAD);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveRegion() {
    setBusy(true);
    setError(null);
    const res = await apiJson(`/api/mockup-shots/${shotId}`, "PATCH", { printRegionQuad: quad });
    if (!res.ok) setError(res.error);
    else setSaved(true);
    setBusy(false);
  }

  async function pushToVariants() {
    setBusy(true);
    setError(null);
    const res = await apiJson<SyncResult>(`/api/mockup-shots/${shotId}/resync-variants`, "POST", {});
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    const d = res.data;
    const parts = [`region pushed to ${d.updated ?? 0} ${d.updated === 1 ? "variant" : "variants"}`];
    if (d.staleFlagged) {
      parts.push(
        `${d.staleFlagged} existing ${d.staleFlagged === 1 ? "render" : "renders"} flagged as stale across ${d.listingsAffected} ${d.listingsAffected === 1 ? "listing" : "listings"} — regenerate flagged at L4`
      );
    }
    setBusy(false);
    onDone(parts.join(" · "));
  }

  return (
    <ModalShell label={`Re-place print region — ${shotName}`} busy={busy} onClose={onClose}>
      <Kicker>RE-PLACE PRINT REGION · {shotName.toUpperCase()}</Kicker>

        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }} className="stack-12">
          {saved ? (
            <>
              <div className="callout" style={{ fontSize: 13 }}>
                <strong>Region saved on the template.</strong> Renders don&apos;t use it yet — the
                compositor reads each variant&apos;s own copy, so the region has to be pushed down to
                the {variantCount} {variantCount === 1 ? "variant" : "variants"} before Generate picks
                it up. The push also re-stamps the default blend.
              </div>
              <span className="hint">
                Renders made from the old region are flagged stale by the push (excluded from send,
                and the flag is the redo list) — regenerate them at L4 when you&apos;re ready. Nothing
                is deleted.
              </span>
            </>
          ) : sampleUrl ? (
            <>
              <span className="hint">
                Drag the corners to the printable zone on this shot&apos;s sample. Every colour
                variant shares this framing, so fixing it here fixes{" "}
                {variantCount === 1 ? "its one variant" : `all ${variantCount} variants`} at once.
              </span>
              <div style={{ width: "min(100%, 56vh)", margin: "0 auto" }}>
                <QuadEditor src={sampleUrl} quad={quad} onChange={setQuad} />
              </div>
            </>
          ) : (
            <div className="callout blocked">
              This template kept no sample image, so there&apos;s nothing to draw on. Re-place corners
              on one variant instead (Library → show variants).
            </div>
          )}
        </div>

        <div style={{ flex: "none" }} className="stack-12">
          {error ? <div className="callout blocked">{error}</div> : null}
          <div className="row-gap-8" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button className="btn btn-tertiary" onClick={onClose} disabled={busy}>
              {saved ? "Later" : "Cancel"}
            </button>
            {saved ? (
              <button className="btn btn-secondary" onClick={pushToVariants} disabled={busy || variantCount === 0}>
                <Spinner active={busy} />
                Push to {variantCount} {variantCount === 1 ? "variant" : "variants"}
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={saveRegion} disabled={busy || !sampleUrl}>
                <Spinner active={busy} />
                Save region
              </button>
            )}
          </div>
        </div>
    </ModalShell>
  );
}
