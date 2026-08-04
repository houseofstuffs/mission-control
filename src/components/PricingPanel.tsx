"use client";

/**
 * L3 — the margin calculator. Price in, itemized Etsy fees out, net margin
 * in dollars and percent, live as you type.
 *
 * TWO KINDS OF INPUT, and the panel never blurs them:
 *   · PRICE is a decision — saved to the record, pushed to Etsy.
 *   · Discount, shipping and advertising are SCRATCH SPACE — scenario
 *     dials for planning a budget. They recalculate everything live and
 *     save nowhere, which is why they're visually grouped apart and
 *     labelled as exploration.
 *
 * The one hard rule (Phase 2 spec): NO COST, NO MARGIN. A missing cost
 * snapshot renders a refusal that says how to fix it — it never renders a
 * $0 cost and lets a price ship on top of the lie. Cost At Creation is a
 * SNAPSHOT (§3.4): re-snapshotting from the product's current estimate is
 * a deliberate button, never a silent live lookup.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Kicker } from "./ui";
import { apiJson } from "@/lib/api";
import {
  computeMargin,
  breakevenPrice,
  priceForMargin,
  MARGIN_THIN_PCT,
  AD_PRESETS,
  SALE_TIERS,
  offsiteAds,
  ETSY_LISTING_FEE,
  ETSY_TRANSACTION_PCT,
  ETSY_PAYMENT_PCT,
  ETSY_PAYMENT_FLAT,
  type AdMode,
} from "@/config/fees";

export interface PricingData {
  listingId: string;
  /** saved price on the record */
  price: number | null;
  /** the cost snapshot — null means the calculator refuses */
  cost: number | null;
  costBasis: string;
  costSnapshotAt: string;
  /** the product's CURRENT estimate, for the re-snapshot button */
  product: {
    name: string;
    estimatedCost: number | null;
    costMethod: string | null;
    /** what Printify bills to ship one unit, US domestic — pre-fills the scenario dial below */
    estimatedShippingCost: number | null;
    shippingPulledAt: string | null;
    /** what the BUYER is charged, from the product's Etsy Shipping Profile */
    shippingCharged: number | null;
    shippingProfileName: string | null;
  } | null;
  /** L3's other half — the operator's attestation, and when it was given */
  shippingConfirmed: boolean;
  shippingConfirmedAt: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
/** "" → 0, so an emptied field reads as none rather than NaN */
const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

