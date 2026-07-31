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
  /** every colour the product offers */
  colors: string[];
  /** colours the design's garment compatibility rules out */
  excluded: string[];
  /** current selection on the record */
  selected: string[];
}

export function ColorwaysPanel({ data }: { data: ColorwaysData }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set(data.selected));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  if (data.colors.length === 0) return null;

  return (
    <div className="card supporting">
      <Kicker>COLORWAYS — WHAT THIS LISTING SELLS</Kicker>
      <div className="hint">
        Mirror the variants you enabled in Printify. Mockup templates are offered in these colours only.
      </div>
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
        <span className="hint">{picked.size} selected</span>
      </div>
      {error ? <div className="callout blocked">{error}</div> : null}
    </div>
  );
}
