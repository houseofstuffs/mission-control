import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecord, cachedRecords, createRecord, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { UPLOAD_BUDGET_BYTES } from "@/config/mockups";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** the layouts the operator picks from — cols × rows, all square outputs */
const LAYOUTS: Record<string, { cols: number; rows: number }> = {
  "2x2": { cols: 2, rows: 2 },
  "3x1": { cols: 3, rows: 1 },
  "2x3": { cols: 2, rows: 3 },
  "3x2": { cols: 3, rows: 2 },
  "3x3": { cols: 3, rows: 3 },
};

/** output edge — same ballpark as a render, comfortably over Etsy's 2000px */
// edge-to-edge, no gutter: a colour grid reads as one image, not a contact sheet
const EDGE = 2000;

async function encodeUnderBudget(png: Buffer): Promise<Buffer> {
  for (const quality of [92, 86, 78, 70, 62]) {
    const out = await sharp(png).webp({ quality }).toBuffer();
    if (out.length <= UPLOAD_BUDGET_BYTES) return out;
  }
  throw new Error("The composite won't compress under Notion's upload cap.");
}

/**
 * Tiles approved renders into ONE square image and drops it in the Grid
 * Composite slot — the colour-grid assembly that otherwise means a
 * round-trip through Canva. Renders are already square and already
 * consistent, so this is a resize-and-place, not a design tool: the
 * operator picks the layout and the order is the review grid's order.
 *
 * Body: { layout: "2x2", generatedIds?: string[] } — ids default to every
 * approved render, trimmed to the layout's cell count.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found — refresh first." }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const layout = LAYOUTS[String(body.layout ?? "2x2")];
    if (!layout) {
      return NextResponse.json(
        { error: `Unknown layout — pick one of ${Object.keys(LAYOUTS).join(", ")}.` },
        { status: 400 }
      );
    }
    const cells = layout.cols * layout.rows;

    const approvedAll = cachedRecords("generated_mockups").filter(
      (g) =>
        ((g.props["Listing"] as string[] | null) ?? []).includes(id) &&
        // real tiles only — a previous composite has no Variant, and
        // feeding a grid back into itself is nobody's intent
        ((g.props["Variant"] as string[] | null) ?? []).length > 0 &&
        String(g.props["Verdict"] ?? "") === "Approved" &&
        Array.isArray(g.props["Image"]) &&
        (g.props["Image"] as unknown[]).length > 0
    );
    const picked = Array.isArray(body.generatedIds) && body.generatedIds.length > 0
      ? (body.generatedIds as unknown[])
          .map(String)
          .map((gid) => approvedAll.find((g) => g.id === gid))
          .filter((g): g is NonNullable<typeof g> => Boolean(g))
      : approvedAll;
    if (picked.length === 0) {
      return NextResponse.json(
        { error: "Nothing approved to build from — approve some renders first." },
        { status: 400 }
      );
    }
    if (picked.length < cells) {
      return NextResponse.json(
        { error: `${layout.cols}×${layout.rows} needs ${cells} approved renders — you have ${picked.length}.` },
        { status: 400 }
      );
    }
    const used = picked.slice(0, cells);

    // fetch through our own stable route so expiring Notion URLs re-mint
    const origin = new URL(req.url).origin;
    const tiles: Buffer[] = [];
    for (const g of used) {
      const res = await fetch(`${origin}/api/generated-mockups/${g.id}/file?download=1`, { cache: "no-store" });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Couldn't fetch "${g.title}" (${res.status}) — try regenerating it.` },
          { status: 502 }
        );
      }
      tiles.push(Buffer.from(await res.arrayBuffer()));
    }

    // Cell geometry. Cells are derived from EXACT edge boundaries rather
    // than a floored cell size: 2000/3 floored to 666 leaves a 2px seam
    // and a non-square canvas (a 3×1 came out 1998×2000 in testing).
    // Boundary maths gives every layout a true square with no gap.
    const edgeAt = (i: number, n: number) => Math.round((EDGE * i) / n);
    const composites = [];
    for (let i = 0; i < used.length; i++) {
      const col = i % layout.cols;
      const row = Math.floor(i / layout.cols);
      const left = edgeAt(col, layout.cols);
      const top = edgeAt(row, layout.rows);
      const resized = await sharp(tiles[i])
        .resize(edgeAt(col + 1, layout.cols) - left, edgeAt(row + 1, layout.rows) - top, {
          fit: "cover",
          position: "centre",
        })
        .png()
        .toBuffer();
      composites.push({ input: resized, left, top });
    }
    const png = await sharp({
      create: { width: EDGE, height: EDGE, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite(composites)
      .png()
      .toBuffer();
    const webp = await encodeUnderBudget(png);

    const name = `${(listing.title || "listing").replace(/[\\/:*?"<>|]+/g, "-")} - grid ${layout.cols}x${layout.rows}`;
    const file = new File([new Uint8Array(webp)], `${name}.webp`, { type: "image/webp" });
    const up = await uploadFileToNotion(file);

    // the Grid Composite slot: lowest-position one, filled or not — this
    // action's whole purpose is to fill it, so replacing is intended
    const slot = cachedRecords("image_slots")
      .filter(
        (s) =>
          ((s.props["Listing"] as string[] | null) ?? []).includes(id) &&
          String(s.props["Shot Type"] ?? "") === "Grid Composite"
      )
      .sort((a, b) => (Number(a.props["Position"]) || 0) - (Number(b.props["Position"]) || 0))[0];
    if (!slot) {
      return NextResponse.json(
        { error: "This listing has no Grid Composite slot — seed the slot plan at L5 first." },
        { status: 400 }
      );
    }

    // The composite lives as a generated_mockups record with NO Variant —
    // that's what makes it a composite rather than a tile: the plan can't
    // match it, so it never appears in the review grid or the send queue,
    // while it still gets the stable file route (expiring URLs re-minted)
    // and the download button for free. Rebuilds replace it in place.
    const existing = cachedRecords("generated_mockups").find(
      (g) =>
        ((g.props["Listing"] as string[] | null) ?? []).includes(id) &&
        ((g.props["Variant"] as string[] | null) ?? []).length === 0 &&
        String(g.props["Colour"] ?? "") === "Grid composite"
    );
    const values = {
      Name: name,
      Listing: [id],
      Colour: "Grid composite",
      Image: [{ name: file.name, uploadId: up.id }],
      "Generated At": new Date().toISOString().slice(0, 10),
      Verdict: "Approved",
      "Sent To Slot": [slot.id],
    };
    const record = existing
      ? await updateRecord("generated_mockups", existing.id, values)
      : await createRecord("generated_mockups", values);

    await updateRecord("image_slots", slot.id, {
      "Asset Ref": `/api/generated-mockups/${record.id}/file`,
      Status: "Made",
    });

    return NextResponse.json({
      ok: true,
      used: used.length,
      layout: `${layout.cols}×${layout.rows}`,
      slot: { position: Number(slot.props["Position"]) || 0, label: slot.title },
      colours: used.map((g) => String(g.props["Colour"] ?? "")).filter(Boolean),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
