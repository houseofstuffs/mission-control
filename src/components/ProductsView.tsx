"use client";

/**
 * Products — reference data seeded from the Printify catalog (Phase 1 item 5).
 * Blueprint × print provider is the key (spec §3.3). Seeding writes to Notion
 * (system of record) then mirrors into the cache; the master-canvas math is
 * computed at seed time from real placeholder pixel dimensions.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";

export interface ProductCardData {
  id: string;
  name: string;
  /** {Brand} {SHORT WORD} {Model} — the dashboard headline */
  shortName: string;
  blueprintTitle: string;
  technique: string | null;
  blueprintId: number | null;
  providerId: number | null;
  providerName: string;
  maxW: number | null;
  maxH: number | null;
  ratios: string;
  recompose: boolean;
  costMin: number | null;
  costMax: number | null;
  variantCount: number | null;
  syncedAt: string | null;
  hasVoiceText: boolean;
}

interface BlueprintOption {
  id: number;
  title: string;
  brand: string;
  model: string;
  image: string | null;
}

/** One line, ellipsis on overflow — keeps the card header exactly two lines. */
const CLAMP: React.CSSProperties = {
  display: "block",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

export function ProductsView({ products, printifyReady }: { products: ProductCardData[]; printifyReady: boolean }) {
  const router = useRouter();
  const [seeding, setSeeding] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [blueprints, setBlueprints] = useState<BlueprintOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<BlueprintOption | null>(null);
  const [providers, setProviders] = useState<Array<{ id: number; title: string }> | null>(null);
  const [providerId, setProviderId] = useState<number | null>(null);

  useEffect(() => {
    if (!showSeed || blueprints) return;
    fetch("/api/printify/blueprints")
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setError(json.error);
        else setBlueprints(json.blueprints);
      })
      .catch((e) => setError(String(e)));
  }, [showSeed, blueprints]);

  useEffect(() => {
    if (!chosen) return;
    setProviders(null);
    setProviderId(null);
    fetch(`/api/printify/blueprints/${chosen.id}/providers`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setError(json.error);
        else setProviders(json.providers);
      })
      .catch((e) => setError(String(e)));
  }, [chosen]);

  const filtered = useMemo(() => {
    if (!blueprints) return [];
    const q = query.toLowerCase().trim();
    if (!q) return blueprints.slice(0, 30);
    return blueprints
      .filter((b) => `${b.brand} ${b.model} ${b.title}`.toLowerCase().includes(q))
      .slice(0, 30);
  }, [blueprints, query]);

  async function seed() {
    if (!chosen || !providerId) return;
    const provider = providers?.find((p) => p.id === providerId);
    setSeeding(true);
    setError(null);
    const res = await fetch("/api/printify/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blueprintId: chosen.id,
        providerId,
        providerName: provider?.title ?? "",
      }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Seed failed");
    else {
      setNotice(
        `${json.result.updated ? "Updated" : "Seeded"} ${json.result.productName} with ${json.result.variantCount} variants.`
      );
      setShowSeed(false);
      setChosen(null);
      router.refresh();
    }
    setSeeding(false);
  }

  return (
    <div className="stack-22">
      <div className="row-gap-12">
        <button className="btn btn-primary" onClick={() => setShowSeed(true)} disabled={!printifyReady}>
          Seed a product from Printify
        </button>
        {!printifyReady ? (
          <span className="hint">Set PRINTIFY_API_TOKEN to browse the catalog.</span>
        ) : null}
      </div>

      {notice ? <div className="callout stale" style={{ background: "#eef8f4", borderColor: "#68c2a9", color: "#134a3a" }}>{notice}</div> : null}
      {error ? <div className="callout blocked">{error}</div> : null}

      <div className="grid-cards">
        {products.map((p) => (
          <div key={p.id} className="card" style={{ padding: 22, gap: 12 }}>
            {/* Exactly two lines: title on 1, vendor on 2. Both clamp with an
                ellipsis rather than wrapping, so the vendor can never be
                pushed to a third line. Full text on hover. */}
            <Kicker>
              <span style={CLAMP} title={p.blueprintTitle || p.name}>
                {p.blueprintTitle || p.name}
              </span>
              <span style={{ ...CLAMP, color: "var(--status-done)" }} title={p.providerName}>
                {p.providerName}
              </span>
            </Kicker>
            <div className="panel-title" style={{ color: "var(--text-primary)", fontSize: 16 }}>
              {p.shortName || p.name}
            </div>
            <div className="body-sm muted">
              blueprint {p.blueprintId ?? "—"} × provider {p.providerId ?? "—"}
            </div>
            <div className="well">
              <Kicker>MASTER CANVAS</Kicker>
              <div className="body-sm" style={{ marginTop: 6 }}>
                {p.maxW && p.maxH ? (
                  <>
                    max {p.maxW} × {p.maxH}px
                    <br />
                    {p.ratios}
                  </>
                ) : (
                  "no print areas recorded"
                )}
              </div>
            </div>
            <div className="body-sm">
              {p.variantCount ?? 0} variants
              {p.costMin != null
                ? ` · base cost $${p.costMin.toFixed(2)}${p.costMax != null && p.costMax !== p.costMin ? `–$${p.costMax.toFixed(2)}` : ""}`
                : " · base cost: add in Notion (not in Printify's public catalog)"}
            </div>
            <div className="row-gap-8">
              {p.technique ? <span className="chip count">{p.technique}</span> : null}
              {!p.hasVoiceText ? <span className="chip stale">needs shop voice</span> : <span className="chip done">voice written</span>}
            </div>
          </div>
        ))}
      </div>

      {showSeed ? (
        <div className="modal-scrim" onClick={() => setShowSeed(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-title">Seed from Printify catalog</div>
            {!chosen ? (
              <>
                <div className="field">
                  <label className="kicker" htmlFor="bp-search">SEARCH BLUEPRINTS</label>
                  <input id="bp-search" className="input" placeholder="e.g. Bella Canvas 3001"
                    value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
                </div>
                {!blueprints ? (
                  <div className="stack-12">
                    <div className="skeleton" style={{ height: 40 }} />
                    <div className="skeleton" style={{ height: 40 }} />
                    <div className="skeleton" style={{ height: 40 }} />
                  </div>
                ) : (
                  <div className="stack-12" style={{ maxHeight: 320, overflow: "auto" }}>
                    {filtered.map((b) => (
                      <button key={b.id} className="well" style={{ textAlign: "left", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13.5 }}
                        onClick={() => setChosen(b)}>
                        <strong>{b.brand} {b.model}</strong> — {b.title}
                      </button>
                    ))}
                    {filtered.length === 0 ? <div className="hint">No blueprints match.</div> : null}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="well">
                  <strong>{chosen.brand} {chosen.model}</strong> — {chosen.title}
                </div>
                <div className="field">
                  <label className="kicker" htmlFor="bp-provider">PRINT PROVIDER</label>
                  {!providers ? (
                    <div className="skeleton" style={{ height: 40 }} />
                  ) : (
                    <select id="bp-provider" className="select" value={providerId ?? ""}
                      onChange={(e) => setProviderId(Number(e.target.value))}>
                      <option value="" disabled>Choose a provider — same shirt, different print areas and costs</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="row-gap-12">
                  <button className="btn btn-primary" onClick={seed} disabled={!providerId || seeding}>
                    {seeding ? <span className="spinner" /> : null}
                    {seeding ? "Seeding (writes to Notion)" : "Seed product + variants"}
                  </button>
                  <button className="btn btn-tertiary" onClick={() => setChosen(null)}>← Different blueprint</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
