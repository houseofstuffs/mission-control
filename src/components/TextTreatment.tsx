"use client";

/**
 * C3's record — how the lettering was actually produced, and what was set.
 *
 * The source matters beyond bookkeeping: generated-in-image text is the
 * spelling-risk path (spec §5.2 — text as a layer wherever spelling matters),
 * so a design carrying it is a design worth proofreading twice.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker, Spinner } from "./ui";
import { AutoTextarea } from "./AutoTextarea";
import { apiJson } from "@/lib/api";

export interface TextTreatmentData {
  designId: string;
  textSource: string;
  textDetail: string;
}

const SOURCES = [
  "Live text — Kittl",
  "Live text — PODSpy",
  "Generated in-image — Kittl",
  "Generated in-image — PODSpy",
  "Other",
];

export function TextTreatment({ data }: { data: TextTreatmentData }) {
  const router = useRouter();
  const [source, setSource] = useState(data.textSource);
  const [detail, setDetail] = useState(data.textDetail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = source !== data.textSource || detail !== data.textDetail;
  const risky = source.startsWith("Generated in-image");

  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiJson(`/api/designs/${data.designId}`, "PATCH", {
      textSource: source,
      textDetail: detail,
    });
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(false);
  }

  return (
    <div className="card supporting">
      <Kicker>TEXT TREATMENT — C3&apos;S OUTPUT</Kicker>
      <div className="field">
        <label className="kicker" htmlFor="tt-source">HOW THE LETTERING WAS PRODUCED</label>
        <select
          id="tt-source"
          className="select"
          style={{ maxWidth: 320 }}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">Not recorded</option>
          {SOURCES.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      {risky ? (
        <div className="callout stale">
          Generated in-image — proofread every character before C5. This is the path where
          misspellings survive to print.
        </div>
      ) : null}
      <div className="field">
        <label className="kicker" htmlFor="tt-detail">TEXT DETAIL — EXACT COPY, TYPEFACE, TREATMENT</label>
        <AutoTextarea id="tt-detail" value={detail} onChange={setDetail} />
      </div>
      <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
          <Spinner active={busy} />
          Save text treatment
        </button>
      </div>
      {error ? <div className="callout blocked">{error}</div> : null}
    </div>
  );
}