export function PricingPanel({ data }: { data: PricingData }) {
  const router = useRouter();
  const [priceInput, setPriceInput] = useState(data.price != null ? String(data.price) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** which way the calculator solves — both share every input below */
  const [mode, setMode] = useState<"price" | "margin">("price");
  const [targetInput, setTargetInput] = useState("30");

  // ---- exploration dials: live math, saved nowhere ----
  // Discount starts at the shop's standing 20%-off sale, because that's the
  // price buyers actually pay — a margin computed at list price would be
  // the exploration, not the default. Still a dial: zero it to see full-price
  // margin. (If the standing sale ever changes, this is the only number.)
  const [discountInput, setDiscountInput] = useState("20");
  const defaultShipCharged = data.product?.shippingCharged ?? null;
  const [shipChargedInput, setShipChargedInput] = useState(
    defaultShipCharged != null ? String(defaultShipCharged) : "0"
  );
  const defaultShipCost = data.product?.estimatedShippingCost ?? null;
  const [shipCostInput, setShipCostInput] = useState(
    defaultShipCost != null ? String(defaultShipCost) : "0"
  );
  const [adMode, setAdMode] = useState<AdMode>("percent");
  const [adInput, setAdInput] = useState("15");

  const price = Number(priceInput);
  const livePrice = Number.isFinite(price) && price > 0 ? price : null;
  const priceDirty = livePrice !== data.price;

  const scenario = {
    discountPct: num(discountInput),
    shippingCharged: num(shipChargedInput),
    shippingCost: num(shipCostInput),
    adMode,
    adValue: num(adInput),
  };
  // MARGIN → PRICE: solve for the list price that hits the target
  const solved = mode === "margin" ? priceForMargin(data.cost, num(targetInput), scenario) : null;
  const requiredPrice = solved && solved.ok ? solved.result.price : null;
  /** the price the breakdown describes: typed in one mode, solved in the other */
  const shownPrice = mode === "margin" ? requiredPrice : livePrice;

  const margin = computeMargin(shownPrice, data.cost, scenario);
  // the same price with advertising switched off — what the ad is costing
  const noAdMargin = computeMargin(shownPrice, data.cost, { ...scenario, adValue: 0 });
  const breakeven = data.cost != null ? breakevenPrice(data.cost, scenario) : null;
  const scenarioActive =
    scenario.discountPct > 0 ||
    scenario.shippingCharged > 0 ||
    scenario.shippingCost > 0 ||
    scenario.adValue > 0;

  async function call(label: string, body: Record<string, unknown>) {
    setBusy(label);
    setError(null);
    const res = await apiJson(`/api/listings/${data.listingId}`, "PATCH", body);
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(null);
    return res.ok;
  }

  const estimate = data.product?.estimatedCost ?? null;
  const canResnapshot = estimate != null && estimate !== data.cost;

  return (
    <div className="card supporting">
      <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <Kicker>PRICING — MARGIN CALCULATOR</Kicker>
        {/* solve direction — every input below is shared, so flipping this
            never resets what you've already dialled in */}
        <span className="row-gap-8" style={{ marginLeft: "auto", alignItems: "center" }}>
          {([
            ["price", "Price → Margin"],
            ["margin", "Margin → Price"],
          ] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              className={`chip ${mode === m ? "done" : "neutral"}`}
              style={{ cursor: "pointer" }}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      {error ? <div className="callout blocked">{error}</div> : null}

      {/* the cost side — snapshot, never live */}
      <div className="well">
        <Kicker>COST SNAPSHOT</Kicker>
        {data.cost != null ? (
          <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            <span className="body-sm">
              <strong>{money(data.cost)}</strong>
              {data.costBasis ? ` · ${data.costBasis}` : ""}
              {data.costSnapshotAt ? ` · snapshotted ${data.costSnapshotAt}` : ""}
            </span>
            {canResnapshot ? (
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 12, padding: "4px 10px" }}
                disabled={busy !== null}
                onClick={() => call("snapshot", { resnapshotCost: true })}
                title={data.product?.costMethod ? `Product estimate method: ${data.product.costMethod}` : undefined}
              >
                {busy === "snapshot" ? <span className="spinner" /> : null}
                Re-snapshot from product ({money(estimate!)})
              </button>
            ) : null}
            <span className="hint">Product cost only — shipping is its own line below.</span>
          </div>
        ) : (
          <>
            <div className="callout blocked" style={{ marginTop: 6 }}>
              No cost snapshot — the margin calculator refuses to guess.{" "}
              {estimate != null ? (
                <>The product estimates {money(estimate)} — snapshot it to unlock the math.</>
              ) : (
                <>
                  {data.product
                    ? `${data.product.name} has no cost estimate yet — pull costs on the `
                    : "No product on this listing — set one, then pull costs on the "}
                  <Link href="/products">Products page</Link> first.
                </>
              )}
            </div>
            {estimate != null ? (
              <button
                className="btn btn-save"
                style={{ alignSelf: "flex-start", marginTop: 8 }}
                disabled={busy !== null}
                onClick={() => call("snapshot", { resnapshotCost: true })}
              >
                {busy === "snapshot" ? <span className="spinner" /> : null}
                Snapshot cost from product ({money(estimate)})
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* MARGIN → PRICE: the target, and what it demands you charge */}
      {mode === "margin" ? (
        <div className="well">
          <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field" style={{ width: 150 }}>
              <label className="kicker" htmlFor="l3-target">TARGET MARGIN %</label>
              <input
                id="l3-target"
                className="input"
                type="number"
                step="1"
                min="0"
                max="99"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
              />
              <span className="hint">exploration only</span>
            </div>
            {solved && !solved.ok ? (
              <div className="callout blocked" style={{ flex: "1 1 260px" }}>
                No price reaches {num(targetInput)}% in this scenario — percentage fees cap it at{" "}
                {solved.ceilingPct.toFixed(1)}%. Cut advertising, or aim lower.
              </div>
            ) : requiredPrice != null ? (
              <>
                <div className="body-sm" style={{ flex: "1 1 200px" }}>
                  <span className="hint">charge</span>
                  <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>
                    {money(requiredPrice)}
                  </div>
                  <span className="hint">
                    to net {num(targetInput)}% on {money(solved!.ok ? solved!.result.orderTotal : 0)}
                    {scenario.discountPct > 0 ? ` after ${scenario.discountPct}% off` : ""}
                  </span>
                </div>
                <button
                  className="btn btn-secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    setPriceInput(requiredPrice.toFixed(2));
                    setMode("price");
                  }}
                  title="Copies it into the Price field — you still save it deliberately"
                >
                  Use this price →
                </button>
              </>
            ) : (
              <span className="hint">Needs a cost snapshot before it can solve.</span>
            )}
          </div>
        </div>
      ) : null}

      {/* the price — the one saved, pushed decision on this panel */}
      <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ width: 150 }}>
          <label className="kicker" htmlFor="l3-price">PRICE (USD)</label>
          <input
            id="l3-price"
            className="input"
            type="number"
            step="0.01"
            min="0"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
          />
          <span className="hint">saved to the listing</span>
        </div>
        <button
          className="btn btn-save"
          disabled={busy !== null || livePrice == null || !priceDirty}
          onClick={() => call("price", { price: livePrice })}
        >
          {busy === "price" ? <span className="spinner" /> : null}
          Save price
        </button>
        {priceDirty && livePrice != null ? <span className="chip stale">UNSAVED</span> : null}
      </div>

      {/* unified scenario + margin — two columns, one panel, neither saves */}
      <div className="well">
        <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <span className="panel-title" style={{ fontSize: 16 }}>Scenario &amp; margin</span>
          <span className="chip stale">EXPLORATION ONLY</span>
          <span className="hint">Nothing here saves or pushes.</span>
          {scenarioActive ? (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: "5px 14px", marginLeft: "auto" }}
              onClick={() => {
                setDiscountInput("0");
                setShipChargedInput("0");
                setShipCostInput("0");
                setAdInput("0");
              }}
            >
              Reset
            </button>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
            marginTop: 14,
          }}
        >
          {/* left — the dials */}
          <div>
            <Kicker>SCENARIO INPUTS</Kicker>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: 12,
                marginTop: 10,
              }}
            >
              <div className="field">
                <label className="kicker" htmlFor="l3-discount">SALE % — MAX-DISCOUNT STRESS TEST</label>
                <input
                  id="l3-discount"
                  className="input"
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  title="Starts at 20% — the deepest sale the shop ever runs — so the first verdict is the worst-case margin. Real seasonal tiers are the chips below."
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                />
                <div className="row-gap-8" style={{ flexWrap: "wrap", marginTop: 6 }}>
                  {SALE_TIERS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`chip ${num(discountInput) === p ? "done" : "neutral"}`}
                      style={{ cursor: "pointer" }}
                      title={
                        p === 0
                          ? "full price — no sale running"
                          : p === 20
                            ? "the shop's maximum ever — the default stress test"
                            : "a normal seasonal sale tier"
                      }
                      onClick={() => setDiscountInput(String(p))}
                    >
                      {p === 0 ? "none" : `${p}%`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label className="kicker" htmlFor="l3-ship-charged">SHIPPING CHARGED</label>
                <input
                  id="l3-ship-charged"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={shipChargedInput}
                  title={
                    data.product?.shippingProfileName
                      ? `Pre-filled from the Etsy shipping profile "${data.product.shippingProfileName}" (US domestic) — override freely.`
                      : "Set an Etsy shipping profile on the Product to pre-fill this."
                  }
                  onChange={(e) => setShipChargedInput(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="kicker" htmlFor="l3-ship-cost">SHIPPING COST</label>
                <input
                  id="l3-ship-cost"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={shipCostInput}
                  onChange={(e) => setShipCostInput(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="kicker" htmlFor="l3-ad">
                  ADVERTISING {adMode === "percent" ? "%" : "$"}
                </label>
                <div className="row-gap-8" style={{ alignItems: "center" }}>
                  <input
                    id="l3-ad"
                    className="input"
                    type="number"
                    step={adMode === "percent" ? "1" : "0.01"}
                    min="0"
                    max={adMode === "percent" ? "100" : undefined}
                    style={{ minWidth: 0 }}
                    value={adInput}
                    onChange={(e) => setAdInput(e.target.value)}
                  />
                  <select
                    className="select"
                    aria-label="Advertising mode"
                    style={{ width: "auto", padding: "6px 8px", fontSize: 12 }}
                    value={adMode}
                    onChange={(e) => setAdMode(e.target.value as AdMode)}
                  >
                    <option value="percent">%</option>
                    <option value="flat">$</option>
                  </select>
                </div>
              </div>
            </div>
            {adMode === "percent" ? (
              <div className="row-gap-8" style={{ flexWrap: "wrap", marginTop: 10 }}>
                {AD_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`chip ${num(adInput) === p ? "done" : "neutral"}`}
                    style={{ cursor: "pointer" }}
                    title={
                      p === 15
                        ? "Etsy Offsite Ads, mandatory tier (under $10k/yr)"
                        : p === 12
                          ? "Etsy Offsite Ads once the shop clears $10k/yr"
                          : "no advertising on this sale"
                    }
                    onClick={() => setAdInput(String(p))}
                  >
                    {p === 0 ? "none" : `${p}%`}
                  </button>
                ))}
              </div>
            ) : (
              <span className="hint" style={{ display: "block", marginTop: 10 }}>flat spend attributed to one sale</span>
            )}
            {/* the tier assumption — the one caption kept, since it's a fact
                that changes, not a restatement of the field's own label */}
            {adMode === "percent" ? (
              <span className="hint" style={{ display: "block", marginTop: 8 }}>{offsiteAds.note}</span>
            ) : null}
          </div>

          {/* right — the verdict, only when both real sides exist */}
          {margin ? (
            <div style={{ borderLeft: "1px solid var(--border-soft)", paddingLeft: 20 }}>
              <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
                <Kicker>
                  {mode === "margin" ? "AT THE REQUIRED PRICE" : "MARGIN"} ON A {money(margin.orderTotal)} ORDER
                </Kicker>
                {margin.net < 0 ? (
                  <span className="chip blocked">underwater</span>
                ) : margin.marginPct < MARGIN_THIN_PCT ? (
                  <span className="chip stale">thin — under {pct(MARGIN_THIN_PCT)}</span>
                ) : (
                  <span className="chip done">✓ {pct(margin.marginPct)}</span>
                )}
                <span className="hint" style={{ marginLeft: "auto" }}>
                  {breakeven != null ? `breakeven ${money(breakeven)}` : "no price breaks even in this scenario"}
                </span>
              </div>
              {/* one line per real deduction — nothing hidden in a constant */}
              <div className="stack-12" style={{ gap: 2, marginTop: 8 }}>
                <Row label="Order total" value={margin.orderTotal} strong />
                {margin.discount > 0 ? (
                  <Row label={`Sale price (after ${discountInput}% off)`} value={margin.salePrice} muted />
                ) : null}
                {margin.shippingCharged > 0 ? (
                  <Row label="Shipping charged to buyer" value={margin.shippingCharged} muted />
                ) : null}
                <Row label="Product cost" value={-margin.cost} />
                {margin.shippingCost > 0 ? <Row label="Shipping cost" value={-margin.shippingCost} /> : null}
                <Row label="Listing fee" value={-margin.listingFee} />
                <Row label={`Transaction fee (${pct(ETSY_TRANSACTION_PCT)})`} value={-margin.transactionFee} />
                <Row
                  label={`Processing (${pct(ETSY_PAYMENT_PCT)} + ${money(ETSY_PAYMENT_FLAT)})`}
                  value={-margin.paymentFee}
                />
                <Row
                  label={`Advertising (${adMode === "percent" ? `${num(adInput)}% of order` : "flat"})`}
                  value={-margin.adCost}
                />
                <div style={{ borderTop: "1px solid var(--border-soft)", margin: "6px 0" }} />
                <Row label={`Net Profit · ${pct(margin.marginPct)}`} value={margin.net} strong />
              </div>
              {noAdMargin && margin.adCost > 0 ? (
                <span className="hint">
                  Advertising is costing {money(margin.adCost)} of this order — without it the same sale
                  nets {money(noAdMargin.net)} ({pct(noAdMargin.marginPct)}).
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <span className="hint">
        Etsy US fees: listing {money(ETSY_LISTING_FEE)}, transaction {pct(ETSY_TRANSACTION_PCT)},
        processing {pct(ETSY_PAYMENT_PCT)} + {money(ETSY_PAYMENT_FLAT)} — all charged on the order
        total (item + shipping charged). Rates live in src/config/fees.ts. The hard rule is no cost,
        no math.
      </span>
    </div>
  );
}

/** one deduction line — negatives render as a subtraction, not a minus sign */
function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: number;
  strong?: boolean;
  muted?: boolean;
}) {
  const negative = value < 0;
  return (
    <div
      className="row-gap-8"
      style={{ alignItems: "baseline", fontSize: 13.5, color: muted ? "var(--text-muted)" : undefined }}
    >
      <span style={{ flex: 1, fontWeight: strong ? 700 : 400 }}>{label}</span>
      <span
        style={{
          fontWeight: strong ? 700 : 400,
          fontVariantNumeric: "tabular-nums",
          color: strong && value < 0 ? "var(--candy)" : undefined,
        }}
      >
        {negative ? `− ${money(Math.abs(value))}` : money(value)}
      </span>
    </div>
  );
}

/**
 * L3's other half. The step is named "Verify pricing + shipping profile"
 * and promises "Shipping profile confirmed", but there was no control for
 * it and no gate to land on.
 *
 * WHERE THE PROFILE LIVES, since the two sides come from different places:
 *   · What the BUYER pays is Etsy's. Shipping profiles are synced from
 *     Etsy into Notion and a PRODUCT points at one; Etsy assigns them per
 *     listing, so this app treats it as a default and never writes back.
 *   · What YOU pay is Printify's, pulled from their catalog onto the same
 *     Product.
 * Neither is a per-listing value, and this app is draft-only — so
 * confirming is an attestation that this listing will go out on that
 * profile, not a write to Etsy. Changing it happens on the Product, which
 * is the record that actually holds it.
 */
export function ShippingProfileCard({ data }: { data: PricingData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charged = data.product?.shippingCharged ?? null;
  const cost = data.product?.estimatedShippingCost ?? null;
  const net = charged != null && cost != null ? charged - cost : null;
  const profile = data.product?.shippingProfileName ?? null;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    const res = await apiJson(`/api/listings/${data.listingId}`, "PATCH", {
      shippingProfileConfirmed: next,
    });
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(false);
  }

  const figure = (label: string, value: number | null, positive = false) => (
    <div className="well" style={{ flex: "1 1 130px", padding: "9px 12px" }}>
      <Kicker>{label}</Kicker>
      <div
        style={{
          fontSize: 17,
          fontWeight: 700,
          marginTop: 2,
          // a positive net on shipping is the good outcome — say so in colour
          color: positive && value != null && value > 0 ? "var(--status-done, #2E9E88)" : undefined,
        }}
      >
        {value == null
          ? "—"
          : value < 0
            ? // money() would render "$-1.04"; the sign belongs outside
              `-${money(Math.abs(value))}`
            : `${positive && value > 0 ? "+" : ""}${money(value)}`}
      </div>
    </div>
  );

  return (
    <div className="card supporting">
      <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <Kicker>SHIPPING PROFILE</Kicker>
        <span style={{ marginLeft: "auto" }}>
          <span className={`chip ${data.shippingConfirmed ? "done" : "stale"}`}>
            {data.shippingConfirmed ? "✓ confirmed" : "⚠ not confirmed"}
          </span>
        </span>
      </div>
      {error ? <div className="callout blocked">{error}</div> : null}

      <div className="well row-gap-12" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 200px" }}>
          <div className="body-sm" style={{ fontWeight: 600 }}>
            {profile ?? "No Etsy shipping profile on this product"}
          </div>
          <span className="hint">
            {profile
              ? "From the Product — synced from Etsy, shared by every listing on this garment"
              : "Pick one on the Product card; Etsy owns what buyers are charged"}
          </span>
        </span>
        <Link className="btn btn-tertiary" style={{ fontSize: 12, padding: "4px 10px" }} href="/products">
          {profile ? "Change on Product" : "Set on Product"}
        </Link>
      </div>

      <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
        {figure("BUYER PAYS", charged)}
        {figure("YOUR COST", cost)}
        {figure("NET ON SHIPPING", net, true)}
      </div>
      <span className="hint">
        The saved figures behind the margin above — buyer charge from the Etsy profile, cost from
        Printify. The scenario dials are exploration only and change nothing here.
      </span>

      <div className="row-gap-12" style={{ alignItems: "center", flexWrap: "wrap" }}>
        {data.shippingConfirmed ? (
          <>
            <button className="btn btn-secondary" disabled={busy} onClick={() => toggle(false)}>
              {busy ? <span className="spinner" /> : null}
              Withdraw confirmation
            </button>
            {data.shippingConfirmedAt ? (
              <span className="hint">confirmed {data.shippingConfirmedAt}</span>
            ) : null}
          </>
        ) : (
          <>
            <button
              className="btn btn-save"
              disabled={busy || charged == null}
              title={charged == null ? "No profile figures to confirm yet" : undefined}
              onClick={() => toggle(true)}
            >
              {busy ? <span className="spinner" /> : null}
              Confirm shipping profile
            </button>
            <span className="hint">Flips the publish gate. Nothing is written to Etsy — draft-only.</span>
          </>
        )}
      </div>
    </div>
  );
}
