/**
 * Listing names follow their Design — for FORMULAIC names only.
 *
 * Fan-out names listings "{design} — {product}"; renaming the design used
 * to strand them on the old prefix. This reconcile rewrites the prefix to
 * the design's current title whenever the suffix still matches the
 * listing's product (blueprint title or house label — both generations of
 * the formula). A hand-renamed listing never matches the pattern and is
 * never touched.
 *
 * Runs after a design rename and on refresh — same compute-on-refresh
 * pattern as keyword buckets.
 */
import { cachedRecords, updateRecord } from "@/server/notion/store";
import { productLabel } from "@/server/viewmodels";

export async function reconcileListingNames(): Promise<number> {
  const designTitles = new Map(cachedRecords("designs").map((d) => [d.id, d.title]));
  const products = new Map(cachedRecords("products").map((p) => [p.id, p]));
  let fixed = 0;
  for (const l of cachedRecords("etsy_listings")) {
    const designTitle = designTitles.get(((l.props["Designs"] as string[] | null) ?? [])[0] ?? "");
    const product = products.get(((l.props["Product"] as string[] | null) ?? [])[0] ?? "");
    if (!designTitle || !product) continue;
    const cut = l.title.lastIndexOf(" — ");
    if (cut === -1) continue;
    const prefix = l.title.slice(0, cut);
    const suffix = l.title.slice(cut + 3);
    const formulaic =
      suffix === String(product.props["Blueprint Title"] ?? "").trim() ||
      suffix === productLabel(product);
    if (!formulaic || prefix === designTitle) continue;
    await updateRecord("etsy_listings", l.id, { Name: `${designTitle} — ${suffix}` });
    fixed++;
  }
  return fixed;
}
