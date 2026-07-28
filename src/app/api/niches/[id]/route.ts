import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

const GATES = ["Unevaluated", "Greenlit", "Parked", "Killed"];

/**
 * Gate decisions from the dashboard — the R7 call (greenlit / parked /
 * killed plus a one-line reason). Written through to Notion, which stays
 * the system of record; deeper research fields are still edited there.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const niche = cachedRecord(id);
    if (!niche || niche.dbKey !== "niches") {
      return NextResponse.json({ error: "Niche not found in cache — refresh first" }, { status: 404 });
    }

    const values: Record<string, SimpleValue> = {};

    if (body.gate != null) {
      if (!GATES.includes(String(body.gate))) {
        return NextResponse.json({ error: `Unknown gate "${body.gate}"` }, { status: 400 });
      }
      values["Gate"] = String(body.gate);
      // Stamp the decision date the first time it leaves Unevaluated.
      if (body.gate !== "Unevaluated" && !niche.props["Evaluated At"]) {
        values["Evaluated At"] = new Date().toISOString().slice(0, 10);
      }
    }
    if (body.gateReason != null) values["Gate Reason"] = String(body.gateReason);
    if (body.beatThesis != null) values["Beat Thesis"] = String(body.beatThesis);

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const record = await updateRecord("niches", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
