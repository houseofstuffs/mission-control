import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";

export const dynamic = "force-dynamic";

/** Verdict flips — Approve / Flag, persisted where the image lives. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const rec = cachedRecord(id);
    if (!rec || rec.dbKey !== "generated_mockups") {
      return NextResponse.json({ error: "Generated mockup not found — refresh first." }, { status: 404 });
    }
    const body = await req.json();
    const verdict = String(body.verdict ?? "");
    if (verdict !== "Approved" && verdict !== "Flagged") {
      return NextResponse.json({ error: "Verdict must be Approved or Flagged." }, { status: 400 });
    }
    const record = await updateRecord("generated_mockups", id, { Verdict: verdict });
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
