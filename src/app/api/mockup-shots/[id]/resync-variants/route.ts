import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";
import { DEFAULT_BLEND } from "@/config/mockups";

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
    for (const v of variants) {
      await updateRecord("mockup_templates", v.id, {
        "Print Area Quad (JSON)": region,
        "Blend Mode": DEFAULT_BLEND,
      });
    }
    return NextResponse.json({ updated: variants.length, blend: DEFAULT_BLEND });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
