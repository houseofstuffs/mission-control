import { NextResponse } from "next/server";
import { cachedRecord, createRecord, updateRecord } from "@/server/notion/store";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/**
 * Triage actions on an idea: discard, attach to an existing niche, or
 * promote to a NEW niche (gate: Unevaluated — ideas do not become Designs
 * until greenlit, spec §3.3).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const idea = cachedRecord(id);
    if (!idea || idea.dbKey !== "ideas") {
      return NextResponse.json({ error: "Idea not found in cache — refresh first" }, { status: 404 });
    }

    const action = body.action as "discard" | "restore" | "attach" | "promote" | "update";
    let values: Record<string, SimpleValue> = {};

    switch (action) {
      case "discard":
        values = { Status: "Discarded" };
        break;
      case "restore":
        values = { Status: "Inbox" };
        break;
      case "attach": {
        if (!body.nicheId) return NextResponse.json({ error: "nicheId required" }, { status: 400 });
        values = { Niche: [String(body.nicheId)], Status: "Triaged" };
        break;
      }
      case "promote": {
        const niche = await createRecord("niches", {
          Name: body.nicheName || idea.title || "New niche",
          Gate: "Unevaluated",
        });
        values = { Niche: [niche.id], Status: "Promoted" };
        break;
      }
      case "update": {
        for (const key of ["Occasion", "Note"] as const) {
          if (body[key.toLowerCase()] != null) values[key] = String(body[key.toLowerCase()]);
        }
        if (body.occasionDate != null) values["Occasion Date"] = String(body.occasionDate) || null;
        if (body.leadTimeDays != null) values["Lead Time Days"] = Number(body.leadTimeDays);
        const occasionDate = body.occasionDate ?? idea.props["Occasion Date"];
        const lead = body.leadTimeDays ?? idea.props["Lead Time Days"];
        if (occasionDate && lead) {
          const enterBy = new Date(String(occasionDate));
          enterBy.setDate(enterBy.getDate() - Number(lead));
          values["Enter Creative By"] = enterBy.toISOString().slice(0, 10);
        }
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
    }

    const record = await updateRecord("ideas", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
