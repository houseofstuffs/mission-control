import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Snapshot upload — POST, not PATCH.
 *
 * Multipart bodies on PATCH don't survive the trip ("Failed to parse body as
 * FormData"); every other upload in this app is a POST, and this one joins
 * them. Text fields ride along so a save with an image is still one request.
 */

/**
 * Transparent artwork needs a backdrop to be legible as a thumbnail — light
 * work vanishes on white, dark work vanishes on black. Picks the contrasting
 * one from the artwork's own alpha-weighted mean luminance. Null when the
 * image is already opaque: nothing to flatten.
 */
async function autoBackdrop(buf: Buffer): Promise<"#ffffff" | "#111111" | null> {
  const meta = await sharp(buf).metadata();
  if (!meta.hasAlpha) return null;
  const { data, info } = await sharp(buf)
    .resize(64, 64, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let lum = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const a = data[i + 3] / 255;
    if (a < 0.05) continue;
    lum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * a;
    weight += a;
  }
  if (weight === 0) return "#ffffff";
  return lum / weight > 140 ? "#111111" : "#ffffff";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const design = cachedRecord(id);
    if (!design || design.dbKey !== "designs") {
      return NextResponse.json({ error: "Design not found in cache — refresh first" }, { status: 404 });
    }

    const form = await req.formData();
    const values: Record<string, SimpleValue> = {};

    // text fields ride along with the image
    const model = form.get("winningModel");
    if (typeof model === "string") values["Winning Model"] = model || null;
    const png = form.get("artworkLink");
    if (typeof png === "string") values["Master PNG Link"] = png || null;
    const psd = form.get("psdLink");
    if (typeof psd === "string") {
      values["PSD Master Link"] = psd || null;
      values["PSD Saved At"] = psd ? new Date().toISOString().slice(0, 10) : null;
    }

    const snapshot = form.get("snapshot");
    if (snapshot && typeof snapshot !== "string" && snapshot.size > 0) {
      if (!snapshot.type.startsWith("image/")) {
        return NextResponse.json({ error: "The snapshot must be an image." }, { status: 400 });
      }
      // Downscale before Notion: a full-res generation is many MB for what
      // renders as a thumbnail. The MASTER file is never touched.
      const raw = Buffer.from(await snapshot.arrayBuffer());
      const choice = String(form.get("snapshotBackdrop") ?? "auto");
      const backdrop =
        choice === "white" ? "#ffffff"
        : choice === "black" ? "#111111"
        : choice === "transparent" ? null
        : await autoBackdrop(raw);
      let pipeline = sharp(raw).resize(1400, 1400, { fit: "inside", withoutEnlargement: true });
      if (backdrop) pipeline = pipeline.flatten({ background: backdrop });
      const resized = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      const thumb = new File([resized], snapshot.name.replace(/\.[^.]+$/, "") + ".png", {
        type: "image/png",
      });
      const upload = await uploadFileToNotion(thumb);
      values["Artwork Snapshot"] = [{ name: thumb.name, uploadId: upload.id }];
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("designs", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
