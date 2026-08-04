import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Approved renders → image slots. Matching, in priority order per mockup:
 *   1. a slot whose Mockup Template relation already names this variant
 *   2. an EMPTY slot (no asset) with the same Shot Type, lowest position
 * The slot gets the app's stable file route as its Asset Ref (so it never
 * carries an expiring Notion URL), the variant relation, and status Made.
 * Unmatched renders are reported, never silently dropped.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found — refresh first." }, { status: 404 });
    }

    const approved = cachedRecords("generated_mockups").filter(
      (g) =>
        ((g.props["Listing"] as string[] | null) ?? []).includes(id) &&
        String(g.props["Verdict"] ?? "") === "Approved" &&
        Array.isArray(g.props["Image"]) &&
        (g.props["Image"] as unknown[]).length > 0
    );
    if (approved.length === 0) {
      return NextResponse.json({ error: "Nothing approved to send." }, { status: 400 });
    }

    const slots = cachedRecords("image_slots")
      .filter((s) => ((s.props["Listing"] as string[] | null) ?? []).includes(id))
      .sort((a, b) => (Number(a.props["Position"]) || 0) - (Number(b.props["Position"]) || 0));
    if (slots.length === 0) {
      return NextResponse.json({ error: "No slot plan yet — seed it at L5 first." }, { status: 400 });
    }

    const taken = new Set<string>();
    const results: Array<{ name: string; detail: string; ok: boolean }> = [];
    for (const g of approved) {
      const variantId = ((g.props["Variant"] as string[] | null) ?? [])[0] ?? "";
      const variant = variantId ? cachedRecord(variantId) : null;
      const shotType = String(variant?.props["Shot Type"] ?? "");
      const name = g.title || "render";

      const byRelation = slots.find(
        (s) =>
          !taken.has(s.id) &&
          ((s.props["Mockup Template"] as string[] | null) ?? []).includes(variantId)
      );
      const byShotType = slots.find(
        (s) =>
          !taken.has(s.id) &&
          !String(s.props["Asset Ref"] ?? "").trim() &&
          !String(s.props["Product Link Role"] ?? "").trim() &&
          shotType !== "" &&
          String(s.props["Shot Type"] ?? "") === shotType
      );
      const slot = byRelation ?? byShotType;
      if (!slot) {
        results.push({ name, detail: `no matching slot (${shotType || "no shot type"})`, ok: false });
        continue;
      }
      taken.add(slot.id);
      await updateRecord("image_slots", slot.id, {
        "Asset Ref": `/api/generated-mockups/${g.id}/file`,
        "Mockup Template": variantId ? [variantId] : [],
        Status: "Made",
      });
      await updateRecord("generated_mockups", g.id, { "Sent To Slot": [slot.id] });
      results.push({ name, detail: `→ slot ${Number(slot.props["Position"]) || "?"} (${slot.title})`, ok: true });
    }
    return NextResponse.json({ results, sent: results.filter((r) => r.ok).length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
