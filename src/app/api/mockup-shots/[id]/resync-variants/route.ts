import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";
import { DEFAULT_BLEND, parseQuad } from "@/config/mockups";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Re-stamps every variant of one template with the template's CURRENT
 * print region and the CURRENT default blend. Two real incidents behind
 * this: variants keep the quad copied at import time, so a region redrawn
 * later never reaches them (the off-centre Flat Lay Styled renders); and
 * the import once stamped Multiply as the blend, which tints artwork with
 * the garment (the brown margarita glass). One click heals a whole
 * template's variants instead of N hand-edits.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const shot = cachedRecord(id);
    if (!shot || shot.dbKey !== "mockup_shots") {
      return NextResponse.json({ error: "Template not found — refresh first." }, { status: 404 });
    }
    const region = String(shot.props["Print Region Quad (JSON)"] ?? "").trim();
    if (!region) {
      return NextResponse.json({ error: "This template has no print region — draw it first (Edit)." }, { status: 400 });
    }
    const variants = cachedRecords("mockup_templates").filter((t) =>
      ((t.props["Shot"] as string[] | null) ?? []).includes(id)
    );
    // Which variants' geometry ACTUALLY moves — only their renders went
    // stale. A variant already carrying this region keeps its verdicts.
    const changed = new Set(
      variants
        .filter((v) => {
          const before = parseQuad(String(v.props["Print Area Quad (JSON)"] ?? ""));
          const after = parseQuad(region);
          if (!before || !after) return true;
          return !before.every((p, i) => Math.abs(p.x - after[i].x) < 0.002 && Math.abs(p.y - after[i].y) < 0.002);
        })
        .map((v) => v.id)
    );

    for (const v of variants) {
      await updateRecord("mockup_templates", v.id, {
        "Print Area Quad (JSON)": region,
        "Blend Mode": DEFAULT_BLEND,
      });
    }

    // Renders made from the OLD region are now stale. Flagging is exactly
    // the house meaning of stale — excluded from send, and the flag IS
    // the redo list the Regenerate-flagged button reads. Nothing fancier,
    // by decision: the operator regenerates when they're ready.
    const staleByListing = new Map<string, number>();
    for (const g of cachedRecords("generated_mockups")) {
      const variantId = ((g.props["Variant"] as string[] | null) ?? [])[0];
      if (!variantId || !changed.has(variantId)) continue;
      if (String(g.props["Verdict"] ?? "") === "Flagged") continue; // already on the list
      await updateRecord("generated_mockups", g.id, { Verdict: "Flagged" });
      const listingId = ((g.props["Listing"] as string[] | null) ?? [])[0] ?? "?";
      staleByListing.set(listingId, (staleByListing.get(listingId) ?? 0) + 1);
    }
    const staleCount = [...staleByListing.values()].reduce((a, b) => a + b, 0);

    return NextResponse.json({
      updated: variants.length,
      blend: DEFAULT_BLEND,
      moved: changed.size,
      staleFlagged: staleCount,
      listingsAffected: staleByListing.size,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
