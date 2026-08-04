"use client";

/**
 * L5 — the image-slot plan. Up to MAX_IMAGES ordered slots; position 1 is
 * the search thumbnail and does most of the click-through work. Bucket is
 * the slot's JOB, shot type is HOW it renders — orthogonal axes, and the
 * coverage hint shows both so "twelve flat lays and nothing on a model" is
 * visible at a glance. Advisory throughout; only the publish gates block.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";
import { apiCall, apiJson } from "@/lib/api";
import {
  BUCKETS,
  SHOT_TYPES,
  SLOT_STATUSES,
  MAX_IMAGES,
  MIN_RECOMMENDED_IMAGES,
} from "@/config/images";

export interface SlotRow {
  id: string;
  position: number;
  label: string;
  bucket: string;
  shotType: string;
  status: string;
  assetRef: string;
  templateId: string | null;
  /** set only on slots seeded to pull from a Product-level reusable graphic */
  productLinkRole: string | null;
  /** "product" = current asset still matches the Product's link; "custom" = hand-replaced; null = not a Product-linked slot */
  provenance: "product" | "custom" | null;
}

export interface SlotsData {
  listingId: string;
  isMultiVariant: boolean;
  /** tightest garment compatibility across this listing's designs */
  compatibility: string;
  slots: SlotRow[];
  templates: Array<{ id: string; name: string; shotType: string; garmentColor: string; shotId: string | null }>;
  /** already the full intersection — sold (or mockup-colors subset) ∩ an Available Product Variant. Template offers filter against this, not raw colorways. */
  availableColors: string[];
  /** L4's template assignment — non-empty narrows offers to shortlist ∩ colour */
  shortlist: string[];
  /** true when any slot is tied to a Product graphic — shows the Refresh from Product button */
  hasProductLinks: boolean;
}

/** Provenance badge for the Product-linked slots — unchanged treatment, lifted out of the row. */
function ProvenanceChip({ slot }: { slot: SlotRow }) {
  if (slot.provenance === "product") {
    return (
      <span className="chip done" style={{ fontSize: 10 }} title={`Pulled from this listing's Product (${slot.productLinkRole})`}>
        from Product
      </span>
    );
  }
  if (slot.provenance === "custom") {
    return (
      <span className="chip count" style={{ fontSize: 10 }} title={`Replaced by hand — no longer matches the Product's ${slot.productLinkRole} graphic`}>
        custom
      </span>
    );
  }
  if (slot.productLinkRole) {
    return (
      <span className="chip stale" style={{ fontSize: 10 }} title={`Waiting on the Product's ${slot.productLinkRole} graphic link`}>
        needs Product graphic
      </span>
    );
  }
  return null;
}

/** the comp's three status tints, by real status value */
const STATUS_CLASS: Record<string, string> = {
  Planned: "st-planned",
  Made: "st-made",
  Placed: "st-placed",
};

/** the comp's bucket accent colours */
const BUCKET_ACCENT: Record<string, string> = {
  "Sell Design": "#C39A3E",
  "Sell Belief": "#BE7B62",
  "Sell Specifics": "#6E86A8",
};

/** icons for the three AUTO graphic-card slots, by Product Link Role */
const ROLE_ICON: Record<string, string> = {
  "Highlights & Sizing": "📏",
  "Care & Policies": "🧺",
  Colorways: "🎨",
};

