/**
 * Mirrors Etsy's Shipping Profiles into Notion — same upsert-by-external-id
 * pattern Printify's product seed already uses. Etsy owns these records;
 * this is a read-only cache, never written back (see src/server/etsy/publisher.ts
 * for why Etsy writes are isolated to one module, and this isn't it).
 */
import { pullShippingProfiles } from "./connection";
import { cachedRecords, createRecord, updateRecord } from "@/server/notion/store";
import type { SimpleValue } from "@/server/notion/props";

/** Etsy's money fields are inconsistent about being a plain number vs. an {amount, divisor} object — take whichever shape shows up. */
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

export interface SyncResult {
  synced: number;
}

export async function syncShippingProfiles(): Promise<SyncResult> {
  const pulled = await pullShippingProfiles();
  const existing = cachedRecords("shipping_profiles");
  const byProfileId = new Map(existing.map((r) => [Number(r.props["Etsy Shipping Profile ID"]), r]));

  for (const { profile, destinations } of pulled) {
    const values: Record<string, SimpleValue> = {
      Name: profile.title,
      "Etsy Shipping Profile ID": profile.shipping_profile_id,
      "Origin Country": String(profile.origin_country_iso ?? ""),
      "Domestic Handling Fee": moneyToDollars(profile.domestic_handling_fee),
      "International Handling Fee": moneyToDollars(profile.international_handling_fee),
      "Destinations (JSON)": JSON.stringify(destinations),
      "Raw Profile (JSON)": JSON.stringify(profile),
      "Synced At": new Date().toISOString(),
    };
    const prior = byProfileId.get(profile.shipping_profile_id);
    if (prior) {
      await updateRecord("shipping_profiles", prior.id, values);
    } else {
      await createRecord("shipping_profiles", values);
    }
  }

  return { synced: pulled.length };
}
