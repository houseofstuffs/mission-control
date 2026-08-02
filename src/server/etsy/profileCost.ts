/**
 * Reads the buyer-facing US domestic shipping cost out of a synced Etsy
 * Shipping Profile. Kept as its own module — no OAuth or cache imports —
 * so both the Products view and the L3 pricing read can use it without
 * dragging the connection lifecycle along.
 *
 * US/USD only, matching the assumption fees.ts already makes explicit. A
 * profile with no US destination row returns null rather than falling back
 * to another country's rate: a wrong shipping number quietly poisons every
 * margin below it, and a blank is honest.
 */
import type { SimpleRecord } from "@/server/notion/props";

/** Etsy money is {amount, divisor} — 450/100 = $4.50. */
function moneyToDollars(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const m = value as { amount?: number; divisor?: number };
    if (typeof m.amount === "number" && typeof m.divisor === "number" && m.divisor > 0) {
      return m.amount / m.divisor;
    }
  }
  return null;
}

/** What a US buyer is charged for the first item under this profile. */
export function usDomesticCharge(profile: SimpleRecord): number | null {
  let destinations: unknown;
  try {
    destinations = JSON.parse(String(profile.props["Destinations (JSON)"] ?? "[]"));
  } catch {
    return null;
  }
  if (!Array.isArray(destinations)) return null;

  const us = destinations.find(
    (d) => String((d as { destination_country_iso?: string })?.destination_country_iso ?? "") === "US"
  );
  if (!us) return null;
  return moneyToDollars((us as { primary_cost?: unknown }).primary_cost);
}
