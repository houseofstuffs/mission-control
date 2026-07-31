"use client";

/**
 * C9's work surface — the step stops being a bare checkbox.
 *
 * Fan out = this design graduates into listings, one per product. Pick the
 * products; each becomes a Listing (created through the same route as the
 * manual button: slots seeded, log written) pointed at this design. Products
 * whose print shape differs from the master canvas get a "recompose" chip —
 * scaling is scripted, recomposition is hand work, and knowing which is
 * which IS the fan-out decision.
 *
 * Known Phase-2 gap, on purpose: the per-product print FILES still live
 * only in your Drive — the derivatives database that will track them is
 * specced but not built.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker, Spinner } from "./ui";
import { apiJson } from "@/lib/api";

export interface FanOutProduct {
  id: string;
  label: string;
  category: string | null;
  isPrimary: boolean;
  /** print shape differs enough from the master canvas to need re-layout */
  needsRecompose: boolean;
  /** listing already pointing design × product, when one exists */
  listingId: string | null;
  listingTitle: string | null;
}

export interface FanOutData {
  designId: string;
  designTitle: string;
  kind: string; // Physical | Digital
  products: FanOutProduct[];
}

export function FanOutPanel({ data }: { data: FanOutData }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function toggle(id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function graduate() {
    setBusy(true);
    setError(null);
    const targets = data.products.filter((p) => picked.has(p.id));
    let made = 0;
    const failed: string[] = [];
    for (const p of targets) {
      setNotice(`Creating listing ${made + 1}/${targets.length} — ${p.label}…`);
      const res = await apiJson<{ record?: { id: string } }>("/api/listings", "POST", {
        name: `${data.designTitle} — ${p.label}`,
        designIds: [data.designId],
        productId: p.id,
        kind: data.kind,
      });
      if (!res.ok) failed.push(`${p.label}: ${res.error}`);
      else made++;
    }
    setNotice(made > 0 ? `Created ${made} listing${made === 1 ? "" : "s"} — they're on the Listings page at L1.` : null);
    setError(failed.length ? failed.join("\n") : null);
    setPicked(new Set());
    router.refresh();
    setBusy(false);
  }

  const listed = data.products.filter((p) => p.listingId);

  return (
    <div className="card supporting stack-12">
      <Kicker>FAN OUT — GRADUATE INTO LISTINGS</Kicker>
      <div className="hint">
        One listing per product, each pointing at this design. Slots seed automatically; every
        listing starts its own L1–L7 run. &quot;recompose&quot; means the print shape differs from
        the master canvas — that retrofit is hand work before its listing can generate images.
      </div>

      {listed.length > 0 ? (
        <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
          {listed.map((p) => (
            <a key={p.id} className="chip done" href={`/listings/${p.listingId}`} title={p.listingTitle ?? undefined}>
              ✓ {p.label}
            </a>
          ))}
        </div>
      ) : null}

      <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
        {data.products
          .filter((p) => !p.listingId)
          .map((p) => {
            const on = picked.has(p.id);
            return (
              <button
                key={p.id}
                className={`chip ${on ? "done" : "neutral"}`}
                style={{ cursor: "pointer" }}
                disabled={busy}
                onClick={() => toggle(p.id)}
                title={p.needsRecompose ? "Print shape differs from the master canvas — needs recomposition, not scaling." : undefined}
              >
                {on ? "✓ " : ""}
                {p.label}
                {p.isPrimary ? " · primary" : ""}
                {p.needsRecompose ? " · recompose" : ""}
              </button>
            );
          })}
      </div>

      <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary" onClick={graduate} disabled={busy || picked.size === 0}>
          <Spinner active={busy} />
          Create {picked.size || ""} listing{picked.size === 1 ? "" : "s"}
        </button>
        {notice ? <span className="hint">{notice}</span> : null}
      </div>
      {error ? <div className="callout blocked" style={{ whiteSpace: "pre-wrap" }}>{error}</div> : null}
    </div>
  );
}
