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
  } | null;
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
  const [discountInput, setDiscountInput] = useState("0");
  const [shipChargedInput, setShipChargedInput] = useState("0");
  const defaultShipCost = data.product?.estimatedShippingCost ?? null;
  const [shipCostInput, setShipCostInput] = useState(
    defaultShipCost != null ? String(defaultShipCost) : "0"
  );
  const shipCostIsDefault = defaultShipCost != null && shipCostInput === String(defaultShipCost);
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

      {/* the scenario dials — grouped apart because none of them save */}
      <div className="well">
        <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <Kicker>SCENARIO — EXPLORATION ONLY</Kicker>
          <span className="hint">
            Nothing here saves or pushes. Adjust and the margin below moves with it.
          </span>
          {scenarioActive ? (
            <button
              className="btn btn-tertiary"
              style={{ fontSize: 11, padding: "3px 9px", marginLeft: "auto" }}
              onClick={() => {
                setDiscountInput("0");
                setShipChargedInput("0");
                setShipCostInput("0");
                setAdInput("0");
              }}
            >
              Reset to plain sale
            </button>
          ) : null}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
            marginTop: 10,
          }}
        >
          <div className="field">
            <label className="kicker" htmlFor="l3-discount">SALE / DISCOUNT %</label>
            <input
              id="l3-discount"
              className="input"
              type="number"
              step="1"
              min="0"
              max="100"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
            />
            <span className="hint">
              {margin && margin.discount > 0 ? `−${money(margin.discount)} → ${money(margin.salePrice)}` : "models a sale without touching the price"}
            </span>
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
              onChange={(e) => setShipChargedInput(e.target.value)}
            />
            <span className="hint">what the buyer pays · 0 = free shipping</span>
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
            <span className="hint">
              what Printify bills you, on top of product cost
              {defaultShipCost != null ? (
                <>
                  {" · "}
                  {shipCostIsDefault ? "from " : "was "}
                  Printify catalog (${defaultShipCost.toFixed(2)}
                  {data.product?.shippingPulledAt ? `, pulled ${data.product.shippingPulledAt}` : ""}) — edit freely
                </>
              ) : (
                <> · no Printify shipping pull yet for this product, starts at $0</>
              )}
            </span>
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
                <option value="percent">% of order</option>
                <option value="flat">$ per sale</option>
              </select>
            </div>
            {adMode === "percent" ? (
              <>
                <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
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
              </>
            ) : (
              <span className="hint">flat spend attributed to one sale</span>
            )}
          </div>
        </div>
        {/* the tier assumption, printed where it gets read — full width so
            it can't squeeze the advertising column, and on screen every
            visit so it can't quietly go stale */}
        {adMode === "percent" ? (
          <span className="hint" style={{ marginTop: 8 }}>{offsiteAds.note}</span>
        ) : null}
      </div>

      {/* the verdict — only when both real sides exist */}
      {margin ? (
        <div className="well">
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
              {breakeven != null ? `breakeven price ${money(breakeven)}` : "no price breaks even in this scenario"}
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
            <Row label={`Net · ${pct(margin.marginPct)}`} value={margin.net} strong />
          </div>
          {noAdMargin && margin.adCost > 0 ? (
            <span className="hint">
              Advertising is costing {money(margin.adCost)} of this order — without it the same sale
              nets {money(noAdMargin.net)} ({pct(noAdMargin.marginPct)}).
            </span>
          ) : null}
        </div>
      ) : null}
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
