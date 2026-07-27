import { NextResponse } from "next/server";
import { cachedRecord, createRecord } from "@/server/notion/store";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const values: Record<string, SimpleValue> = {
      Name: String(body.name),
      "Current Step": "C1",
      "Step State (JSON)": JSON.stringify({ steps: {}, current: "C1" }),
      "Physical/Digital": body.kind === "Digital" ? "Digital" : "Physical",
      Shop: "STUFFS",
      Channel: "Etsy",
      "External IDs (JSON)": "{}",
    };
    // Ideas don't become Designs until greenlit — the UI only offers
    // greenlit niches, but enforce server-side too.
    if (body.nicheId) {
      const niche = cachedRecord(String(body.nicheId));
      if (!niche || niche.dbKey !== "niches") {
        return NextResponse.json({ error: "Niche not found in cache" }, { status: 400 });
      }
      if (niche.props["Gate"] !== "Greenlit") {
        return NextResponse.json(
          { error: `Niche "${niche.title}" is ${String(niche.props["Gate"] ?? "unevaluated").toLowerCase()} — designs start from greenlit niches only.` },
          { status: 400 }
        );
      }
      values["Niche"] = [String(body.nicheId)];
    }
    if (body.productId) {
      const product = cachedRecord(String(body.productId));
      values["Primary Product"] = [String(body.productId)];
      // Master canvas comes from the product's Printify print areas (§5.1).
      if (product?.props["Print Areas (JSON)"]) {
        values["Master Canvas (JSON)"] = String(product.props["Print Areas (JSON)"]);
      }
    }
    if (body.collectionId) values["Collection"] = [String(body.collectionId)];
    if (body.occasion) values["Occasion"] = String(body.occasion);

    const record = await createRecord("designs", values);
    await createRecord("workflow_log", {
      Name: `${record.title} — Created`,
      Event: "Created",
      Design: [record.id],
      "To Step": "C1",
      At: new Date().toISOString(),
    });
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
