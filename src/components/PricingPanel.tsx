"use client";

/**
 * L3 — the margin calculator. Price in, itemized Etsy fees out, net margin
 * in dollars and percent, live as you type.
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
import { computeMargin, breakevenPrice, MARGIN_THIN_PCT } from "@/config/fees";

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
  } | null;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function PricingPanel({ data }: { data: PricingData }) {
  const router = useRouter();
  const [priceInput, setPriceInput] = useState(data.price != null ? String(data.price) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const price = Number(priceInput);
  const livePrice = Number.isFinite(price) && price > 0 ? price : null;
  const margin = computeMargin(livePrice, data.cost);
  const priceDirty = livePrice !== data.price;

  async function call(label: string, body: Record<string, unknown>) {
    setBusy(label);
    setError(null);
    const res = await apiJson(`/api/listings/${data.listingId}`, "PATCH", body);
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(null);
    return res.ok;
  }

  // the re-snapshot offer: product has an estimate that differs from (or
  // fills) the stored snapshot
  const estimate = data.product?.estimatedCost ?? null;
  const canResnapshot = estimate != null && estimate !== data.cost;

  return (
    <div className="card supporting">
      <Kicker>PRICING — MARGIN CALCULATOR</Kicker>
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
          </div>
        ) : (
          <div className="callout blocked" style={{ marginTop: 6 }}>
            No cost snapshot — the margin calculator refuses to guess.{" "}
            {estimate != null ? (
              <>
                The product estimates {money(estimate)} — snapshot it to unlock the math.
              </>
            ) : (
              <>
                {data.product
                  ? `${data.product.name} has no cost estimate yet — pull costs on the `
                  : "No product on this listing — set one, then pull costs on the "}
                <Link href="/products">Products page</Link> first.
              </>
            )}
          </div>
        )}
        {data.cost == null && estimate != null ? (
          <button
            className="btn btn-secondary"
            style={{ alignSelf: "flex-start", marginTop: 8 }}
            disabled={busy !== null}
            onClick={() => call("snapshot", { resnapshotCost: true })}
          >
            {busy === "snapshot" ? <span className="spinner" /> : null}
            Snapshot cost from product ({money(estimate)})
          </button>
        ) : null}
      </div>

      {/* the price side — live math, saved deliberately */}
      <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ width: 140 }}>
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
        </div>
        <button
          className="btn btn-primary"
          disabled={busy !== null || livePrice == null || !priceDirty}
          onClick={() => call("price", { price: livePrice })}
        >
          {busy === "price" ? <span className="spinner" /> : null}
          Save price
        </button>
        {priceDirty && livePrice != null ? <span className="hint">Unsaved</span> : null}
        {data.cost != null && livePrice == null ? (
          <span className="hint">
            breakeven {money(breakevenPrice(data.cost))} · {money(breakevenPrice(data.cost, true))} if an
            Offsite Ad brings the sale
          </span>
        ) : null}
      </div>

      {/* the verdict — only when both sides exist */}
      {margin ? (
        <div className="well">
          <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <Kicker>MARGIN AT {money(margin.price)}</Kicker>
            {margin.net < 0 ? (
              <span className="chip blocked">underwater</span>
            ) : margin.marginPct < MARGIN_THIN_PCT ? (
              <span className="chip stale">thin — under {pct(MARGIN_THIN_PCT)}</span>
            ) : (
              <span className="chip done">✓ {pct(margin.marginPct)}</span>
            )}
          </div>
          <div className="body-sm" style={{ marginTop: 8, lineHeight: 1.7 }}>
            price {money(margin.price)} − cost {money(margin.cost)} − fees {money(margin.totalFees)}
            <span className="hint">
              {" "}
              (listing {money(margin.listingFee)} · transaction {money(margin.transactionFee)} ·
              processing {money(margin.paymentFee)})
            </span>
            <br />
            <strong>
              net {money(margin.net)} · {pct(margin.marginPct)}
            </strong>
            <br />
            <span className="hint">
              if an Offsite Ad brings the sale: net {money(margin.netWithOffsiteAd)} ·{" "}
              {pct(margin.marginPctWithOffsiteAd)} · breakeven {money(breakevenPrice(margin.cost))} /{" "}
              {money(breakevenPrice(margin.cost, true))} with ad
            </span>
          </div>
        </div>
      ) : null}
      <span className="hint">
        Fees: Etsy US, free-shipping pricing — listing $0.20, transaction 6.5%, processing 3% + $0.25.
        Rates live in src/config/fees.ts. Margin mix is guidance; the hard rule is no cost, no math.
      </span>
    </div>
  );
}
