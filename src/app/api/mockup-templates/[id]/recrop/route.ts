import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { getValidAccessToken, connectionStatus } from "@/server/drive/connection";
import { fetchFileBytes } from "@/server/drive/client";
import { encodeUnderBudget } from "@/server/drive/importJob";
import { MOCKUP_CROP_MIN, MOCKUP_CROP_SIZE, parseQuad, type Quad } from "@/config/mockups";
import type { SimpleValue } from "@/server/notion/props";

type Rect = { x: number; y: number; size: number };

function parseRect(raw: unknown): Rect | null {
  try {
    const p = JSON.parse(String(raw ?? ""));
    if (p && typeof p.x === "number" && typeof p.y === "number" && typeof p.size === "number") return p;
  } catch {
    /* not set */
  }
  return null;
}

/** the crop's pixel frame — EXACTLY the maths the crop itself uses */
function frame(rect: Rect, w: number, h: number) {
  const side = Math.min(Math.round(rect.size * Math.min(w, h)), w, h);
  const left = Math.round(Math.min(Math.max(rect.x * w, 0), Math.max(w - side, 0)));
  const top = Math.round(Math.min(Math.max(rect.y * h, 0), Math.max(h - side, 0)));
  return { left, top, side };
}

const quadsEqual = (a: Quad, b: Quad) =>
  a.every((p, i) => Math.abs(p.x - b[i].x) < 0.002 && Math.abs(p.y - b[i].y) < 0.002);

/**
 * Re-expresses a quad drawn on the OLD framing in the NEW framing, by way
 * of source pixels. Clamped to [0,1]; reports whether clamping actually
 * moved anything (the print region fell partly outside the new frame).
 */
function remapQuad(quad: Quad, from: Rect, to: Rect, w: number, h: number): { quad: Quad; clipped: boolean } | null {
  const f1 = frame(from, w, h);
  const f2 = frame(to, w, h);
  if (!f1.side || !f2.side) return null;
  let clipped = false;
  const mapped = quad.map((p) => {
    const sx = f1.left + p.x * f1.side;
    const sy = f1.top + p.y * f1.side;
    const nx = (sx - f2.left) / f2.side;
    const ny = (sy - f2.top) / f2.side;
    const cx = Math.min(1, Math.max(0, nx));
    const cy = Math.min(1, Math.max(0, ny));
    if (Math.abs(cx - nx) > 0.001 || Math.abs(cy - ny) > 0.001) clipped = true;
    return { x: cx, y: cy };
  }) as Quad;
  // a quad that clamps into a sliver is no quad at all
  return parseQuad(mapped) ? { quad: mapped, clipped } : null;
}

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function driveFileId(link: string): string | null {
  const m = link.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})/) ?? link.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