function StatusPill({
  status,
  disabled,
  onPick,
}: {
  status: string;
  disabled: boolean;
  onPick: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", flex: "0 0 auto" }} onClick={(e) => e.stopPropagation()}>
      <button
        className={`l5-status ${STATUS_CLASS[status] ?? "st-planned"}`}
        style={{ cursor: disabled ? "default" : "pointer" }}
        disabled={disabled}
        title="Change status"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="d" />
        {status}
      </button>
      {open ? (
        <>
          <span style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <span
            className="card"
            style={{ position: "absolute", top: "100%", right: 0, zIndex: 11, padding: 4, display: "grid", gap: 2, minWidth: 92 }}
          >
            {SLOT_STATUSES.map((st) => (
              <button
                key={st}
                className="btn btn-tertiary"
                style={{ fontSize: 11, padding: "3px 8px", justifyContent: "flex-start" }}
                onClick={() => {
                  setOpen(false);
                  if (st !== status) onPick(st);
                }}
              >
                {st}
              </button>
            ))}
          </span>
        </>
      ) : null}
    </span>
  );
}

/** Reorder, re-bucket and delete — real actions, just not worth permanent width on every row. */
function OverflowMenu({
  disabled,
  canUp,
  canDown,
  bucket,
  onBucket,
  onMove,
  onDelete,
}: {
  disabled: boolean;
  canUp: boolean;
  canDown: boolean;
  bucket: string;
  onBucket: (b: string) => void;
  onMove: (dir: "up" | "down") => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item = { fontSize: 11, padding: "3px 8px", justifyContent: "flex-start" } as const;
  return (
    <span style={{ position: "relative", flex: "0 0 auto" }} onClick={(e) => e.stopPropagation()}>
      <button
        className="btn btn-tertiary"
        style={{ fontSize: 13, padding: "2px 7px" }}
        disabled={disabled}
        title="More — move, re-bucket, remove"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open ? (
        <>
          <span style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <span
            className="card"
            style={{ position: "absolute", top: "100%", right: 0, zIndex: 11, padding: 4, display: "grid", gap: 2, minWidth: 150 }}
          >
            <span className="kicker" style={{ padding: "2px 8px" }}>BUCKET</span>
            {BUCKETS.map((b) => (
              <button
                key={b}
                className="btn btn-tertiary"
                style={item}
                onClick={() => {
                  setOpen(false);
                  if (b !== bucket) onBucket(b);
                }}
              >
                {b === bucket ? "✓ " : "   "}
                {b}
              </button>
            ))}
            <span className="kicker" style={{ padding: "2px 8px", marginTop: 2 }}>ORDER</span>
            <button className="btn btn-tertiary" style={item} disabled={!canUp} onClick={() => { setOpen(false); onMove("up"); }}>
              ↑ Move up
            </button>
            <button className="btn btn-tertiary" style={item} disabled={!canDown} onClick={() => { setOpen(false); onMove("down"); }}>
              ↓ Move down
            </button>
            <button className="btn btn-tertiary" style={item} onClick={() => { setOpen(false); onDelete(); }}>
              ✕ Remove slot
            </button>
          </span>
        </>
      ) : null}
    </span>
  );
}

