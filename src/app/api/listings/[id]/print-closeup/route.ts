import { NextResponse } from "next/server";
import sharp from "sharp";
import { archiveRecord, cachedRecord, cachedRecords, createRecord, refreshRecord, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { fetchLayers, fetchMaster, LayerExpiredError } from "@/server/mockup/generateJob";
import { renderMockup } from "@/server/mockup/render";
import { masterPngLink, perColourArt } from "@/server/mockup/plan";
import { createSlotForShotType } from "@/server/imageSlots";
import { MAX_IMAGES } from "@/config/images";
import {
  MOCKUP_CROP_MIN,
  UPLOAD_BUDGET_BYTES,
  DEFAULT_BLEND,
  DEFAULT_FIT,
  parseQuad,
  parsePlacementMap,
  type BlendMode,
  type FitMode,
  type PipelineType,
  type Quad,
} from "@/config/mockups";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The print close-up — a zoom into the PRINT REGION of a chosen render:
 * design on the garment, fabric texture visible. Not a JPEG blow-up: the
 * mockup is RE-RENDERED at the base photo's native resolution (gallery
 * renders are capped at 2000px; a crop of that would always be soft) and
 * the region is cut from those full-sharpness pixels.
 *
 * Framing is a DRAGGABLE CROP BOX on the client (the right crop depends
 * on the artwork, so any fixed ladder of presets was arbitrary — the
 * +40% preset proved not tight enough for a real design and the next
 * step down would overshoot). The box is preloaded at the print-region
 * quad; the 2000px guardrail is a CONSTRAINT on the box, re-checked
 * here, never a disabled option.
 *
 * Bodies:
 *   { optionsFor: generatedId }        — render url + default rect + floor
 *   { generatedId, rect:{x,y,size} }   — build & stage (no slot write)
 *   { assignRecordId, sourceVariantId?, createSlot? } — staged -> slot
 *   { discardRecordId }                — archive a staged close-up
 *
 * rect is a CropRect: x/y as fractions of width/height, size as a
 * fraction of the SHORTER edge — the same contract as the crop-adjust
 * tool, so what the operator drags is exactly what gets cut.
 */

/** cap for the native re-render — bounds CPU on oversized legacy bases */
const NATIVE_EDGE_CAP = 4400;

/** the print-region quad's tight square, normalized — the box's start and reset point */
function regionRect(quad: Quad, W: number, H: number) {
  const xs = quad.map((p) => p.x * W);
  const ys = quad.map((p) => p.y * H);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const side = Math.min(Math.max(bw, bh), Math.min(W, H));
  const left = Math.min(Math.max(cx - side / 2, 0), W - side);
  const top = Math.min(Math.max(cy - side / 2, 0), H - side);
  return { x: left / W, y: top / H, size: side / Math.min(W, H) };
}

/** a client rect in image pixels, clamped inside the frame */
function rectPixels(rect: { x: number; y: number; size: number }, W: number, H: number) {
  const side = Math.round(Math.min(Math.max(rect.size, 0.01), 1) * Math.min(W, H));
  const left = Math.round(Math.min(Math.max(rect.x * W, 0), W - side));
  const top = Math.round(Math.min(Math.max(rect.y * H, 0), H - side));
  return { left, top, side };
}

