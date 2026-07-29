import { NextResponse } from "next/server";
import { cachedRecord, createRecord } from "@/server/notion/store";
import { seedSlots } from "@/server/imageSlots";
import { getDbId } from "@/server/cache/db";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // slot seeding writes 17 throttled pages

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const designIds: string[] = Array.isArray(body.designIds) ? body.designIds : [];

    const values: Record<string, SimpleValue> = {
      Name: String(body.name),
      "Current Step": "L1",
      "Step State (JSON)": JSON.stringify({ steps: {}, current: "L1" }),
      "Etsy State": "Not pushed",
      "Origin Type": body.originType ?? "New concept",
      "Physical/Digital": body.kind === "Digital" ? "Digital" : "Physical",
      "Is Multi Variant": Boolean(body.isMultiVariant),
      Shop: "STUFFS",
      Channel: "Etsy",
      "External IDs (JSON)": "{}",
      Designs: designIds,
    };

    if (body.productId) {
      const product = cachedRecord(String(body.productId));
      values["Product"] = [String(body.productId)];
      // cost_at_creation is a snapshot, not a live lookup (§3.4) — Printify
      // prices change and would silently rewrite margin history.
      const cost = product?.props["Base Cost Min"];
      if (typeof cost === "number") {
        values["Cost At Creation"] = cost;
        values["Cost Snapshot At"] = new Date().toISOString().slice(0, 10);
        values["Cost Basis"] = "Printify Standard";
      }
    }
    if (body.parentListingId) values["Parent Listing"] = [String(body.parentListingId)];
    if (body.shopSectionId) values["Shop Section"] = [String(body.shopSectionId)];

    const record = await createRecord("etsy_listings", values);
    // seed the image-slot plan (advisory, fully editable at L5)
    if (getDbId("image_slots")) {
      await seedSlots(record.id, Boolean(body.isMultiVariant));
    }
    await createRecord("workflow_log", {
      Name: `${record.title} — Created new`,
      Event: "Created new",
      Listing: [record.id],
      "To Step": "L1",
      At: new Date().toISOString(),
    });
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
