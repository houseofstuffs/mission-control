import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import { publishGates } from "@/server/publishGates";
import { applyListingOptimisation } from "@/server/etsy/publisher";
import { etsyConfigured } from "@/server/etsy/client";
import { connectionStatus } from "@/server/etsy/connection";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * L7's push: apply the copy bundle — title, 13 tags, hook + body copy — to
 * the Etsy draft that Printify created. The division of labour is spec
 * §2.2: Printify owns creation and the push-to-Etsy-as-draft (done by hand
 * in Printify's UI, set to draft); this applies the OPTIMISATION on top.
 *
 * Server-side gate check on purpose: the UI locks the button while gates
 * fail, and this refuses anyway — a stale page must not be able to push a
 * listing its own gates would block.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const rec = cachedRecord(id);
    if (!rec || rec.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found in cache — refresh first." }, { status: 404 });
    }
    if (!etsyConfigured() || !connectionStatus().connected) {
      return NextResponse.json(
        { error: "Etsy isn't connected — use Connect Etsy on the Today page first." },
        { status: 400 }
      );
    }

    const failing = publishGates(rec).filter((g) => !g.ok);
    if (failing.length > 0) {
      return NextResponse.json(
        { error: `${failing.length} publish gate${failing.length === 1 ? "" : "s"} failing — the push unlocks at all green. First: ${failing[0].label}` },
        { status: 400 }
      );
    }

    const etsyListingId = String(rec.props["Etsy Listing ID"] ?? "").trim();
    if (!/^\d+$/.test(etsyListingId)) {
      return NextResponse.json(
        { error: "No Etsy listing ID on this record — publish the product in Printify (as draft), then paste the draft's listing ID here." },
        { status: 400 }
      );
    }

    // re-push warns instead of duplicating: the client sends confirmRepush
    // only after showing the operator when the last push happened
    const pushedAt = String(rec.props["Pushed At"] ?? "").trim();
    if (pushedAt && !body.confirmRepush) {
      return NextResponse.json(
        { error: `Already pushed ${pushedAt.slice(0, 16).replace("T", " ")} — confirm the re-push to overwrite the draft's copy.`, alreadyPushed: true },
        { status: 409 }
      );
    }

    const title = String(rec.props["Title"] ?? "").trim();
    const tags = String(rec.props["Tags"] ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const hook = String(rec.props["Description Hook"] ?? "").trim();
    const bodyCopy = String(rec.props["Body Copy"] ?? "").trim();
    // the exact assembly L2 previews: hook, blank line, stitched body copy
    const description = [hook, bodyCopy].filter(Boolean).join("\n\n");

    const { state } = await applyListingOptimisation({ etsyListingId, title, tags, description });

    const snapshot = {
      etsyListingId,
      title,
      tags,
      description,
      draftStateAtPush: state,
      pushedAt: new Date().toISOString(),
    };
    const record = await updateRecord("etsy_listings", id, {
      "Pushed At": snapshot.pushedAt,
      "Push Snapshot (JSON)": JSON.stringify(snapshot),
      "Etsy State": "Draft",
    });
    return NextResponse.json({ record, snapshot });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