/**
 * Re-crops a variant from its ORIGINAL source photo and REPLACES the
 * stored Base Image — a one-time, persisted fix, not a render-time
 * transform, so every future listing inherits the corrected frame with
 * zero repeat work. Same crop pipeline as the import job (min-size guard,
 * budget ladder, adaptive output), because a re-crop that follows
 * different rules than the crop is a new bug factory.
 *
 * Body: { rect: {x, y, size}, driveLink? } — driveLink covers variants
 * imported before source tracking; it's persisted for next time.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const variant = cachedRecord(id);
    if (!variant || variant.dbKey !== "mockup_templates") {
      return NextResponse.json({ error: "Variant not found — refresh first." }, { status: 404 });
    }
    const body = await req.json();
    const rect = body?.rect as { x?: unknown; y?: unknown; size?: unknown } | undefined;
    const x = Number(rect?.x);
    const y = Number(rect?.y);
    const size = Number(rect?.size);
    if (![x, y, size].every(Number.isFinite) || x < 0 || y < 0 || size <= 0 || size > 1 || x > 1 || y > 1) {
      return NextResponse.json({ error: "That crop box doesn't make sense — re-drag it." }, { status: 400 });
    }

    const stored = String(variant.props["Source Drive File"] ?? "").trim();
    const fromLink = body?.driveLink ? driveFileId(String(body.driveLink)) : null;
    const fileId = stored || fromLink;
    if (!fileId) {
      return NextResponse.json(
        { error: "No source reference — paste the source photo's Drive link.", needsSource: true },
        { status: 409 }
      );
    }
    if (!connectionStatus().connected) {
      return NextResponse.json(
        { error: "Google Drive isn't connected — connect it (Library page) first." },
        { status: 400 }
      );
    }

    const token = await getValidAccessToken();
    const { bytes } = await fetchFileBytes(fileId, token);
    const buf = Buffer.from(bytes);
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) {
      return NextResponse.json({ error: "The source file isn't a readable image." }, { status: 400 });
    }

    // same adaptive-output rules as the import — never upscaled, floor
    // enforced against the source's REAL pixels
    const cropPx = Math.round(size * Math.min(w, h));
    if (cropPx < MOCKUP_CROP_MIN) {
      return NextResponse.json(
        { error: `That crop yields ${cropPx}px — under the ${MOCKUP_CROP_MIN}px floor (source is ${w}×${h}). Widen the box.` },
        { status: 400 }
      );
    }
    const side = Math.min(cropPx, w, h);
    const left = Math.round(Math.min(Math.max(x * w, 0), Math.max(w - side, 0)));
    const top = Math.round(Math.min(Math.max(y * h, 0), Math.max(h - side, 0)));
    const encoded = await encodeUnderBudget(buf, { left, top, side }, Math.min(cropPx, MOCKUP_CROP_SIZE));
    if (!encoded) {
      return NextResponse.json(
        { error: `Won't fit Notion's upload cap even at ${MOCKUP_CROP_MIN}px — the source is unusually dense.` },
        { status: 400 }
      );
    }
    const { out, size: target } = encoded;

    // the name carries the ACTUAL output pixels — keep it honest through
    // a re-crop that changed them
    const newName = /\s-\s\d+$/.test(variant.title)
      ? variant.title.replace(/\s-\s\d+$/, ` - ${target}`)
      : variant.title;

    const file = new File([new Uint8Array(out)], `${newName || "variant"}.webp`, { type: "image/webp" });
    const up = await uploadFileToNotion(file);

    // --- re-map the print region to the NEW framing -------------------
    // The quad is normalized to the cropped frame, so re-framing moves
    // the garment under a fixed quad — art drifts off the chest unless
    // the quad rides along. Baseline: a quad that still equals the
    // SHOT's maps from the shot's own rect (that pair is always
    // internally consistent, even for variants re-cropped before
    // remapping existed); a hand-tweaked quad maps from the variant's
    // stored rect — the framing it was tweaked on.
    const newRect: Rect = { x, y, size };
    const variantQuad = parseQuad(String(variant.props["Print Area Quad (JSON)"] ?? ""));
    const storedRect = parseRect(variant.props["Source Crop Rect (JSON)"]);
    const shotId = ((variant.props["Shot"] as string[] | null) ?? [])[0];
    const shot = shotId ? cachedRecord(shotId) : null;
    const shotQuad = shot ? parseQuad(String(shot.props["Print Region Quad (JSON)"] ?? "")) : null;
    const shotRect = shot ? parseRect(shot.props["Crop Rect (JSON)"]) : null;

    let quadStatus: "remapped" | "remapped-clipped" | "unmapped" = "unmapped";
    let mappedQuad: Quad | null = null;
    if (variantQuad) {
      const baseline =
        shotQuad && shotRect && quadsEqual(variantQuad, shotQuad)
          ? { quad: shotQuad, rect: shotRect }
          : storedRect
            ? { quad: variantQuad, rect: storedRect }
            : null;
      if (baseline) {
        const out = remapQuad(baseline.quad, baseline.rect, newRect, w, h);
        if (out) {
          mappedQuad = out.quad;
          quadStatus = out.clipped ? "remapped-clipped" : "remapped";
        }
      }
    }

    const values: Record<string, SimpleValue> = {
      "Base Image": [{ name: file.name, uploadId: up.id }],
      "Source Crop Rect (JSON)": JSON.stringify(newRect),
    };
    if (mappedQuad) values["Print Area Quad (JSON)"] = JSON.stringify(mappedQuad);
    if (newName && newName !== variant.title) values["Name"] = newName;
    if (!stored && fromLink) values["Source Drive File"] = fromLink;
    await updateRecord("mockup_templates", id, values);

    return NextResponse.json({ ok: true, size: target, quad: quadStatus });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
