"use client";

/**
 * L1 — the print file this Printify product actually needs.
 *
 * Two cases, decided by the same >12% front-ratio rule as the C9 fan-out
 * flag: the master fits (upload it as-is, nothing to track), or this
 * garment's shape demands a RECOMPOSED file — and saving that file's link
 * is what creates the derivative record (its own status, per Phase 2:
 * born when the file is made, never speculatively). A master change flips
 * the derivative to Stale until it's re-saved.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";
import { apiJson } from "@/lib/api";

export interface PrintFileData {
  listingId: string;
  designId: string | null;
  productId: string | null;
  productName: string;
  needsRecompose: boolean;
  /** the design's master PNG — the file to upload when no recompose is needed */
  masterLink: string;
  derivative: {
    fileLink: string;
    width: number | null;
    height: number | null;
    status: string;
    madeAt: string;
  } | null;
}

export function PrintFilePanel({ data }: { data: PrintFileData }) {
  const router = useRouter();
  const [link, setLink] = useState(data.derivative?.fileLink ?? "");
  const [width, setWidth] = useState(data.derivative?.width != null ? String(data.derivative.width) : "");
  const [height, setHeight] = useState(data.derivative?.height != null ? String(data.derivative.height) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data.designId || !data.productId) return null;

  // the easy case: master fits — say so and get out of the way
  if (!data.needsRecompose) {
    return (
      <div className="card supporting">
        <Kicker>PRINT FILE</Kicker>
        <span className="hint">
          The master fits {data.productName}&apos;s print shape (within 12%) — upload it to Printify
          as-is, no recomposition needed.
          {data.masterLink ? (
            <>
              {" "}
              <a href={data.masterLink} target="_blank" rel="noreferrer">master PNG ↗</a>
            </>
          ) : (
            " (No master PNG link on the design yet — C7 saves it.)"
          )}
        </span>
      </div>
    );
  }

  const der = data.derivative;
  const stale = der?.status === "Stale";

  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiJson("/api/derivatives", "POST", {
      designId: data.designId,
      productId: data.productId,
      listingId: data.listingId,
      fileLink: link.trim(),
      width,
      height,
    });
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(false);
  }

  return (
    <div className="card supporting">
      <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <Kicker>PRINT FILE — RECOMPOSED FOR THIS GARMENT</Kicker>
        {!der ? (
          <span className="chip stale">needed</span>
        ) : stale ? (
          <span className="chip stale">stale — master changed</span>
        ) : (
          <span className="chip done">✓ made {der.madeAt}</span>
        )}
      </div>
      <span className="hint">
        {data.productName}&apos;s print area differs from the master&apos;s shape by more than 12% —
        scaling would crop or stretch. Recompose in the PSD, export for this garment, save the
        file&apos;s link here. Saving creates the derivative record; the master is never touched.
      </span>
      {stale ? (
        <div className="callout stale">
          The master changed after this file was made — re-export from the current master and
          re-save, or the L6 gate stays unhappy.
        </div>
      ) : null}
      {der?.fileLink ? (
        <span className="body-sm">
          <a href={der.fileLink} target="_blank" rel="noreferrer">current file ↗</a>
          {der.width && der.height ? ` · ${der.width} × ${der.height}px` : ""}
        </span>
      ) : null}
      <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "1 1 260px" }}>
          <label className="kicker" htmlFor="pf-link">FILE LINK (DRIVE / S3)</label>
          <input id="pf-link" className="input" value={link} placeholder="https://drive.google.com/…"
            onChange={(e) => setLink(e.target.value)} />
        </div>
        <div className="field" style={{ width: 110 }}>
          <label className="kicker" htmlFor="pf-w">WIDTH PX</label>
          <input id="pf-w" type="number" className="input" value={width} onChange={(e) => setWidth(e.target.value)} />
        </div>
        <div className="field" style={{ width: 110 }}>
          <label className="kicker" htmlFor="pf-h">HEIGHT PX</label>
          <input id="pf-h" type="number" className="input" value={height} onChange={(e) => setHeight(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={save} disabled={busy || !link.trim()}>
          {busy ? <span className="spinner" /> : null}
          {der ? "Re-save print file" : "Save print file"}
        </button>
      </div>
      {error ? <div className="callout blocked">{error}</div> : null}
    </div>
  );
}
