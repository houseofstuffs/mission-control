import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { getValidAccessToken, connectionStatus } from "@/server/drive/connection";
import { fetchFileBytes } from "@/server/drive/client";
import { encodeUnderBudget } from "@/server/drive/importJob";
import { MOCKUP_CROP_MIN, MOCKUP_CROP_SIZE } from "@/config/mockups";
import type { SimpleValue } from "@/server/notion/props";

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

    const values: Record<string, SimpleValue> = {
      "Base Image": [{ name: file.name, uploadId: up.id }],
      "Source Crop Rect (JSON)": JSON.stringify({ x, y, size }),
    };
    if (newName && newName !== variant.title) values["Name"] = newName;
    if (!stored && fromLink) values["Source Drive File"] = fromLink;
    await updateRecord("mockup_templates", id, values);

    return NextResponse.json({ ok: true, size: target });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
