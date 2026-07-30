"use client";

/**
 * C8's output — the PSD master link. The PSD is the master asset (spec §3.6):
 * every PNG downstream is a disposable derivative of it, and C10's gate won't
 * pass without it. Saving the link stamps the saved date automatically.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";
import { BusyNote } from "./BusyNote";
import { apiJson } from "@/lib/api";

export interface PsdData {
  designId: string;
  psdLink: string;
  psdSavedAt: string | null;
}

export function PsdCapture({ data }: { data: PsdData }) {
  const router = useRouter();
  const [link, setLink] = useState(data.psdLink);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = link !== data.psdLink;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiJson(`/api/designs/${data.designId}`, "PATCH", { psdLink: link });
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(false);
  }

  return (
    <div className="card supporting">
      <Kicker>PSD MASTER — C8&apos;S OUTPUT</Kicker>
      {error ? <div className="callout blocked">{error}</div> : null}
      <div className="field">
        <label className="kicker" htmlFor="psd-link">PSD MASTER LINK — LAYERED, OPENS IN PHOTOPEA OR PHOTOSHOP</label>
        <input
          id="psd-link"
          className="input"
          placeholder="https://… — wherever the layered master lives"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
      </div>
      <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
          {busy ? <span className="spinner" /> : null}
          Save PSD link
        </button>
        <BusyNote active={busy} label="Saving" />
        {!busy && data.psdSavedAt ? (
          <span className="hint">Saved {data.psdSavedAt} · unblocks the C10 validation gate</span>
        ) : !busy ? (
          <span className="hint">C10 won&apos;t pass without this — the PSD is the master asset.</span>
        ) : null}
      </div>
    </div>
  );
}
