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
  /** distinct colours — the figure the Library, L4 and L5 all speak in */
  colourCount: number;
  sizeCount: number;
  /** provider print resolution; null = 300 assumed (and labelled so) */
  printDpi: number | null;
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
  /** what Printify bills to ship one unit, US domestic — the L3 calculator's default */
  estimatedShippingCost: number | null;
  shippingPulledAt: string | null;
  /** which synced Etsy Shipping Profile applies — sets what the BUYER is charged */
  etsyShippingProfileId: string | null;
  etsyShippingCharged: number | null;
  /** reusable per-blueprint graphic cards — L5 auto-fills the matching named slot from these */
  highlightsSizingGraphicLink: string;
  carePoliciesGraphicLink: string;
  colorwaysGraphicLink: string;
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

type GraphicLinkField = "highlightsSizingGraphicLink" | "carePoliciesGraphicLink" | "colorwaysGraphicLink";

/** How many catalog matches the seed picker renders at once. Printify's
 *  catalog runs to hundreds; the list is scrollable, not paginated. */
const BLUEPRINT_RESULT_CAP = 60;

export interface ShippingProfileOption {
  id: string;
  name: string;
  /** what a US buyer is charged — null when the profile has no US destination row */
  usCharge: number | null;
}

function ProductCard({
  p,
  busy,
  shippingProfiles,
  onCategory,
  onRepresentative,
  onVoice,
  onGraphicLink,
  onShippingProfile,
}: {
  p: ProductCardData;
  busy: boolean;
  shippingProfiles: ShippingProfileOption[];
  onCategory: (category: string) => void;
  onRepresentative: (variantId: string) => void;
  onVoice: () => void;
  onGraphicLink: (field: GraphicLinkField, value: string) => void;
  onShippingProfile: (profileId: string) => void;
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
              max {p.maxW} × {p.maxH}px ≈{" "}
              <strong>
                {(p.maxW / (p.printDpi ?? 300)).toFixed(p.maxW % (p.printDpi ?? 300) ? 1 : 0)} ×{" "}
                {(p.maxH / (p.printDpi ?? 300)).toFixed(p.maxH % (p.printDpi ?? 300) ? 1 : 0)} in
              </strong>{" "}
              <span title={p.printDpi ? `at the product's Print DPI` : "at 300 DPI, the DTG standard — set Print DPI on the product if this provider differs"}>
                @ {p.printDpi ?? 300} DPI{p.printDpi ? "" : "*"}
              </span>
              {p.ratios ? (
                <>
                  <br />
                  {/* "aspect w:h" spelled out — a bare "front: 22:25" once
                      got read as 22.25 INCHES, and that number nearly went
                      into a print-size field */}
                  aspect (w:h) · {p.ratios}
                </>
              ) : null}
            </>
          ) : (
            "no print areas recorded"
          )}
        </div>
      </div>
      {/* Colours, not variants: colour × size rows are a number nobody
          works in, while every mockup screen counts colours. The size and
          row counts stay one hover away.
          Method, count and pull date ride in the tooltip too — the line
          stays clean, the transparency is one hover away. */}
      <div
        className="body-sm muted"
        title={[
          p.sizeCount > 0 ? `${p.sizeCount} size${p.sizeCount === 1 ? "" : "s"}` : null,
          `${p.variantCount ?? 0} colour × size variant${(p.variantCount ?? 0) === 1 ? "" : "s"}`,
          methodTitle,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        {p.colourCount} {p.colourCount === 1 ? "colour" : "colours"}
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
      {p.estimatedShippingCost != null ? (
        <div
          className="body-sm muted"
          style={{ marginTop: -6 }}
          title={p.shippingPulledAt ? `Printify catalog, US domestic · pulled ${p.shippingPulledAt}` : "Printify catalog, US domestic"}
        >
          ship <strong>${p.estimatedShippingCost.toFixed(2)}</strong>
        </div>
      ) : null}
      {/* the buyer's side of shipping — Etsy assigns a profile per LISTING,
          so this is only ever a default L3 pre-fills from, never a push */}
      {shippingProfiles.length > 0 ? (
        <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <span className="chip neutral" style={{ fontSize: 11 }}>Etsy shipping</span>
          {/* full width on its own line — sharing the row with the chip
              squeezed the option text and clipped the rate, which is the
              part worth reading */}
          <select
            className="select input-compact"
            style={{ flex: "1 1 100%", fontSize: 12 }}
            value={p.etsyShippingProfileId ?? ""}
            disabled={busy}
            aria-label="Etsy shipping profile"
            onChange={(e) => onShippingProfile(e.target.value)}
          >
            {/* a real choice, not prompt text — picking it clears the
                relation. The chip above carries the field's name so this
                doesn't have to double as a label. */}
            <option value="">— none —</option>
            {shippingProfiles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.usCharge != null ? ` — $${s.usCharge.toFixed(2)}` : " — no US rate"}
              </option>
            ))}
          </select>
          {p.etsyShippingProfileId && p.etsyShippingCharged == null ? (
            <span className="chip stale" style={{ fontSize: 11 }} title="This profile has no US destination row, so L3 can't pre-fill what the buyer pays.">
              no US rate
            </span>
          ) : null}
        </div>
      ) : null}
      {/* reusable per-blueprint graphic cards — L5 auto-fills the matching
          named slot (size chart, care info, colorways) from these on every
          listing that uses this product */}
      <div className="stack-8">
        <GraphicLinkRow
          productId={p.id}
          field="highlights"
          label="Highlights & sizing"
          value={p.highlightsSizingGraphicLink}
          busy={busy}
          onSave={(v) => onGraphicLink("highlightsSizingGraphicLink", v)}
        />
        <GraphicLinkRow
          productId={p.id}
          field="care"
          label="Care & policies"
          value={p.carePoliciesGraphicLink}
          busy={busy}
          onSave={(v) => onGraphicLink("carePoliciesGraphicLink", v)}
        />
        <GraphicLinkRow
          productId={p.id}
          field="colorways"
          label="Colorways"
          value={p.colorwaysGraphicLink}
          busy={busy}
          onSave={(v) => onGraphicLink("colorwaysGraphicLink", v)}
        />
      </div>
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

