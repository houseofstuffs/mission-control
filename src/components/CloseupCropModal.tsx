"use client";

/**
 * Framing for the print close-up — the SAME drag interaction as the
 * Adjust-crop modal (square box, corner handles, pen-sized targets),
 * over the chosen RENDER, preloaded at the print-region quad.
 *
 * The 2000px guardrail is a CONSTRAINT, not a refusal: onChange simply
 * rejects any drag that would take the output under the floor, so the
 * box stops at the limit and the operator never meets a dead end. Live
 * readout says exactly what the framing yields.
 */
import { useState } from "react";
import { Kicker } from "./ui";
import { ModalShell } from "./ModalShell";
import { QuadEditor, rectToQuad, quadToRect, type Dims } from "./QuadEditor";
import { cropSquarePixels, type CropRect } from "@/lib/mockupCrop";
import { MOCKUP_CROP_MIN } from "@/config/mockups";

export function CloseupCropModal({
  renderUrl,
  renderName,
  renderPx,
  defaultRect,
  initialRect,
  onClose,
  onConfirm,
}: {
  renderUrl: string;
  renderName: string;
  /** the shorter edge of what actually gets cut (the native re-render) */
  renderPx: number;
  /** the print-region framing — start point and Reset target */
  defaultRect: CropRect;
  /** a previously chosen framing, so re-opening resumes where they left off */
  initialRect?: CropRect | null;
  onClose: () => void;
  onConfirm: (rect: CropRect) => void;
}) {
  const [rect, setRect] = useState<CropRect>(initialRect ?? defaultRect);
  // the box drags in NORMALIZED coords; px readout scales to the render
  const dims: Dims = { width: renderPx, height: renderPx };
  const outPx = cropSquarePixels(renderPx, renderPx, rect);

  return (
    <ModalShell label={`Frame the close-up — ${renderName}`} width="min(900px, 92vw)" busy={false} onClose={onClose}>
      <div className="row-gap-12" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
        <Kicker>FRAME THE CLOSE-UP · {renderName.toUpperCase()}</Kicker>
        <span className="body-sm" style={{ fontWeight: 700, color: "var(--status-done, #3e7a4e)" }}>
          output {outPx}px
        </span>
      </div>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }} className="stack-12">
        <span className="hint">
          Drag the box until the framing is right — it starts on the <strong>print region</strong> and
          can&apos;t shrink below the {MOCKUP_CROP_MIN}px floor, so any framing you can reach is sharp.
        </span>
        <div style={{ width: "min(100%, 58vh)", margin: "0 auto" }}>
          <QuadEditor
            src={renderUrl}
            squareOnly
            centerGuides
            quad={rectToQuad(rect, dims)}
            onChange={(q) => {
              const next = quadToRect(q, dims);
              // the guardrail as a wall: an under-floor drag is dropped,
              // the box holds at its last honest size
              if (cropSquarePixels(renderPx, renderPx, next) >= MOCKUP_CROP_MIN) setRect(next);
            }}
          />
        </div>
      </div>
      <div style={{ flex: "none" }} className="stack-12">
        <div className="row-gap-8" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn btn-tertiary" onClick={() => setRect(defaultRect)}>
            Reset to print region
          </button>
          <button className="btn btn-tertiary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onConfirm(rect)}>
            Use this framing · {outPx}px
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
