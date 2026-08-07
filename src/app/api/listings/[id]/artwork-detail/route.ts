import { NextResponse } from "next/server";
import sharp from "sharp";
import { archiveRecord, cachedRecord, cachedRecords, createRecord, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { fetchMaster } from "@/server/mockup/generateJob";
import { masterPngLink } from "@/server/mockup/plan";
import { applyWatermark, parseWatermark } from "@/server/mockup/watermark";
import { createSlotForShotType } from "@/server/imageSlots";
import { MAX_IMAGES } from "@/config/images";
import {
  ARTWORK_BACKGROUNDS,
  ARTWORK_PAD_FRAC,
  MOCKUP_CROP_MIN,
  UPLOAD_BUDGET_BYTES,
  type ArtworkBackground,
} from "@/config/mockups";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The artwork-detail shot — the design ALONE, no garment, built from the
 * DESIGN MASTER (alpha intact), never from a render.
 *
 * Crop: square, TOP-ANCHORED on the visible-art bounding box. Masters
 * are vertical with the art in the upper portion and empty canvas below;
 * the top square keeps the art and lets the bottom fall away. Art wider
 * than tall is centred instead.
 *
 * Backgrounds: dark (black) or the shop's light eggshell — the operator
 * picks PER DESIGN from side-by-side previews, because dark-built art
 * reads differently on light.
 *
 * Watermark: this is the one image showing the artwork clean — the most
 * rip-off-able thing in the listing — so the tiled "stuffs" mark goes on
 * THIS output only (see watermark.ts). On/off and opacity are settings.
 *
 * Bodies:
 *   { previews: true, watermark? }              — both backgrounds, small, side by side
 *   { background: "dark"|"light", watermark? }  — full-res build & stage
 *   { assignRecordId }                          — staged -> the Artwork Only slot
 *   { discardRecordId }                         — archive
 */

function hexRgb(hex: string): { r: number; g: number; b: number; alpha: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

async function encodeUnderBudget(png: Buffer): Promise<Buffer> {
  for (const quality of [90, 82, 74, 66, 58]) {
    const out = await sharp(png).webp({ quality }).toBuffer();
    if (out.length <= UPLOAD_BUDGET_BYTES) return out;
  }
  throw new Error("The artwork detail won't compress under Notion's upload cap.");
}

/** visible-art bounding box + the square that frames it, in master px */
async function artSquare(master: Buffer) {
  const meta = await sharp(master).metadata();
  const mw = meta.width ?? 0;
  const mh = meta.height ?? 0;
  const { info } = await sharp(master).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
  const bbox = {
    left: -(info.trimOffsetLeft ?? 0),
    top: -(info.trimOffsetTop ?? 0),
    w: info.width,
    h: info.height,
  };
  const pad = ARTWORK_PAD_FRAC * bbox.w;
  const side = Math.round(bbox.w + 2 * pad);
  const left = bbox.left + bbox.w / 2 - side / 2;
  // taller than wide -> top square of the art, bottom falls away;
  // wider than tall -> centred
  const top = bbox.h >= bbox.w ? bbox.top - pad : bbox.top + bbox.h / 2 - side / 2;
  return { mw, mh, side, left: Math.round(left), top: Math.round(top) };
}

/** square canvas in bg colour with the master's square region composited, at outEdge px */
async function composeOn(
  master: Buffer,
  sq: { mw: number; mh: number; side: number; left: number; top: number },
  bgHex: string,
  outEdge: number
): Promise<Buffer> {
  const L = Math.max(0, sq.left);
  const T = Math.max(0, sq.top);
  const R = Math.min(sq.mw, sq.left + sq.side);
  const B = Math.min(sq.mh, sq.top + sq.side);
  const k = outEdge / sq.side;
  const part = await sharp(master)
    .extract({ left: L, top: T, width: R - L, height: B - T })
    .resize(Math.max(1, Math.round((R - L) * k)), Math.max(1, Math.round((B - T) * k)))
    .png()
    .toBuffer();
  return sharp({
    create: { width: outEdge, height: outEdge, channels: 4, background: hexRgb(bgHex) },
  })
    .composite([{ input: part, left: Math.round((L - sq.left) * k), top: Math.round((T - sq.top) * k) }])
    .png()
    .toBuffer();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found — refresh first." }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));

    const artworkSlot = () =>
      cachedRecords("image_slots")
        .filter(
          (s) =>
            ((s.props["Listing"] as string[] | null) ?? []).includes(id) &&
            String(s.props["Shot Type"] ?? "") === "Artwork Only"
        )
        .sort((a, b) => (Number(a.props["Position"]) || 0) - (Number(b.props["Position"]) || 0))[0];

    if (body.assignRecordId) {
      const rec = cachedRecord(String(body.assignRecordId));
      if (!rec || rec.dbKey !== "generated_mockups") {
        return NextResponse.json({ error: "That artwork detail is gone — rebuild it." }, { status: 404 });
      }
      let slot = artworkSlot();
      if (!slot && body.createSlot) {
        slot = await createSlotForShotType(id, "Artwork Only", "artwork detail", "Sell Design", MAX_IMAGES);
      }
      if (!slot) {
        return NextResponse.json(
          { error: "no Artwork Only slot on this listing", canCreate: true },
          { status: 400 }
        );
      }
      // Placed, not Made — the artwork detail arrives from a
      // preview-then-commit flow with nothing left to judge. (No template
      // stamp: it's built from the design master, no variant exists.)
      await updateRecord("image_slots", slot.id, {
        "Asset Ref": `/api/generated-mockups/${rec.id}/file`,
        Status: "Placed",
      });
      await updateRecord("generated_mockups", rec.id, { "Sent To Slot": [slot.id] });
      return NextResponse.json({
        ok: true,
        slot: { position: Number(slot.props["Position"]) || 0, label: slot.title },
      });
    }

    if (body.discardRecordId) {
      const rec = cachedRecord(String(body.discardRecordId));
      if (rec && rec.dbKey === "generated_mockups") await archiveRecord("generated_mockups", rec.id);
      return NextResponse.json({ ok: true });
    }

    const m = masterPngLink(listing);
    if (!m) {
      return NextResponse.json({ error: "The design has no Master PNG Link — save it at C7." }, { status: 400 });
    }
    const wm = parseWatermark(body.watermark);
    const master = await fetchMaster(m.link);
    const sq = await artSquare(master);
    const floorOk = sq.side >= MOCKUP_CROP_MIN;
    const reason = floorOk
      ? null
      : `artwork square is ${sq.side}px — under the ${MOCKUP_CROP_MIN}px floor; export a larger master`;

    // ---- side-by-side previews, no records ----
    if (body.previews) {
      const PREVIEW = 640;
      const out: Record<string, string> = {};
      for (const bg of ["dark", "light"] as const) {
        let img = await composeOn(master, sq, ARTWORK_BACKGROUNDS[bg], PREVIEW);
        img = await applyWatermark(img, PREVIEW, bg, wm);
        out[bg] = `data:image/webp;base64,${(await sharp(img).webp({ quality: 80 }).toBuffer()).toString("base64")}`;
      }
      return NextResponse.json({
        ok: true,
        dark: out.dark,
        light: out.light,
        outPx: sq.side,
        floorOk,
        reason,
        watermark: wm,
      });
    }

    // ---- full-res build & stage ----
    const background = String(body.background ?? "") as ArtworkBackground;
    if (background !== "dark" && background !== "light") {
      return NextResponse.json({ error: "Pick a background — dark or light." }, { status: 400 });
    }
    if (!floorOk) {
      return NextResponse.json({ error: reason }, { status: 400 });
    }
    let full = await composeOn(master, sq, ARTWORK_BACKGROUNDS[background], sq.side);
    full = await applyWatermark(full, sq.side, background, wm);
    const webp = await encodeUnderBudget(full);

    const name = `${(listing.title || "listing").replace(/[\\/:*?"<>|]+/g, "-")} - artwork detail`;
    const file = new File([new Uint8Array(webp)], `${name}.webp`, { type: "image/webp" });
    const up = await uploadFileToNotion(file);

    const existing = cachedRecords("generated_mockups").find(
      (g) =>
        ((g.props["Listing"] as string[] | null) ?? []).includes(id) &&
        ((g.props["Variant"] as string[] | null) ?? []).length === 0 &&
        String(g.props["Colour"] ?? "") === "Artwork detail"
    );
    const values = {
      Name: name,
      Listing: [id],
      Colour: "Artwork detail",
      Image: [{ name: file.name, uploadId: up.id }],
      "Generated At": new Date().toISOString().slice(0, 10),
      Verdict: "Approved",
    };
    const record = existing
      ? await updateRecord("generated_mockups", existing.id, values)
      : await createRecord("generated_mockups", values);

    return NextResponse.json({
      ok: true,
      recordId: record.id,
      url: `/api/generated-mockups/${record.id}/file?v=${encodeURIComponent(record.lastEdited)}`,
      outPx: sq.side,
      background,
      watermark: wm,
      hasSlot: Boolean(artworkSlot()),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
