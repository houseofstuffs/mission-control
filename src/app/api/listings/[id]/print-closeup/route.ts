import { NextResponse } from "next/server";
import sharp from "sharp";
import { archiveRecord, cachedRecord, cachedRecords, createRecord, refreshRecord, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { fetchLayers, fetchMaster, LayerExpiredError } from "@/server/mockup/generateJob";
import { renderMockup } from "@/server/mockup/render";
import { masterPngLink, perColourArt } from "@/server/mockup/plan";
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
 * The zoom centres on the template's stored print-area quad — where the
 * design actually sits — never the image centre. Three tightness presets
 * (region +40% / +20% / tight), and the resolution guardrail is honest:
 * an option that can't produce >=2000px is OFFERED DISABLED with the
 * numbers visible, never silently soft.
 *
 * Bodies:
 *   { optionsFor: generatedId }        — preset availability + source px
 *   { generatedId, tightness }         — build & stage (no slot write)
 *   { assignRecordId }                 — staged -> the Closeup Print slot
 *   { discardRecordId }                — archive a staged close-up
 */

const PRESETS = [
  { key: "wide", label: "region +40%", factor: 1.4 },
  { key: "mid", label: "region +20%", factor: 1.2 },
  { key: "tight", label: "tight", factor: 1.0 },
] as const;
type Tightness = (typeof PRESETS)[number]["key"];

/** cap for the native re-render — bounds CPU on oversized legacy bases */
const NATIVE_EDGE_CAP = 4400;

function cropRect(quad: Quad, W: number, H: number, factor: number) {
  const xs = quad.map((p) => p.x * W);
  const ys = quad.map((p) => p.y * H);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const side = Math.round(Math.min(Math.max(bw, bh) * factor, Math.min(W, H)));
  const left = Math.round(Math.min(Math.max(cx - side / 2, 0), W - side));
  const top = Math.round(Math.min(Math.max(cy - side / 2, 0), H - side));
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
      const slot = closeupSlot();
      if (!slot) {
        return NextResponse.json(
          { error: "This listing has no Closeup Print slot — add one at L5 first." },
          { status: 400 }
        );
      }
      await updateRecord("image_slots", slot.id, {
        "Asset Ref": `/api/generated-mockups/${rec.id}/file`,
        Status: "Made",
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

    const presetInfo = PRESETS.map((p) => {
      const { side } = cropRect(quad, rw, rh, p.factor);
      const ok = side >= MOCKUP_CROP_MIN;
      return {
        key: p.key,
        label: p.label,
        outPx: side,
        ok,
        reason: ok
          ? null
          : `${p.key} crop unavailable: this render is ${sourcePx}px, a ${p.key} crop yields ${side}px`,
      };
    });

    // ---- probe: which presets are honest at this source? ----
    if (body.optionsFor) {
      return NextResponse.json({ ok: true, sourcePx, presets: presetInfo });
    }

    const tightness = String(body.tightness ?? "") as Tightness;
    const preset = PRESETS.find((p) => p.key === tightness);
    if (!preset) {
      return NextResponse.json({ error: "Pick a crop tightness — wide, mid or tight." }, { status: 400 });
    }
    const info = presetInfo.find((p) => p.key === tightness)!;
    if (!info.ok) {
      return NextResponse.json({ error: info.reason }, { status: 400 });
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
    const rect = cropRect(quad, rendered.width ?? rw, rendered.height ?? rh, preset.factor);
    const cropped = await sharp(fullPng)
      .extract({ left: rect.left, top: rect.top, width: rect.side, height: rect.side })
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
      tightness,
      outPx: rect.side,
      sourcePx,
      hasSlot: Boolean(closeupSlot()),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