async function encodeUnderBudget(png: Buffer): Promise<Buffer> {
  for (const quality of [90, 82, 74, 66, 58]) {
    const out = await sharp(png).webp({ quality }).toBuffer();
    if (out.length <= UPLOAD_BUDGET_BYTES) return out;
  }
  throw new Error("The close-up won't compress under Notion's upload cap.");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found — refresh first." }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));

    const closeupSlot = () =>
      cachedRecords("image_slots")
        .filter(
          (s) =>
            ((s.props["Listing"] as string[] | null) ?? []).includes(id) &&
            String(s.props["Shot Type"] ?? "") === "Closeup Print"
        )
        .sort((a, b) => (Number(a.props["Position"]) || 0) - (Number(b.props["Position"]) || 0))[0];

    // ---- confirm: staged close-up -> the slot ----
    if (body.assignRecordId) {
      const rec = cachedRecord(String(body.assignRecordId));
      if (!rec || rec.dbKey !== "generated_mockups") {
        return NextResponse.json({ error: "That close-up is gone — rebuild it." }, { status: 404 });
      }
      let slot = closeupSlot();
      if (!slot && body.createSlot) {
        // explicit create-and-send — never silent, cap enforced inside
        slot = await createSlotForShotType(id, "Closeup Print", "print detail", "Sell Belief", MAX_IMAGES);
      }
      if (!slot) {
        return NextResponse.json(
          { error: "no Closeup Print slot on this listing", canCreate: true },
          { status: 400 }
        );
      }
      // stamp the source template and land Placed — the close-up comes
      // out of a preview-then-commit flow; there's nothing left to judge
      const srcVariant = cachedRecord(String(body.sourceVariantId ?? ""));
      await updateRecord("image_slots", slot.id, {
        "Asset Ref": `/api/generated-mockups/${rec.id}/file`,
        ...(srcVariant && srcVariant.dbKey === "mockup_templates" ? { "Mockup Template": [srcVariant.id] } : {}),
        Status: "Placed",
      });
      await updateRecord("generated_mockups", rec.id, { "Sent To Slot": [slot.id] });
      return NextResponse.json({
        ok: true,
        slot: { position: Number(slot.props["Position"]) || 0, label: slot.title },
      });
    }

    // ---- discard ----
    if (body.discardRecordId) {
      const rec = cachedRecord(String(body.discardRecordId));
      if (rec && rec.dbKey === "generated_mockups") await archiveRecord("generated_mockups", rec.id);
      return NextResponse.json({ ok: true });
    }

    // both remaining bodies start from a chosen render
    const genId = String(body.optionsFor ?? body.generatedId ?? "");
    const gen = cachedRecord(genId);
    if (!gen || gen.dbKey !== "generated_mockups") {
      return NextResponse.json({ error: "Pick an approved render first." }, { status: 400 });
    }
    const variantId = ((gen.props["Variant"] as string[] | null) ?? [])[0] ?? "";
    let template = variantId ? cachedRecord(variantId) : null;
    if (!template) {
      return NextResponse.json({ error: "That render's variant is gone — refresh the Library." }, { status: 404 });
    }
    const quad = parseQuad(String(template.props["Print Area Quad (JSON)"] ?? ""));
    if (!quad) {
      return NextResponse.json(
        { error: `"${template.title}" has no print-area corners — set them in the Library, Re-sync, then retry.` },
        { status: 400 }
      );
    }

    // base layer, with the expiring-URL retry every other consumer uses
    let layers;
    try {
      layers = await fetchLayers(template);
    } catch (err) {
      if (!(err instanceof LayerExpiredError)) throw err;
      template = await refreshRecord("mockup_templates", variantId);
      layers = await fetchLayers(template);
    }
    if (!layers.base) {
      return NextResponse.json({ error: `"${template.title}" has no base image.` }, { status: 400 });
    }
    const meta = await sharp(layers.base).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    const sourcePx = Math.max(W, H);
    const renderScale = Math.min(1, NATIVE_EDGE_CAP / Math.max(W, H));
    const rw = Math.round(W * renderScale);
    const rh = Math.round(H * renderScale);

    // the crop box works at RENDERED scale (what actually gets cut)
    const renderPx = Math.min(rw, rh);
    // the box can't shrink below the floor — expressed as a size fraction
    const minSizeFrac = Math.min(1, MOCKUP_CROP_MIN / renderPx);

    // ---- probe: everything the crop-box modal needs ----
    if (body.optionsFor) {
      return NextResponse.json({
        ok: true,
        sourcePx,
        renderPx,
        renderUrl: `/api/generated-mockups/${gen.id}/file`,
        defaultRect: regionRect(quad, rw, rh),
        minSizeFrac,
      });
    }

    const rect =
      body.rect && typeof body.rect === "object"
        ? { x: Number(body.rect.x), y: Number(body.rect.y), size: Number(body.rect.size) }
        : null;
    if (!rect || ![rect.x, rect.y, rect.size].every(Number.isFinite)) {
      return NextResponse.json({ error: "Frame the crop first — no rect given." }, { status: 400 });
    }
    const px = rectPixels(rect, rw, rh);
    if (px.side < MOCKUP_CROP_MIN) {
      return NextResponse.json(
        { error: `That framing yields ${px.side}px — under the ${MOCKUP_CROP_MIN}px floor. Drag the box larger.` },
        { status: 400 }
      );
    }

    // ---- re-render at native sharpness, then cut the region ----
    const colour = String(gen.props["Colour"] ?? "");
    const m = masterPngLink(listing);
    if (!m) {
      return NextResponse.json({ error: "The design has no Master PNG Link — save it at C7." }, { status: 400 });
    }
    const overrides = perColourArt(listing);
    const master = await fetchMaster(overrides[colour.trim().toLowerCase()] ?? m.link);
    const placementMap = parsePlacementMap(String(listing.props["Mockup Placement (JSON)"] ?? ""));
    const pipelineType = String(template.props["Pipeline Type"] ?? "") as PipelineType;
    if (pipelineType !== "Simple Placement" && pipelineType !== "Full Displacement") {
      return NextResponse.json({ error: `"${template.title}" has no pipeline type — fix it in the Library.` }, { status: 400 });
    }

    const fullPng = await renderMockup(
      {
        pipelineType,
        quad,
        blend: (String(template.props["Blend Mode"] ?? "") || DEFAULT_BLEND) as BlendMode,
        fit: (String(template.props["Fit"] ?? "") || DEFAULT_FIT) as FitMode,
        placement: placementMap.perVariant[variantId] ?? placementMap.default,
        baseMaxEdge: NATIVE_EDGE_CAP,
      },
      { base: layers.base, displacement: layers.displacement, shadow: layers.shadow, highlight: layers.highlight },
      master,
      null
    );
    const rendered = await sharp(fullPng).metadata();
    // re-derive against the ACTUAL rendered dims — belt and braces if the
    // render pipeline rounded differently than the probe predicted
    const cut = rectPixels(rect, rendered.width ?? rw, rendered.height ?? rh);
    const cropped = await sharp(fullPng)
      .extract({ left: cut.left, top: cut.top, width: cut.side, height: cut.side })
      .png()
      .toBuffer();
    const webp = await encodeUnderBudget(cropped);

    const name = `${(listing.title || "listing").replace(/[\\/:*?"<>|]+/g, "-")} - print closeup`;
    const file = new File([new Uint8Array(webp)], `${name}.webp`, { type: "image/webp" });
    const up = await uploadFileToNotion(file);

    // a composite, not a tile: no Variant, so it can never re-enter the
    // review grid or the send queue. Rebuilds replace it in place.
    const existing = cachedRecords("generated_mockups").find(
      (g) =>
        ((g.props["Listing"] as string[] | null) ?? []).includes(id) &&
        ((g.props["Variant"] as string[] | null) ?? []).length === 0 &&
        String(g.props["Colour"] ?? "") === "Print closeup"
    );
    const values = {
      Name: name,
      Listing: [id],
      Colour: "Print closeup",
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
      source: gen.title || "render",
      colour,
      sourceVariantId: variantId || null,
      outPx: cut.side,
      sourcePx,
      hasSlot: Boolean(closeupSlot()),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
