/**
 * Etsy fee model + margin math — every rate in one place so a fee change
 * is a one-line edit, not a logic hunt. US seller, USD, free-shipping
 * pricing (fees are computed on the item price alone; if shipping is ever
 * charged separately, Etsy takes its cut of that too and this model
 * understates fees — noted here so nobody trusts it blindly in that case).
 *
 * THE RULE THAT MATTERS: margin math REFUSES when the cost is unknown.
 * A margin computed against a missing cost is a margin decided by
 * accident — the calculator returns null and the UI says why, it never
 * renders $0 and lets a price ship on top of it.
 */

/** per listing, charged on publish and on each renewal after a sale */
export const ETSY_LISTING_FEE = 0.2;
/** of the order total */
export const ETSY_TRANSACTION_PCT = 0.065;
/** Etsy Payments processing, US: 3% + $0.25 */
export const ETSY_PAYMENT_PCT = 0.03;
export const ETSY_PAYMENT_FLAT = 0.25;
/** Offsite Ads — 15% under $10k/yr revenue (mandatory tier), 12% above */
export const ETSY_OFFSITE_ADS_PCT = 0.15;

/** advisory only: net margin below this % of price renders as "thin" */
export const MARGIN_THIN_PCT = 0.2;

export interface MarginBreakdown {
  price: number;
  cost: number;
  listingFee: number;
  transactionFee: number;
  paymentFee: number;
  totalFees: number;
  /** price − fees − cost */
  net: number;
  /** net / price */
  marginPct: number;
  /** the same sale if an Offsite Ad drove it */
  netWithOffsiteAd: number;
  marginPctWithOffsiteAd: number;
}

/**
 * Null when either input is missing or non-positive — the refusal is the
 * feature. Callers explain WHY (no cost snapshot / no price yet); they
 * never substitute a zero.
 */
export function computeMargin(price: number | null, cost: number | null): MarginBreakdown | null {
  if (price == null || cost == null || !(price > 0) || !(cost >= 0)) return null;
  const listingFee = ETSY_LISTING_FEE;
  const transactionFee = price * ETSY_TRANSACTION_PCT;
  const paymentFee = price * ETSY_PAYMENT_PCT + ETSY_PAYMENT_FLAT;
  const totalFees = listingFee + transactionFee + paymentFee;
  const net = price - totalFees - cost;
  const offsite = price * ETSY_OFFSITE_ADS_PCT;
  return {
    price,
    cost,
    listingFee,
    transactionFee,
    paymentFee,
    totalFees,
    net,
    marginPct: net / price,
    netWithOffsiteAd: net - offsite,
    marginPctWithOffsiteAd: (net - offsite) / price,
  };
}

/**
 * The price where net margin crosses zero:
 *   price·(1 − pct fees) − flat fees − cost = 0
 */
export function breakevenPrice(cost: number, withOffsiteAd = false): number {
  const pct =
    ETSY_TRANSACTION_PCT + ETSY_PAYMENT_PCT + (withOffsiteAd ? ETSY_OFFSITE_ADS_PCT : 0);
  return (cost + ETSY_LISTING_FEE + ETSY_PAYMENT_FLAT) / (1 - pct);
}
