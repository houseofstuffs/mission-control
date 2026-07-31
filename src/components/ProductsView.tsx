"use client";

/**
 * Products — reference data seeded from the Printify catalog (Phase 1 item 5).
 * Blueprint × print provider is the key (spec §3.3). Seeding writes to Notion
 * (system of record) then mirrors into the cache; the master-canvas math is
 * computed at seed time from real placeholder pixel dimensions.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiJson } from "@/lib/api";
import { Kicker } from "./ui";
import { CATEGORIES, CATEGORY_LABELS, categoryFromTitle, type Category } from "@/config/product-categories";

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
  /** Printify's catalog photo — CDN link stored at seed */
  imageUrl: string | null;
  category: Category | null;
  estimatedCost: number | null;
  sizeFilterApplied: string;
  costSampleSize: number;
  /** why there's no estimate, when there isn't one */
  costReason: string | null;
}

/** Uncategorised products still have to land somewhere — last, and named. */
const UNCATEGORISED = "__none__";
type GroupKey = Category | typeof UNCATEGORISED;

interface BlueprintOption {
  id: number;
  title: string;
  brand: string;
  model: string;
  image: string | null;
}

function groupLabel(key: GroupKey): string {
  return key === UNCATEGORISED ? "Uncategorised" : CATEGORY_LABELS[key];
}

/** One line, ellipsis on overflow — keeps the card header exactly two lines. */
const CLAMP: React.CSSProperties = {
  display: "block",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function ProductCard({
  p,
  busy,
  onCategory,
}: {
  p: ProductCardData;
  busy: boolean;
  onCategory: (category: string) => void;
}) {
  return (
    <div className="card" style={{ padding: 22, gap: 12 }}>
      <div className="row-gap-12" style={{ alignItems: "flex-start" }}>
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.imageUrl}
            alt=""
            width={100}
            height={100}
            style={{ borderRadius: 12, objectFit: "cover", background: "var(--surface-well)", flex: "0 0 auto" }}
          />
        ) : null}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
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
        </div>
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
      <div className="body-sm muted">
        {p.variantCount ?? 0} variants
        {p.estimatedCost != null ? (
          <>
            {" · est. "}${p.estimatedCost.toFixed(2)}
            {p.costMin != null && p.costMax != null && p.costMax !== p.costMin
              ? ` · range $${p.costMin.toFixed(2)}–$${p.costMax.toFixed(2)}`
              : ""}
          </>
        ) : null}
      </div>
      {/* Never a bare number: the averaging rule travels with the estimate,
          and when there isn't one, why not. */}
      <div className="hint" style={{ marginTop: -6 }}>
        {p.estimatedCost != null
          ? `${p.sizeFilterApplied} · ${p.costSampleSize} variants`
          : p.costReason}
      </div>
      <div className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
        {p.technique ? <span className="chip count">{p.technique}</span> : null}
        {!p.hasVoiceText ? <span className="chip stale">needs shop voice</span> : <span className="chip done">voice written</span>}
        {!p.category ? <span className="chip stale">needs category</span> : null}
        {/* The dropdown exists only while the category is missing — new seeds
            set it in the seed modal, so this is for the auto-map's misses and
            products seeded before categories existed. Once set, the group
            header carries the fact; a wrong one gets fixed in Notion. */}
        {!p.category ? (
          <select
            className="select"
            style={{ width: "auto", padding: "4px 8px", fontSize: 12, marginLeft: "auto" }}
            value=""
            disabled={busy}
            aria-label="Category"
            onChange={(e) => onCategory(e.target.value)}
          >
            <option value="">Set category…</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}

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
  const [seedCategory, setSeedCategory] = useState<string>("");

  const [filter, setFilter] = useState<GroupKey | "all">("all");
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);

  function toggle(key: GroupKey) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function setCategory(id: string, category: string) {
    setSavingId(id);
    setError(null);
    const res = await apiJson(`/api/products/${id}`, "PATCH", { category });
    if (!res.ok) setError(res.error);
    else router.refresh();
    setSavingId(null);
  }

  // Fixed order — Apparel, Home, Wall Art, Miscellaneous, then anything the
  // auto-map couldn't place. Empty groups don't render.
  const groups = useMemo(() => {
    const order: GroupKey[] = [...CATEGORIES, UNCATEGORISED];
    return order
      .filter((key) => filter === "all" || filter === key)
      .map((key) => [key, products.filter((p) => (p.category ?? UNCATEGORISED) === key)] as const)
      .filter(([, items]) => items.length > 0);
  }, [products, filter]);

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
    // pre-fill from the auto-map; a person can still overrule it here
    setSeedCategory(categoryFromTitle(chosen.title) ?? "");
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
    const res = await apiJson<Record<string, any>>("/api/printify/seed", "POST", {
        blueprintId: chosen.id,
        providerId,
        providerName: provider?.title ?? "",
        category: seedCategory || undefined,
      });
    const json = res.data;
    if (!res.ok) setError(res.error);
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

      {/* narrowing, independent of the grouped default below */}
      <div className="row-gap-8" style={{ flexWrap: "wrap", display: products.length === 0 ? "none" : undefined }}>
        {(["all", ...CATEGORIES, UNCATEGORISED] as const).map((key) => {
          const count =
            key === "all" ? products.length : products.filter((p) => (p.category ?? UNCATEGORISED) === key).length;
          if (count === 0 && key !== "all") return null;
          return (
            <button
              key={key}
              className={`chip${filter === key ? " done" : " count"}`}
              style={{ cursor: "pointer", border: "none", font: "inherit" }}
              onClick={() => setFilter(key)}
            >
              {key === "all" ? "All" : groupLabel(key)} {count}
            </button>
          );
        })}
      </div>

      {groups.map(([key, items]) => (
        <div key={key} className="stack-12">
          <button
            className="row-gap-8"
            style={{
              alignItems: "center",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              font: "inherit",
              textAlign: "left",
            }}
            onClick={() => toggle(key)}
            aria-expanded={!collapsed.has(key)}
          >
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {collapsed.has(key) ? "▶" : "▼"}
            </span>
            <Kicker>
              {groupLabel(key)} · {items.length}
            </Kicker>
          </button>
          {collapsed.has(key) ? null : (
            <div className="grid-cards">
              {items.map((p) => (
                <ProductCard
                  key={p.id}
                  p={p}
                  busy={savingId === p.id}
                  onCategory={(category) => setCategory(p.id, category)}
                />
              ))}
            </div>
          )}
        </div>
      ))}

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
                <div className="field">
                  <label className="kicker" htmlFor="bp-category">CATEGORY</label>
                  <select id="bp-category" className="select" value={seedCategory}
                    onChange={(e) => setSeedCategory(e.target.value)}>
                    <option value="">Not sure — decide later</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                  <span className="hint">
                    {seedCategory
                      ? "Guessed from the blueprint name — change it if it's wrong."
                      : "Nothing matched this blueprint name. Set it now or from the card later."}
                  </span>
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