function GraphicLinkRow({
  productId,
  field,
  label,
  value,
  busy,
  onSave,
}: {
  productId: string;
  /** the graphic-thumb route's field key */
  field: "highlights" | "care" | "colorways";
  label: string;
  value: string;
  busy: boolean;
  onSave: (value: string) => void;
}) {
  // filled rows collapse to asset-first: thumbnail + ✓ pill, no raw URL —
  // the link's job is done once it's saved, and a long Drive URL neither
  // identifies the graphic nor survives at card width. ✎ reopens the field.
  const [editing, setEditing] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);

  if (value && !editing) {
    return (
      <div className="row-gap-8 hover-scope" style={{ alignItems: "center" }}>
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          title={`Open the ${label.toLowerCase()} graphic`}
          style={{
            width: 40,
            height: 40,
            flex: "none",
            borderRadius: 8,
            overflow: "hidden",
            background: "var(--surface-sunk, #f4efe2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid var(--border-soft, #e7e2d6)",
          }}
        >
          {thumbBroken ? (
            <span aria-hidden style={{ fontSize: 15 }}>↗</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/products/${productId}/graphic-thumb?field=${field}&v=${encodeURIComponent(value)}`}
              alt={`${label} graphic`}
              loading="lazy"
              onError={() => setThumbBroken(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </a>
        <a href={value} target="_blank" rel="noreferrer" className="chip done" style={{ fontSize: 11, textDecoration: "none" }}>
          {label} ✓
        </a>
        <button
          type="button"
          className="btn btn-tertiary hover-reveal"
          style={{ fontSize: 11, padding: "2px 8px" }}
          title={`Edit or replace the ${label.toLowerCase()} link`}
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          ✎
        </button>
      </div>
    );
  }

  return (
    <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
      {value ? (
        <span className="chip done" style={{ fontSize: 11 }}>{label} ✓</span>
      ) : (
        <span className="chip stale" style={{ fontSize: 11 }}>needs {label.toLowerCase()} graphic</span>
      )}
      {/* full width, so the field always sits under its own chip. At a
          narrower basis the rows wrapped differently per chip length —
          one field detached from its label and read as belonging to the
          row below it. */}
      <input
        className="input input-compact"
        style={{ flex: "1 1 100%", fontSize: 12 }}
        placeholder={`${label} graphic link…`}
        defaultValue={value}
        disabled={busy}
        autoFocus={editing}
        onBlur={(e) => {
          if (e.target.value !== value) onSave(e.target.value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
      />
    </div>
  );
}

export function ProductsView({
  products,
  printifyReady,
  anthropicReady,
  shippingProfiles = [],
}: {
  products: ProductCardData[];
  printifyReady: boolean;
  anthropicReady: boolean;
  /** synced Etsy profiles — empty until Etsy is connected and synced */
  shippingProfiles?: ShippingProfileOption[];
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

  const [pullingShipping, setPullingShipping] = useState(false);
  const lastShippingPulled = products.reduce<string | null>(
    (max, p) => (p.shippingPulledAt && (!max || p.shippingPulledAt > max) ? p.shippingPulledAt : max),
    null
  );

  /** Catalog endpoint, no shop needed — still one request per product so a
   *  single blueprint's failure can't strand the rest of the batch. */
  async function pullAllShipping() {
    setPullingShipping(true);
    setError(null);
    const targets = products.filter((p) => p.blueprintId && p.providerId);
    let done = 0;
    const failed: string[] = [];
    for (const [i, t] of targets.entries()) {
      setNotice(`Pulling shipping ${i + 1}/${targets.length} — ${t.productLine}…`);
      const res = await apiJson(`/api/printify/pull-shipping`, "POST", { productId: t.id });
      if (!res.ok) failed.push(`${t.productLine}: ${res.error}`);
      else done++;
    }
    setNotice(done > 0 ? `Pulled shipping cost for ${done} of ${targets.length} products.` : null);
    setError(failed.length > 0 ? `Couldn't pull ${failed.length}:\n${failed.join("\n")}` : null);
    router.refresh();
    setPullingShipping(false);
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

  // Every blueprint that matches, before the render cap — the cap has to
  // be able to say what it's hiding. Silently showing the first N read as
  // "Printify doesn't carry this", which is a very different conclusion
  // from "narrow your search".
  const matches = useMemo(() => {
    if (!blueprints) return [];
    const q = query.toLowerCase().trim();
    if (!q) return blueprints;
    return blueprints.filter((b) => `${b.brand} ${b.model} ${b.title}`.toLowerCase().includes(q));
  }, [blueprints, query]);
  const filtered = matches.slice(0, BLUEPRINT_RESULT_CAP);

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
            <button className="btn btn-secondary" onClick={pullAllShipping} disabled={pullingShipping}>
              {pullingShipping ? <span className="spinner" /> : null}
              {products.some((p) => p.estimatedShippingCost != null) ? "Re-pull shipping" : "Pull shipping from Printify"}
            </button>
            {lastShippingPulled && !pullingShipping ? (
              <span className="hint">shipping pulled {lastShippingPulled}</span>
            ) : null}
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
                  onGraphicLink={(field, value) => patchProduct(p.id, { [field]: value })}
                  shippingProfiles={shippingProfiles}
                  onShippingProfile={(profileId) =>
                    patchProduct(p.id, { etsyShippingProfileId: profileId })
                  }
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
                {/* a blueprint absent from this list because of the cap is
                    not a blueprint Printify lacks — say which it is */}
                {blueprints && matches.length > filtered.length ? (
                  <span className="hint">
                    Showing {filtered.length} of {matches.length} matches — keep typing to narrow it.
                    Nothing is excluded for already having a Product; the same blueprint can be
                    seeded again under a different print provider.
                  </span>
                ) : blueprints && matches.length > 0 ? (
                  <span className="hint">
                    {matches.length} match{matches.length === 1 ? "" : "es"}. A blueprint you already
                    seeded can be seeded again under a different print provider.
                  </span>
                ) : null}
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
