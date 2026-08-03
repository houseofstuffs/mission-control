"use client";

/**
 * L1 — which colourways this listing actually sells.
 *
 * Chosen in Printify when the product is created; recorded HERE so the rest
 * of the app can act on it — mockup templates are offered only in these
 * colours, and Phase-2 colour-variable rendering reads the same list.
 * Colours the design's garment compatibility rules out are shown disabled
 * rather than hidden: "you can't sell this on Butter" is information.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker, Spinner } from "./ui";
import { apiJson } from "@/lib/api";

export interface ColorwaysData {
  listingId: string;
  /** the house product name, as on the product card — the panel's title */
  productName: string;
  /** every colour the product offers */
  colors: string[];
  /** colours the design's garment compatibility rules out */
  excluded: string[];
  /** current selection on the record */
  selected: string[];
  /** the subset of `selected` this listing actually generates mockups for — empty means "same as selected" */
  mockupColors: string[];
  /** PRINTIFY_API_TOKEN present — the pull button needs it */
  printifyReady: boolean;
  /** already connected to a real Printify product */
  connected: boolean;
}

export function ColorwaysPanel({ data }: { data: ColorwaysData }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set(data.selected));
  // blank on the record means "same as selected" — the picker shows that
  // as everything checked, not empty, so it never LOOKS like zero mockups
  const [mockupPicked, setMockupPicked] = useState<Set<string>>(
    new Set(data.mockupColors.length > 0 ? data.mockupColors : data.selected)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Array<{ id: string; title: string }> | null>(null);
  const [lookingFor, setLookingFor] = useState<string | null>(null);

  async function pullFromPrintify(printifyProductId?: string, reconnect = false) {
    setBusy(true);
    setError(null);
    setCandidates(null);
    const res = await apiJson<{
      colorways?: string[];
      changed?: boolean;
      candidates?: Array<{ id: string; title: string }>;
      note?: string | null;
      lookingFor?: string;
    }>(`/api/listings/${data.listingId}/printify-sync`, "POST", { printifyProductId, reconnect });
    if (!res.ok) setError(res.error);
    else if (res.data.candidates) {
      setCandidates(res.data.candidates);
      setLookingFor(res.data.lookingFor ?? null);
      if (res.data.note) setNotice(res.data.note);
    } else {
      setPicked(new Set(res.data.colorways ?? []));
      setNotice(
        `Connected — mirroring ${res.data.colorways?.length ?? 0} colourways from Printify.` +
          (res.data.changed ? " Images and slots were marked stale to re-check." : "")
      );
      router.refresh();
    }
    setBusy(false);
  }
  const dirty =
    picked.size !== data.selected.length || data.selected.some((c) => !picked.has(c));

  function toggle(color: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiJson(`/api/listings/${data.listingId}`, "PATCH", {
      colorways: [...picked],
    });
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(false);
  }

  const savedMockupSet = new Set(data.mockupColors.length > 0 ? data.mockupColors : data.selected);
  const mockupDirty =
    mockupPicked.size !== savedMockupSet.size || [...savedMockupSet].some((c) => !mockupPicked.has(c));

  function toggleMockup(color: string) {
    setMockupPicked((cur) => {
      const next = new Set(cur);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
  }

  async function saveMockupColors() {
    setBusy(true);
    setError(null);
    const res = await apiJson(`/api/listings/${data.listingId}`, "PATCH", {
      mockupColors: [...mockupPicked],
    });
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(false);
  }

  if (data.colors.length === 0) return null;

  return (
    <div className="card supporting">
      {/* the garment first — two fan-out listings differ by exactly this */}
      <div className="card-title">{data.productName}</div>
      <Kicker>COLORWAYS</Kicker>
      <div className="hint">
        Mirror the variants you enabled in Printify. Mockup templates are offered in these colours only.
      </div>
      {data.printifyReady ? (
        <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-secondary" onClick={() => pullFromPrintify()} disabled={busy}>
            <Spinner active={busy} />
            {data.connected ? "Re-sync from Printify" : "Pull from Printify"}
          </button>
          {data.connected ? <span className="chip done">✓ connected</span> : null}
          {data.connected ? (
            <button
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "5px 10px" }}
              disabled={busy}
              onClick={() => pullFromPrintify(undefined, true)}
              title="Picked the wrong Printify product, or replaced it? Choose again."
            >
              Change product…
            </button>
          ) : null}
          {notice ? <span className="hint">{notice}</span> : null}
        </div>
      ) : null}
      {candidates ? (
        <div className="field" style={{ maxWidth: 420 }}>
          <label className="kicker" htmlFor="cw-candidate">WHICH PRINTIFY PRODUCT IS THIS LISTING?</label>
          {lookingFor ? (
            <span className="hint">Showing your {lookingFor} products — this listing&apos;s garment.</span>
          ) : null}
          <select
            id="cw-candidate"
            className="select"
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && pullFromPrintify(e.target.value)}
          >
            <option value="">Pick the product — the ID is stored until you change it</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
        {data.colors.map((color) => {
          const out = data.excluded.includes(color);
          const on = picked.has(color);
          return (
            <button
              key={color}
              className={`chip ${on ? "done" : "neutral"}`}
              style={{ cursor: out ? "not-allowed" : "pointer", opacity: out ? 0.45 : 1, border: on ? undefined : "1px solid #ddd6c2" }}
              disabled={busy || out}
              title={out ? "Ruled out by the design's garment compatibility" : undefined}
              onClick={() => toggle(color)}
            >
              {on ? "✓ " : ""}{color}
            </button>
          );
        })}
      </div>
      <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
          <Spinner active={busy} />
          Save colorways
        </button>
        <span className="hint">
          {picked.size} selected{dirty ? " — unsaved" : " · saved"}
        </span>
      </div>

      {/* A shop can sell more colours than it bothers to shoot mockups for.
          This does NOT change how many slots L5 seeds — that count is fixed
          by the seed template and garment compatibility. What it does is
          narrow which mockup TEMPLATES each L5 slot offers: a template
          tagged with a Garment Color outside this set stops being listed. */}
      <Kicker>MOCKUP COLORS</Kicker>
      <div className="hint">
        Which of the saved colorways to shoot mockups for — defaults to all of them. Narrows the
        template choices on each L5 slot; it doesn&apos;t add or remove slots.
      </div>
      <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
        {data.selected.map((color) => {
          const on = mockupPicked.has(color);
          return (
            <button
              key={color}
              className={`chip ${on ? "done" : "neutral"}`}
              style={{ cursor: "pointer", border: on ? undefined : "1px solid #ddd6c2" }}
              disabled={busy}
              onClick={() => toggleMockup(color)}
            >
              {on ? "✓ " : ""}{color}
            </button>
          );
        })}
      </div>
      <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-save" onClick={saveMockupColors} disabled={busy || !mockupDirty}>
          <Spinner active={busy} />
          Save mockup colors
        </button>
        <span className="hint">
          {mockupPicked.size} of {data.selected.length}{mockupDirty ? " — unsaved" : " · saved"}
        </span>
      </div>
      {error ? <div className="callout blocked">{error}</div> : null}
    </div>
  );
}
