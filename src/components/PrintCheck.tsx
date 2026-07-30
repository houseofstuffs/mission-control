"use client";

/**
 * C8 — the two judgements that decide how a design gets sold.
 *
 * GARMENT COMPATIBILITY is set by hand: "does this read on black" is a look,
 * not a measurement. It drives colourway slot seeding, which Printify
 * variants are eligible, and the L6 publish gate.
 *
 * PRINT FILE CHECK is measured: opacity, pure black, size. Advisory only —
 * it never edits the file and never blocks the step.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner, Kicker } from "./ui";
import { AutoTextarea } from "./AutoTextarea";
import { apiCall, apiJson } from "@/lib/api";
import { preparePrintFile } from "@/lib/printFile";
import { GARMENT_COMPATIBILITY, variantAllowed } from "@/config/design-prompt";

export interface PrintCheckData {
  designId: string;
  compatibility: string;
  reason: string;
  checked: boolean;
  notes: string;
  /** colours offered by the primary product, deduped */
  colors: string[];
  productName: string | null;
}

interface Finding {
  ok: boolean;
  text: string;
}

export function PrintCheck({ data }: { data: PrintCheckData }) {
  return (
    <>
      <GarmentCompatibility data={data} />
      <PrintFileCheck data={data} />
    </>
  );
}

function GarmentCompatibility({ data }: { data: PrintCheckData }) {
  const router = useRouter();
  const [compat, setCompat] = useState(data.compatibility || "Unset");
  const [reason, setReason] = useState(data.reason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = compat !== (data.compatibility || "Unset") || reason !== data.reason;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiJson(`/api/designs/${data.designId}`, "PATCH", {
      garmentCompatibility: compat,
      garmentCompatibilityReason: reason,
    });
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(false);
  }

  const excluded = data.colors.filter((c) => !variantAllowed(compat, c));

  return (
    <div className="card supporting">
      <div className="field">
        <label className="kicker" htmlFor="gc-select">GARMENT COMPATIBILITY</label>
        <select
          id="gc-select"
          className="select"
          style={{ maxWidth: 240 }}
          value={compat}
          onChange={(e) => setCompat(e.target.value)}
        >
          {GARMENT_COMPATIBILITY.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      {compat === "Unset" ? (
        <div className="callout stale">
          Set this before the listing. Unset seeds five colourway slots and blocks the publish gate.
        </div>
      ) : null}
      <div className="field">
        <label className="kicker" htmlFor="gc-reason">WHY</label>
        <AutoTextarea id="gc-reason" value={reason} onChange={setReason} />
      </div>
      {excluded.length > 0 ? (
        <div className="well">
          <Kicker>NOT ELIGIBLE ON {(data.productName || "THIS PRODUCT").toUpperCase()}</Kicker>
          <div className="body-sm" style={{ marginTop: 6 }}>{excluded.join(" · ")}</div>
          <div className="hint" style={{ marginTop: 6 }}>
            Leave these off in Printify — the artwork won&apos;t hold on them.
          </div>
        </div>
      ) : null}
      <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
          <Spinner active={busy} />
          Save compatibility
        </button>
      </div>
      {error ? <div className="callout blocked">{error}</div> : null}
    </div>
  );
}

function PrintFileCheck({ data }: { data: PrintCheckData }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (f) {
        e.preventDefault();
        setError(null);
        setFile(f);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const prepared = await preparePrintFile(file);
    const form = new FormData();
    form.append("file", prepared.file, prepared.file.name);
    if (prepared.width) form.append("trueWidth", String(prepared.width));
    if (prepared.height) form.append("trueHeight", String(prepared.height));
    const res = await apiCall(`/api/designs/${data.designId}/print-check`, { method: "POST", body: form });
    if (!res.ok) setError(res.error);
    else {
      const payload = res.data as { result?: { findings?: Finding[] } };
      setFindings(payload?.result?.findings ?? null);
      router.refresh();
    }
    setBusy(false);
  }

  // freshly-run findings win; otherwise show what's on the record
  const stored = data.notes
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("Checked "))
    .map((line) => ({ ok: !line.startsWith("⚠"), text: line.replace(/^[✓⚠]\s*/, "") }));
  const shown = findings ?? (stored.length > 0 ? stored : null);

  return (
    <div className="card supporting">
      <Kicker>PRINT FILE CHECK</Kicker>
      <div className="hint">
        Drop the master PNG. Nothing is saved or altered — it&apos;s read, measured, discarded.
      </div>
      <button
        className="drop-tile"
        style={{
          minHeight: 88,
          ...(dragOver ? { outline: "2px dashed var(--blueberry)", outlineOffset: 4 } : {}),
        }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f?.type.startsWith("image/")) {
            setError(null);
            setFile(f);
          }
        }}
      >
        <span className="kicker" style={{ color: "var(--text-on-mint-title)" }}>
          {file ? file.name : "DROP MASTER PNG"}
        </span>
      </button>
      <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={run} disabled={busy || !file}>
          <Spinner active={busy} />
          Run check
        </button>
        {data.checked && !findings ? <span className="hint">Last check saved on the record.</span> : null}
      </div>
      {error ? <div className="callout blocked">{error}</div> : null}
      {shown ? (
        <div className="gate-panel" style={{ marginTop: 4 }}>
          {shown.map((f) => (
            <div key={f.text} className={`gate-item${f.ok ? " ok" : ""}`}>
              {f.ok ? "✓ " : ""}{f.text}
            </div>
          ))}
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setError(null);
            setFile(f);
          }
        }}
      />
    </div>
  );
}
