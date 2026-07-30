import { NextResponse } from "next/server";
import { cachedRecord, createRecord, updateRecord, archiveRecord } from "@/server/notion/store";
import { screenCopy } from "@/server/anthropic/screen";
import { anthropicConfigured } from "@/server/anthropic/client";
import { cachedRecords } from "@/server/notion/store";
import type { SimpleRecord, SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the screen action waits on a model call

/** What gets screened: the phrase itself plus whatever note came with it. */
function copyText(idea: SimpleRecord): string {
  return [idea.title, String(idea.props["Note"] ?? "")].filter(Boolean).join(" — ");
}

/** The audience, which is usually the source. Empty when no niche is attached. */
function nicheNameFor(idea: SimpleRecord): string | null {
  const nicheId = ((idea.props["Niche"] as string[] | null) ?? [])[0];
  if (!nicheId) return null;
  return cachedRecords("niches").find((n) => n.id === nicheId)?.title ?? null;
}

/** Only text ideas are screened — a photo has no phrase to check. */
function isCopyIdea(idea: SimpleRecord): boolean {
  const type = String(idea.props["Capture Type"] ?? "");
  return type === "Copy" || type === "URL" || type === "";
}

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

    const action = body.action as
      | "discard" | "restore" | "attach" | "promote" | "update" | "delete" | "screen";

    // Manual (re-)screen — synchronous, the card updates on return.
    if (action === "screen") {
      if (!anthropicConfigured()) {
        return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 400 });
      }
      const r = await screenCopy(copyText(idea), nicheNameFor(idea));
      const record = await updateRecord("ideas", id, {
        "Trademark Risk": r.risk,
        "Risk Reason": r.reason,
      });
      return NextResponse.json({ record });
    }

    // Delete is archive — Notion's trash keeps it recoverable for 30 days.
    if (action === "delete") {
      await archiveRecord("ideas", id);
      return NextResponse.json({ ok: true });
    }

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
        // Triaged and Promoted mean the same thing operationally — only the
        // niche's origin differed, so both paths now land on Triaged.
        values = { Niche: [niche.id], Status: "Triaged" };
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

    let record = await updateRecord("ideas", id, values);

    // Attaching a niche is the moment the screen becomes worth trusting: the
    // capture-time pass ran before the audience was known, and the audience is
    // usually where the phrase came from. "Sing your melody" is generic until
    // you know it's being sold to Once fans. Re-screen on the way through —
    // failures leave the prior verdict alone rather than blocking the attach.
    const attached = (action === "attach" || action === "promote") && isCopyIdea(record);
    if (attached && anthropicConfigured()) {
      try {
        const r = await screenCopy(copyText(record), nicheNameFor(record));
        record = await updateRecord("ideas", id, {
          "Trademark Risk": r.risk,
          "Risk Reason": r.reason,
        });
      } catch (err) {
        console.error(`Re-screen on niche attach failed for "${record.title}":`, (err as Error).message);
      }
    }
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
