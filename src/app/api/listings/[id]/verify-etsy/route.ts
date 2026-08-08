import { NextResponse } from "next/server";
import { cachedRecord } from "@/server/notion/store";
import { etsyConfigured } from "@/server/etsy/client";
import { connectionStatus } from "@/server/etsy/connection";
import { fetchListingDetail, getListingImages } from "@/server/etsy/publisher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Verify on Etsy — read the draft BACK and compare against what the push
 * sent. A timestamp of our own outbound call proves we tried; this proves
 * it landed. Read-only, safe to run any time.
 *
 * Comparison rules:
 *   title        exact string
 *   tags         count + case-insensitive set equality, mismatches named
 *   description  length + leading characters, WHITESPACE-NORMALISED —
 *                Etsy normalises whitespace, byte equality would cry wolf
 *   state        draft (or edit — Etsy's "draft being edited")
 *   images       OUR slots present (stored ids still on the listing) —
 *                never total count: Printify's mockups legitimately
 *                coexist, more images than we sent is not a mismatch
 */

interface VerifyRow {
  label: string;
  ok: boolean;
  expected: string;
  actual: string;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const rec = cachedRecord(id);
    if (!rec || rec.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found in cache — refresh first." }, { status: 404 });
    }
    if (!etsyConfigured() || !connectionStatus().connected) {
      return NextResponse.json({ error: "Etsy isn't connected — use Connect Etsy on the Today page first." }, { status: 400 });
    }
    const etsyListingId = String(rec.props["Etsy Listing ID"] ?? "").trim();
    if (!/^\d+$/.test(etsyListingId)) {
      return NextResponse.json({ error: "No Etsy listing ID on this record." }, { status: 400 });
    }

    // what we SENT — the snapshot the push recorded
    let snapshot: { title?: string; tags?: string[]; description?: string } = {};
    try {
      snapshot = JSON.parse(String(rec.props["Push Snapshot (JSON)"] ?? "{}"));
    } catch {
      /* verified against live record fields below */
    }
    const sentTitle = snapshot.title ?? String(rec.props["Title"] ?? "").trim();
    const sentTags = snapshot.tags ?? String(rec.props["Tags"] ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const sentDescription =
      snapshot.description ??
      [String(rec.props["Description Hook"] ?? "").trim(), String(rec.props["Body Copy"] ?? "").trim()]
        .filter(Boolean)
        .join("\n\n");

    const detail = await fetchListingDetail(etsyListingId);
    const rows: VerifyRow[] = [];

    rows.push({
      label: "Title",
      ok: detail.title === sentTitle,
      expected: sentTitle,
      actual: detail.title,
    });

    const norm = (t: string) => t.trim().toLowerCase();
    const sentSet = new Set(sentTags.map(norm));
    const etsySet = new Set(detail.tags.map(norm));
    const missing = sentTags.filter((t) => !etsySet.has(norm(t)));
    const extra = detail.tags.filter((t) => !sentSet.has(norm(t)));
    rows.push({
      label: "Tags",
      ok: missing.length === 0 && extra.length === 0 && detail.tags.length === sentTags.length,
      expected: `${sentTags.length}: ${sentTags.join(", ")}`,
      actual:
        missing.length === 0 && extra.length === 0
          ? `${detail.tags.length}: all match`
          : `${detail.tags.length}${missing.length ? ` · missing: ${missing.join(", ")}` : ""}${extra.length ? ` · extra: ${extra.join(", ")}` : ""}`,
    });

    const sentDesc = squash(sentDescription);
    const etsyDesc = squash(detail.description);
    const descOk = etsyDesc.length === sentDesc.length && etsyDesc.slice(0, 80) === sentDesc.slice(0, 80);
    rows.push({
      label: "Description",
      ok: descOk,
      expected: `${sentDesc.length} chars · "${sentDesc.slice(0, 60)}…"`,
      actual: `${etsyDesc.length} chars · "${etsyDesc.slice(0, 60)}…"`,
    });

    rows.push({
      label: "State",
      // "edit" is Etsy's draft-mid-edit state — still unpublished
      ok: detail.state === "draft" || detail.state === "edit",
      expected: "draft",
      actual: detail.state,
    });

    // our slot images present — NOT total image count (Printify coexists)
    let pushedImages: Record<string, { etsyImageId: number }> = {};
    try {
      pushedImages = JSON.parse(String(rec.props["Pushed Images (JSON)"] ?? "{}"));
    } catch {
      /* none pushed yet */
    }
    const ourIds = Object.values(pushedImages).map((p) => p.etsyImageId);
    if (ourIds.length > 0) {
      const onListing = new Set((await getListingImages(etsyListingId)).map((i) => i.listing_image_id));
      const present = ourIds.filter((i) => onListing.has(i));
      rows.push({
        label: "Slot images",
        ok: present.length === ourIds.length,
        expected: `${ourIds.length} of our slots on the listing`,
        actual: `${present.length} of ${ourIds.length} present (${onListing.size} images total incl. Printify's)`,
      });
    }

    return NextResponse.json({
      ok: rows.every((r) => r.ok),
      rows,
      verifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
