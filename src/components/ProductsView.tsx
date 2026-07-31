"use client";

/**
 * Products — reference data seeded from the Printify catalog (Phase 1 item 5).
 * Blueprint × print provider is the key (spec §3.3). Seeding writes to Notion
 * (system of record) then mirrors into the cache; the master-canvas math is
 * computed at seed time from real placeholder pixel dimensions.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, apiJson } from "@/lib/api";
import { Kicker } from "./ui";
import { CATEGORIES, CATEGORY_LABELS, categoryFromTitle, type Category } from "@/config/product-categories";

export interface ProductCardData {
  id: string;
  name: string;
  /** line one of the card title — the garment brand */
  brandLine: string;
  /** line two — the specific product ("SWEATSHIRT 1466") */
  productLine: string;
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
  /** the saved boilerplate itself — prefills the voice editor */
  voiceText: string;
  /** Printify's catalog photo — CDN link stored at seed */
  imageUrl: string | null;
  category: Category | null;
  /** stored on the record, with the method that produced it */
  estimatedCost: number | null;
  costMethod: string | null;
  costVariantCount: number | null;
  costPulledAt: string | null;
  /** why there's no estimate, when there isn't one */
  costReason: string | null;
  needsRepresentative: boolean;
  representativeVariantId: string | null;
  /** true once probe or hand-entered costs exist */
  hasCosts: boolean;
  /** wall_art only: options for the representative-size picker */
  variantOptions: Array<{ id: string; label: string }>;
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
  onRepresentative,
  onVoice,
}: {
  p: ProductCardData;
  busy: boolean;
  onCategory: (category: string) => void;
  onRepresentative: (variantId: string) => void;
  onVoice: () => void;
}) {
  // the method means something different per value — say so on hover
  const methodExplained =
    p.costMethod === "Representative size"
      ? "one chosen size's cost, used directly"
      : p.costMethod === "Core size average"
        ? "average of S–2XL only, the sizes that carry apparel volume"
        : p.costMethod === "Full average"
          ? "average across every variant"
          : null;
  const methodTitle =
    p.estimatedCost != null && methodExplained
      ? `${p.costMethod} (${methodExplained})${p.costVariantCount ? ` · ${p.costVariantCount} variant${p.costVariantCount === 1 ? "" : "s"}` : ""}${p.costPulledAt ? ` · pulled ${p.costPulledAt}` : ""}`
      : undefined;
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
          {/* brand on its own line, the specific product under it */}
          <div className="panel-title" style={{ color: "var(--text-primary)", fontSize: 16 }}>
            <span style={CLAMP} title={p.brandLine}>{p.brandLine}</span>
            <span style={CLAMP} title={p.productLine}>{p.productLine}</span>
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
      {/* Method, count and pull date ride in the tooltip — the line stays
          clean, the transparency is one hover away. */}
      <div className="body-sm muted" title={methodTitle}>
        {p.variantCount ?? 0} variants
        {p.estimatedCost != null ? (
          <>
            {" · est. "}
            <strong>${p.estimatedCost.toFixed(2)}</strong>
            {p.costMin != null && p.costMax != null && p.costMax !== p.costMin
              ? ` · range $${p.costMin.toFixed(2)}–$${p.costMax.toFixed(2)}`
              : ""}
          </>
        ) : null}
      </div>
      {p.estimatedCost == null ? (
        <div className="hint" style={{ marginTop: -6 }}>{p.costReason}</div>
      ) : null}
      {/* wall_art without its anchor: same treatment as needs-shop-voice,
          plus the picker that resolves it in place */}
      {p.needsRepresentative ? (
        <div className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <span className="chip stale">needs representative size</span>
          <select
            className="select"
            style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
            value=""
            disabled={busy}
            aria-label="Representative size"
            onChange={(e) => e.target.value && onRepresentative(e.target.value)}
          >
            <option value="">Pick the size this sells as…</option>
            {p.variantOptions.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
        {p.technique ? <span className="chip count">{p.technique}</span> : null}
        {/* the chip is the door to the voice editor. Quiet (neutral, not
            yellow) when unwritten — missing boilerplate matters at L2, where
            the description gets stitched, not at product intake. */}
        <button
          type="button"
          className={`chip ${p.hasVoiceText ? "done" : "neutral"}`}
          style={{ cursor: "pointer" }}
          disabled={busy}
          title={
            p.hasVoiceText
              ? "Edit the fit/fabric/care boilerplate every listing on this garment reuses"
              : "Generate the fit/fabric/care boilerplate — once per product, reused by every listing. Only needed once a listing reaches L2."
          }
          onClick={onVoice}
        >
          {p.hasVoiceText ? "edit shop voice ✎" : "write shop voice"}
        </button>
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

export function ProductsView({
  products,
  printifyReady,
  anthropicReady,
}: {
  products: ProductCardData[];
  printifyReady: boolean;
  anthropicReady: boolean;
}) {
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
  const [backfilling, setBackfilling] = useState(false);

  async function backfillImages() {
    setBackfilling(true);
    setError(null);
    const res = await apiCall<{ filled?: number; skipped?: string[] }>(
      "/api/printify/backfill-images",
      { method: "POST" }
    );
    if (!res.ok) setError(res.error);
    else {
      const skipped = res.data.skipped ?? [];
      setNotice(
        `Fetched ${res.data.filled ?? 0} thumbnail${res.data.filled === 1 ? "" : "s"} from the Printify catalog.` +
          (skipped.length ? ` No catalog photo for: ${skipped.join(", ")}.` : "")
      );
      router.refresh();
    }
    setBackfilling(false);
  }

  function toggle(key: GroupKey) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function patchProduct(id: string, body: Record<string, unknown>) {
    setSavingId(id);
    setError(null);
    const res = await apiJson(`/api/products/${id}`, "PATCH", body);
    if (!res.ok) setError(res.error);
    else router.refresh();
    setSavingId(null);
  }

  // the voice editor — one modal, whichever card opened it
  const [voiceFor, setVoiceFor] = useState<ProductCardData | null>(null);
  const [voiceDraft, setVoiceDraft] = useState("");
  // the last PERSISTED text — dirtiness is measured against this, and
  // generation auto-saves into it so an accidental close loses nothing
  const [voiceSaved, setVoiceSaved] = useState("");
  const [voiceNotes, setVoiceNotes] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState<"generate" | "save" | null>(null);
  const voiceArea = useRef<HTMLTextAreaElement>(null);
  const voiceDirty = voiceDraft !== voiceSaved;

  // height follows the text: fit the whole draft plus ~2 rows of editing
  // room, capped so long boilerplate scrolls inside instead of pushing the
  // save button off screen
  useEffect(() => {
    const el = voiceArea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 48, Math.round(window.innerHeight * 0.55))}px`;
  }, [voiceDraft, voiceFor]);

  function openVoice(p: ProductCardData) {
    setVoiceFor(p);
    setVoiceDraft(p.voiceText);
    setVoiceSaved(p.voiceText);
    setVoiceNotes(null);
    setError(null);
  }

  function closeVoice(force = false) {
    if (voiceBusy !== null) return;
    if (voiceDirty && !force) return; // scrim clicks can't eat unsaved edits
    setVoiceFor(null);
  }

  /** generate AND persist in one motion — the draft is real the moment it
   *  exists, so closing the window can never lose a generation again.
   *  Edits after that save with the button. */
  async function generateVoice() {
    if (!voiceFor) return;
    setVoiceBusy("generate");
    setError(null);
    const res = await apiCall<{ draft?: string; notes?: string }>(
      `/api/products/${voiceFor.id}/generate-voice`,
      { method: "POST" }
    );
    if (!res.ok) {
      setError(res.error);
      setVoiceBusy(null);
      return;
    }
    const draft = (res.data.draft ?? "").trim();
    setVoiceDraft(draft);
    setVoiceNotes(res.data.notes || null);
    const save = await apiJson(`/api/products/${voiceFor.id}`, "PATCH", { shopVoiceText: draft });
    if (!save.ok) {
      setError(`Generated but not saved yet — ${save.error}. Use the save button.`);
    } else {
      setVoiceSaved(draft);
      setVoiceNotes((n) => [n, "Saved automatically — edits below save with the button."].filter(Boolean).join(" "));
      router.refresh();
    }
    setVoiceBusy(null);
  }

  async function saveVoice() {
    if (!voiceFor || !voiceDraft.trim()) return;
    setVoiceBusy("save");
    setError(null);
    const res = await apiJson(`/api/products/${voiceFor.id}`, "PATCH", { shopVoiceText: voiceDraft.trim() });
    if (!res.ok) setError(res.error);
    else {
      setNotice(`Shop voice saved for ${voiceFor.brandLine} ${voiceFor.productLine} — every listing on this garment reuses it.`);
      setVoiceFor(null);
      router.refresh();
    }
    setVoiceBusy(null);
  }

  const [pulling, setPulling] = useState(false);
  // one date for the row: pulls run as a batch, so the newest stamp speaks
  // for the set
  const lastPulled = products.reduce<string | null>(
    (max, p) => (p.costPulledAt && (!max || p.costPulledAt > max) ? p.costPulledAt : max),
    null
  );

  /** One product per request — a 231-variant catalog probes in chunks and
   *  would time out as a single batch. Sequential, with running progress. */
  async function pullAllCosts() {
    setPulling(true);
    setError(null);
    const targets = products.filter((p) => p.blueprintId && p.providerId);
    let done = 0;
    // One product failing must never strand the ones behind it — collect
    // every failure and keep going, then name each one with its reason.
    const failed: string[] = [];
    for (const [i, t] of targets.entries()) {
      setNotice(`Pulling costs ${i + 1}/${targets.length} — ${t.productLine}…`);
      const res = await apiJson(`/api/printify/pull-costs`, "POST", { productId: t.id });
      if (!res.ok) failed.push(`${t.productLine}: ${res.error}`);
      else done++;
    }
    setNotice(done > 0 ? `Pulled account-level costs for ${done} of ${targets.length} products.` : null);
    setError(failed.length > 0 ? `Couldn't pull ${failed.length}:\n${failed.join("\n")}` : null);
    router.refresh();
    setPulling(false);
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
      <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => setShowSeed(true)} disabled={!printifyReady}>
          Seed a product from Printify
        </button>
        {printifyReady && products.length > 0 ? (
          <>
            <button className="btn btn-secondary" onClick={pullAllCosts} disabled={pulling}>
              {pulling ? <span className="spinner" /> : null}
              {products.some((p) => p.hasCosts) ? "Re-pull costs" : "Pull costs from Printify"}
            </button>
            {lastPulled && !pulling ? <span className="hint">costs pulled {lastPulled}</span> : null}
          </>
        ) : null}
        {/* only exists while a product lacks its catalog photo — products
            seeded before thumbnails. One click, then it disappears. */}
        {printifyReady && products.some((p) => !p.imageUrl) ? (
          <button className="btn btn-secondary" onClick={backfillImages} disabled={backfilling}>
            {backfilling ? <span className="spinner" /> : null}
            Fetch missing thumbnails
          </button>
        ) : null}
        {!printifyReady ? (
          <span className="hint">Set PRINTIFY_API_TOKEN to browse the catalog.</span>
        ) : null}
      </div>

      {notice ? <div className="callout stale" style={{ background: "#eef8f4", borderColor: "#68c2a9", color: "#134a3a" }}>{notice}</div> : null}
      {error ? <div className="callout blocked" style={{ whiteSpace: "pre-wrap" }}>{error}</div> : null}

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
                  onCategory={(category) => patchProduct(p.id, { category })}
                  onRepresentative={(variantId) =>
                    patchProduct(p.id, { representativeVariantId: variantId })
                  }
                  onVoice={() => openVoice(p)}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      {voiceFor ? (
        // scrim clicks close only when nothing is unsaved — three lost
        // generations taught us that lesson
        <div className="modal-scrim" onClick={() => closeVoice()}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 768 }}>
            <div className="card-title">
              {voiceFor.brandLine} {voiceFor.productLine}
            </div>
            <Kicker>SHOP VOICE BOILERPLATE</Kicker>
            <span className="hint">
              Fit, fabric, sizing and care in the STUFFS voice — written once per product, stitched
              under every listing&apos;s hook. Never mentions a design.
            </span>
            <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
              {anthropicReady ? (
                <button className="btn btn-secondary" onClick={generateVoice} disabled={voiceBusy !== null}>
                  {voiceBusy === "generate" ? <span className="spinner" /> : null}
                  {voiceDraft.trim() ? "Regenerate draft" : "Generate draft"}
                </button>
              ) : (
                <span className="hint">Set ANTHROPIC_API_KEY to generate — or write it by hand below.</span>
              )}
              {voiceNotes ? <span className="hint">{voiceNotes}</span> : null}
            </div>
            <textarea
              ref={voiceArea}
              className="input"
              rows={6}
              value={voiceDraft}
              placeholder="Fabric, fit, sizing, care — true of this garment whatever's printed on it."
              style={{ overflowY: "auto", resize: "vertical" }}
              onChange={(e) => setVoiceDraft(e.target.value)}
            />
            <div className="row-gap-12" style={{ alignItems: "center" }}>
              <button
                className="btn btn-primary"
                onClick={saveVoice}
                disabled={voiceBusy !== null || !voiceDraft.trim() || !voiceDirty}
              >
                {voiceBusy === "save" ? <span className="spinner" /> : null}
                {voiceSaved.trim() ? "Save edits" : "Save shop voice"}
              </button>
              <button
                className="btn btn-tertiary"
                disabled={voiceBusy !== null}
                onClick={() => {
                  if (!voiceDirty || window.confirm("Discard unsaved edits? The last saved version stays on the product.")) {
                    closeVoice(true);
                  }
                }}
              >
                {voiceDirty ? "Cancel" : "Close"}
              </button>
              {voiceDirty ? <span className="hint">Unsaved edits</span> : voiceSaved.trim() ? <span className="hint">Saved</span> : null}
            </div>
          </div>
        </div>
      ) : null}

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