export function ImageSlotsPanel({ data }: { data: SlotsData }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** one row open at a time — the point is to not have fourteen sets of controls mounted */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** buckets collapsed BY the operator — open by default, comp behaviour */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** hide Placed rows — "what still needs me" is the working question */
  const [onlyAttention, setOnlyAttention] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // collapse on click-away, so an open row can't quietly stay open behind
  // whatever you scrolled to next
  useEffect(() => {
    if (!expandedId) return;
    function away(e: PointerEvent) {
      if (!listRef.current?.contains(e.target as Node)) setExpandedId(null);
    }
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [expandedId]);

  async function call(label: string, url: string, method: string, body?: unknown) {
    setBusy(label);
    setError(null);
    const res =
      body === undefined ? await apiCall(url, { method }) : await apiJson(url, method, body);
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(null);
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    call(id, `/api/image-slots/${id}`, "PATCH", body);

  const filled = data.slots.filter((s) => s.status === "Made" || s.status === "Placed");
  const placed = data.slots.filter((s) => s.status === "Placed");
  const attention = data.slots.filter((s) => s.status !== "Placed");

  // Offer colour-neutral templates always; colour-tagged ones only when the
  // colour survives the full intersection (sold/mockup-colors ∩ an
  // Available Product Variant) — computed server-side. No colours recorded
  // yet = no filtering, with a nudge to set them at L1. On top of colour:
  // L4's template assignment — when a shortlist exists, only its templates'
  // variants are offered (shot-less hand intakes always pass).
  const norm = (c: string) => c.trim().toLowerCase();
  const sells = new Set(data.availableColors.map(norm));
  const shortlist = new Set(data.shortlist);
  const offered = data.templates.filter(
    (t) =>
      (!t.garmentColor.trim() || sells.size === 0 || sells.has(norm(t.garmentColor))) &&
      (shortlist.size === 0 || t.shotId === null || shortlist.has(t.shotId))
  );
  const hiddenCount = data.templates.length - offered.length;

  // shot-type spread — the second axis the coverage header doesn't show
  const shotCounts = new Map<string, number>();
  for (const s of data.slots) {
    if (s.shotType) shotCounts.set(s.shotType, (shotCounts.get(s.shotType) ?? 0) + 1);
  }
  const shotLine = [...shotCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${n}× ${t.toLowerCase()}`)
    .join(" · ");

  return (
    <div className="card supporting">
      <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <Kicker>IMAGE SLOTS · {filled.length} FILLED / {data.slots.length} PLANNED (CAP {MAX_IMAGES})</Kicker>
        <div className="row-gap-12" style={{ alignItems: "center" }}>
          {data.hasProductLinks ? (
            <button
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "4px 10px" }}
              disabled={busy !== null}
              title="Re-pulls the size chart / care info / colorways slots from the Product's current graphic links"
              onClick={() =>
                call("refresh-product", `/api/listings/${data.listingId}/refresh-slots-from-product`, "POST")
              }
            >
              {busy === "refresh-product" ? <span className="spinner" /> : null}
              Refresh from Product
            </button>
          ) : null}
          <label className="row-gap-8" style={{ alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={data.isMultiVariant}
              disabled={busy !== null}
              onChange={(e) =>
                call("multi", `/api/listings/${data.listingId}`, "PATCH", { isMultiVariant: e.target.checked })
              }
            />
            <span className="body-sm">Multi-variant listing</span>
          </label>
        </div>
      </div>

      {error ? <div className="callout blocked">{error}</div> : null}

      {/* the colourway count in this plan is only as good as the garment call
          behind it — seeding while it's Unset assumes five, which may be wrong */}
      {data.compatibility === "Unset" ? (
        <div className="callout stale">
          Garment compatibility isn&apos;t set on this listing&apos;s designs, so the plan assumes
          five colourways. Set it at C8 and reseed if it turns out to be fewer.
        </div>
      ) : null}

      {hiddenCount > 0 ? (
        <div className="hint">
          {hiddenCount} variant{hiddenCount === 1 ? "" : "s"} not offered —{" "}
          {data.shortlist.length > 0
            ? "outside this listing's template assignment (L4) or its colorways (L1)."
            : "other garment colours than this listing's colorways (set at L1)."}
        </div>
      ) : null}

      {data.isMultiVariant ? (
        <div className="hint">
          Multi-variant rule: show the SYSTEM plus 2-3 examples — never spend slots on repeated
          name variations. The hero sells the concept, not one name.
        </div>
      ) : null}

      {data.slots.length === 0 ? (
        <div className="stack-12">
          <div className="body-sm muted">
            No slot plan yet. Seeding lays out the default allocation for a
            {data.isMultiVariant ? " multi-variant" : " single-variant"} listing — every slot stays
            editable, and slots 18-20 stay empty as buffer.
          </div>
          <div className="row-gap-12">
            <button
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() => call("seed", "/api/image-slots", "POST", { listingId: data.listingId, seed: true })}
            >
              {busy === "seed" ? <span className="spinner" /> : null}
              Seed the slot plan
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* coverage — the comp's header block: big placed count + one
              bar per bucket, in the bucket's own accent colour */}
          <div className="l5-coverage">
            <div className="l5-cov-total">
              <span className="big">{placed.length}/{data.slots.length}</span>
              <span className="kicker">PLACED</span>
            </div>
            <div className="l5-cov-buckets">
              {BUCKETS.map((b) => {
                const inBucket = data.slots.filter((s) => s.bucket === b);
                if (inBucket.length === 0) return null;
                const done = inBucket.filter((s) => s.status === "Placed").length;
                return (
                  <div key={b} className="l5-cov-b">
                    <div className="row">
                      <span className="nm">{b}</span>
                      <span className="hint">{done}/{inBucket.length}</span>
                    </div>
                    <div className="l5-bar">
                      <i style={{ width: `${(done / inBucket.length) * 100}%`, background: BUCKET_ACCENT[b] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* legend + the working filter: what still needs me */}
          <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
            <span className="row-gap-12" style={{ flexWrap: "wrap", fontSize: 12, color: "var(--text-secondary)" }}>
              {SLOT_STATUSES.map((st) => (
                <span key={st} className="row-gap-8" style={{ alignItems: "center", gap: 5 }}>
                  <span className={`l5-status ${STATUS_CLASS[st]}`} style={{ padding: 0, background: "none" }}>
                    <span className="d" />
                  </span>
                  {st}
                </span>
              ))}
              {shotLine ? <span>· {shotLine}</span> : null}
              {filled.length < MIN_RECOMMENDED_IMAGES ? (
                <span>· aim for {MIN_RECOMMENDED_IMAGES}+ filled (cap {MAX_IMAGES})</span>
              ) : null}
            </span>
            <button
              className={`btn ${onlyAttention ? "btn-secondary" : "btn-tertiary"}`}
              style={{ fontSize: 12, padding: "4px 12px" }}
              onClick={() => setOnlyAttention((v) => !v)}
            >
              {onlyAttention ? "Show all" : `Needs attention · ${attention.length}`}
            </button>
          </div>

          <div ref={listRef} className="stack-12" style={{ gap: 10 }}>
            {BUCKETS.map((b) => {
              const inBucket = data.slots.filter((s) => s.bucket === b);
              if (inBucket.length === 0) return null;
              const done = inBucket.filter((s) => s.status === "Placed").length;
              const isCollapsed = collapsed.has(b);
              const visible = inBucket.filter((s) => !onlyAttention || s.status !== "Placed");
              return (
                <section key={b} className="stack-12" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="l5-bhead"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((cur) => {
                        const next = new Set(cur);
                        if (next.has(b)) next.delete(b);
                        else next.add(b);
                        return next;
                      })
                    }
                  >
                    <span className={`l5-chev${isCollapsed ? " closed" : ""}`}>▾</span>
                    <span className="l5-accent" style={{ background: BUCKET_ACCENT[b] }} />
                    <span className="l5-btitle">{b}</span>
                    <span className="l5-bcount">{done} / {inBucket.length} placed</span>
                    <span className="l5-minibar">
                      <i style={{ width: `${(done / inBucket.length) * 100}%`, background: BUCKET_ACCENT[b] }} />
                    </span>
                  </button>
                  {!isCollapsed
                    ? visible.map((s) => {
                        const open = expandedId === s.id;
                        const i = data.slots.findIndex((x) => x.id === s.id);
                        const isGraphic = Boolean(s.productLinkRole);
                        return (
                          <div
                            key={s.id}
                            className={`l5-slot${isGraphic ? " graphic" : ""}`}
                            style={{
                              borderLeftColor: isGraphic ? undefined : BUCKET_ACCENT[b],
                              cursor: "pointer",
                            }}
                            onClick={() => setExpandedId(open ? null : s.id)}
                          >
                            <span className="ord">{s.position}</span>
                            <div className="mid">
                              <div className="nm">
                                {isGraphic ? (
                                  <span className="l5-ico" aria-hidden>
                                    {ROLE_ICON[s.productLinkRole!] ?? "🖼"}
                                  </span>
                                ) : null}
                                {open ? (
                                  <input
                                    className="input input-compact"
                                    style={{ flex: "1 1 150px" }}
                                    defaultValue={s.label}
                                    onClick={(e) => e.stopPropagation()}
                                    onBlur={(e) => {
                                      if (e.target.value !== s.label) patch(s.id, { label: e.target.value });
                                    }}
                                  />
                                ) : (
                                  s.label
                                )}
                                {isGraphic ? <span className="l5-autobadge">AUTO</span> : null}
                              </div>
                              <div className="meta">
                                {isGraphic ? (
                                  // the graphic-card slots are handled-or-missing, never
                                  // per-listing work — say which, in their own voice
                                  s.provenance === "product" ? (
                                    <span className="l5-fromprod">✓ Pulled from Product record</span>
                                  ) : s.provenance === "custom" ? (
                                    <span className="l5-fromprod" title={`Hand-replaced — no longer matches the Product's ${s.productLinkRole} graphic`}>
                                      custom — replaced by hand
                                    </span>
                                  ) : (
                                    <span className="l5-fromprod warn">⚠ Not in Product yet — add it there</span>
                                  )
                                ) : (
                                  <>
                                    <span className="l5-tag">{s.shotType || "no shot type"}</span>
                                    {!s.templateId ? <span className="l5-tag">no template</span> : null}
                                    <span className={`l5-asset${s.assetRef ? " has" : ""}`} title={s.assetRef || undefined}>
                                      {s.assetRef ? "✓ asset linked" : "no asset yet"}
                                    </span>
                                  </>
                                )}
                              </div>
                              {open ? (
                                <div
                                  className="row-gap-8"
                                  style={{ flexWrap: "wrap", alignItems: "center", marginTop: 8 }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <select
                                    className="select input-compact"
                                    style={{ width: 150 }}
                                    value={s.shotType}
                                    disabled={busy !== null}
                                    onChange={(e) => patch(s.id, { shotType: e.target.value })}
                                  >
                                    <option value="">Shot type…</option>
                                    {SHOT_TYPES.map((t) => <option key={t}>{t}</option>)}
                                  </select>
                                  <select
                                    className="select input-compact"
                                    style={{ width: 150 }}
                                    value={s.templateId ?? ""}
                                    disabled={busy !== null}
                                    onChange={(e) => patch(s.id, { mockupTemplateId: e.target.value || null })}
                                  >
                                    <option value="">Variant…</option>
                                    {offered.map((t) => (
                                      <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                  </select>
                                  <input
                                    className="input input-compact"
                                    style={{ flex: "1 1 180px" }}
                                    placeholder="asset link…"
                                    defaultValue={s.assetRef}
                                    onBlur={(e) => {
                                      if (e.target.value !== s.assetRef) patch(s.id, { assetRef: e.target.value });
                                    }}
                                  />
                                  {/* the gate reads role-carrying slots and ONLY those — a
                                      hand-added size chart without the role stayed invisible
                                      to "Graphic card: size chart" forever. Settable here. */}
                                  <select
                                    className="select input-compact"
                                    style={{ width: 190 }}
                                    value={s.productLinkRole ?? ""}
                                    disabled={busy !== null}
                                    title="Marks this slot as one of the three graphic cards — the publish gate counts role-carrying slots"
                                    onChange={(e) => patch(s.id, { productLinkRole: e.target.value })}
                                  >
                                    <option value="">not a graphic card</option>
                                    <option value="Highlights & Sizing">graphic: size chart</option>
                                    <option value="Care & Policies">graphic: care info</option>
                                    <option value="Colorways">graphic: colorways</option>
                                  </select>
                                </div>
                              ) : null}
                            </div>
                            <div className="l5-right" onClick={(e) => e.stopPropagation()}>
                              <StatusPill
                                status={s.status}
                                disabled={busy !== null}
                                onPick={(st) => patch(s.id, { status: st })}
                              />
                              <OverflowMenu
                                disabled={busy !== null}
                                canUp={i > 0}
                                canDown={i < data.slots.length - 1}
                                bucket={s.bucket}
                                onBucket={(bk) => patch(s.id, { bucket: bk })}
                                onMove={(dir) => patch(s.id, { move: dir })}
                                onDelete={() => {
                                  if (window.confirm(`Delete slot ${s.position} (${s.label})?`)) {
                                    call(s.id, `/api/image-slots/${s.id}`, "DELETE");
                                  }
                                }}
                              />
                            </div>
                          </div>
                        );
                      })
                    : null}
                  {!isCollapsed && visible.length === 0 ? (
                    <span className="hint" style={{ paddingLeft: 4 }}>
                      Everything here is placed — showing unplaced only.
                    </span>
                  ) : null}
                </section>
              );
            })}
            {/* slots in a bucket the config doesn't know — never drop rows silently */}
            {data.slots
              .filter((s) => !(BUCKETS as readonly string[]).includes(s.bucket))
              .map((s) => (
                <div key={s.id} className="l5-slot" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                  <span className="ord">{s.position}</span>
                  <div className="mid">
                    <div className="nm">{s.label}</div>
                    <div className="meta">
                      <span className="l5-tag">{s.bucket || "no bucket"}</span>
                    </div>
                  </div>
                  <div className="l5-right" onClick={(e) => e.stopPropagation()}>
                    <StatusPill status={s.status} disabled={busy !== null} onPick={(st) => patch(s.id, { status: st })} />
                  </div>
                </div>
              ))}
          </div>

          {/* absence renders as presence: a graphic-card role no slot
              carries gets an amber re-add row, not silence — the size
              chart is publish-gated, and a vanished card must say so HERE */}
          {(
            [
              ["Highlights & Sizing", "size chart", "📏"],
              ["Care & Policies", "care info", "🧺"],
              ["Colorways", "colorways", "🎨"],
            ] as const
          )
            .filter(([role]) => !data.slots.some((s) => s.productLinkRole === role))
            .map(([role, label, icon]) => (
              <div key={role} className="l5-slot graphic" style={{ borderLeftColor: "#B4741F" }}>
                <span className="ord">—</span>
                <div className="mid">
                  <div className="nm">
                    <span className="l5-ico" aria-hidden>{icon}</span>
                    {label}
                    <span className="l5-autobadge">AUTO</span>
                  </div>
                  <div className="meta">
                    <span className="l5-fromprod warn">
                      ⚠ No slot carries this graphic card
                      {role === "Highlights & Sizing" ? " — the size-chart publish gate needs one" : ""}
                    </span>
                  </div>
                </div>
                <div className="l5-right">
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: "4px 12px" }}
                    disabled={busy !== null || data.slots.length >= MAX_IMAGES}
                    onClick={() =>
                      call("re-add", "/api/image-slots", "POST", {
                        listingId: data.listingId,
                        label,
                        bucket: "Sell Specifics",
                        shotType: "Graphic Card",
                        productLinkRole: role,
                      })
                    }
                  >
                    {busy === "re-add" ? <span className="spinner" /> : null}
                    Re-add slot
                  </button>
                </div>
              </div>
            ))}

          {data.slots.length < MAX_IMAGES ? (
            <div className="row-gap-12">
              <button
                className="btn btn-tertiary"
                disabled={busy !== null}
                onClick={() => call("add", "/api/image-slots", "POST", { listingId: data.listingId })}
              >
                + Add a slot
              </button>
              <span className="hint">{MAX_IMAGES - data.slots.length} of the cap unplanned (buffer is fine)</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
