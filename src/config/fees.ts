/**
 * Etsy fee model + margin math — every rate in one place so a fee change
 * is a one-line edit, not a logic hunt. US seller, USD.
 *
 * THE RULE THAT MATTERS: margin math REFUSES when the cost is unknown.
 * A margin computed against a missing cost is a margin decided by
 * accident — the calculator returns null and the UI says why, it never
 * renders $0 and lets a price ship on top of it.
 *
 * Fee base: Etsy charges the transaction fee, the payment-processing fee
 * and Offsite Ads on the ORDER TOTAL — the discounted item price PLUS any
 * shipping the buyer pays. Under free shipping the shipping charge is
 * zero, so the total is just the item price; that was the old model's
 * silent assumption, now an explicit input.
 */

/** per listing, charged on publish and on each renewal after a sale */
export const ETSY_LISTING_FEE = 0.2;
/** of the order total (item + shipping charged) */
export const ETSY_TRANSACTION_PCT = 0.065;
/** Etsy Payments processing, US: 3% + $0.25 of the order total */
export const ETSY_PAYMENT_PCT = 0.03;
export const ETSY_PAYMENT_FLAT = 0.25;

/**
 * Offsite Ads: Etsy's own rate, not a choice — 15% under $10k/yr revenue
 * (the mandatory tier, no opt-out), 12% once a shop crosses $10k (and
 * opt-out becomes available). It only applies to orders an ad actually
 * drove, which is why the panel treats it as a scenario dial rather than
 * a flat cost of doing business.
 *
 * ⚠ REVISIT WHEN STUFFS CLEARS $10,000 IN TRAILING-12-MONTH ETSY REVENUE.
 * At that point: flip OFFSITE_ADS_TIER to "over10k" below — the default
 * preset becomes 12% and the panel stops calling it mandatory. Nobody can
 * verify this from inside the app (Etsy revenue isn't wired in), so it is
 * a human check. The panel prints the assumption next to the input on
 * every visit, which is the reminder — see PricingPanel's ad hint.
 */
export type OffsiteAdsTier = "under10k" | "over10k";
export const OFFSITE_ADS_TIER: OffsiteAdsTier = "under10k";

export const ETSY_OFFSITE_ADS_PCT = 0.15;
export const ETSY_OFFSITE_ADS_PCT_HIGH_VOLUME = 0.12;

/** the rate that applies at the current tier, and whether it's escapable */
export const offsiteAds = {
  pct: OFFSITE_ADS_TIER === "under10k" ? ETSY_OFFSITE_ADS_PCT : ETSY_OFFSITE_ADS_PCT_HIGH_VOLUME,
  mandatory: OFFSITE_ADS_TIER === "under10k",
  /** shown next to the advertising input so the assumption can't sit unseen */
  note:
    OFFSITE_ADS_TIER === "under10k"
      ? "15% assumes STUFFS is under $10k/yr on Etsy (mandatory tier). Past $10k it drops to 12% and becomes optional — update OFFSITE_ADS_TIER in src/config/fees.ts."
      : "12% applies over $10k/yr, and Offsite Ads is optional at this tier.",
} as const;

/** the presets the panel offers; the field still takes any number */
export const AD_PRESETS = [0, 12, 15] as const;

/** advisory only: net margin below this share of the order renders "thin" */
export const MARGIN_THIN_PCT = 0.2;

export type AdMode = "percent" | "flat";

export interface MarginInputs {
  /** the listed price, before any sale */
  price: number;
  /** per-unit product cost (the snapshot) */
  cost: number;
  /** 0–100, exploration only — models a sale without touching the price */
  discountPct?: number;
  /** what the BUYER pays for shipping; 0 = free shipping */
  shippingCharged?: number;
  /** what YOU pay to ship it — Printify bills this on top of product cost */
  shippingCost?: number;
  /** advertising: a share of the order, or a flat spend per sale */
  adMode?: AdMode;
  /** percent when adMode is "percent" (e.g. 15), dollars when "flat" */
  adValue?: number;
}

export interface MarginBreakdown {
  /** price after the exploration discount */
  salePrice: number;
  discount: number;
  shippingCharged: number;
  /** what Etsy's percentage fees are charged on */
  orderTotal: number;
  cost: number;
  shippingCost: number;
  listingFee: number;
  transactionFee: number;
  paymentFee: number;
  adCost: number;
  /** every fee Etsy takes, ads included */
  totalFees: number;
  /** order total − fees − product cost − shipping cost */
  net: number;
  /** net ÷ order total */
  marginPct: number;
}

/**
 * Null when price or cost is missing or nonsensical — the refusal is the
 * feature. Callers explain WHY (no cost snapshot / no price yet); they
 * never substitute a zero.
 */
export function computeMargin(
  price: number | null,
  cost: number | null,
  opts: Omit<MarginInputs, "price" | "cost"> = {}
): MarginBreakdown | null {
  if (price == null || cost == null || !(price > 0) || !(cost >= 0)) return null;

  const discountPct = clamp(opts.discountPct ?? 0, 0, 100);
  const shippingCharged = Math.max(0, opts.shippingCharged ?? 0);
  const shippingCost = Math.max(0, opts.shippingCost ?? 0);
  const discount = price * (discountPct / 100);
  const salePrice = price - discount;
  const orderTotal = salePrice + shippingCharged;

  const listingFee = ETSY_LISTING_FEE;
  const transactionFee = orderTotal * ETSY_TRANSACTION_PCT;
  const paymentFee = orderTotal * ETSY_PAYMENT_PCT + ETSY_PAYMENT_FLAT;
  const adCost =
    opts.adMode === "flat"
      ? Math.max(0, opts.adValue ?? 0)
      : orderTotal * (clamp(opts.adValue ?? 0, 0, 100) / 100);

  const totalFees = listingFee + transactionFee + paymentFee + adCost;
  const net = orderTotal - totalFees - cost - shippingCost;
  return {
    salePrice,
    discount,
    shippingCharged,
    orderTotal,
    cost,
    shippingCost,
    listingFee,
    transactionFee,
    paymentFee,
    adCost,
    totalFees,
    net,
    marginPct: orderTotal > 0 ? net / orderTotal : 0,
  };
}

/**
 * The LIST price where net margin crosses zero, holding the scenario
 * (discount, shipping, ads) fixed. Solves for p in:
 *   (p·(1−d) + shipCharged)·(1 − pctFees) − flatFees − cost − shipCost = 0
 * Returns null when percentage fees swallow the whole order (no price
 * breaks even) rather than reporting a negative or infinite price.
 */
export function breakevenPrice(
  cost: number,
  opts: Omit<MarginInputs, "price" | "cost"> = {}
): number | null {
  const d = clamp(opts.discountPct ?? 0, 0, 100) / 100;
  const shippingCharged = Math.max(0, opts.shippingCharged ?? 0);
  const shippingCost = Math.max(0, opts.shippingCost ?? 0);
  const adPct = opts.adMode === "flat" ? 0 : clamp(opts.adValue ?? 0, 0, 100) / 100;
  const adFlat = opts.adMode === "flat" ? Math.max(0, opts.adValue ?? 0) : 0;
  const pctFees = ETSY_TRANSACTION_PCT + ETSY_PAYMENT_PCT + adPct;
  const keep = 1 - pctFees; // share of each dollar that survives the fees
  if (keep <= 0 || d >= 1) return null;
  const flat = ETSY_LISTING_FEE + ETSY_PAYMENT_FLAT + adFlat;
  const needed = cost + shippingCost + flat - shippingCharged * keep;
  const price = needed / (keep * (1 - d));
  return price > 0 && Number.isFinite(price) ? price : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
