import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { reconcileListingNames } from "@/server/listingNames";
import { markStepsStale } from "@/server/steps";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Transparent artwork needs a backdrop to be legible as a thumbnail — light
 * work vanishes on white, dark work vanishes on black. Picks the contrasting
 * one from the artwork's own mean luminance (alpha-weighted, so transparent
 * pixels don't drag the average). Returns null when the image is already
 * opaque: nothing to flatten.
 */
async function autoBackdrop(buf: Buffer): Promise<"#ffffff" | "#111111" | null> {
  const meta = await sharp(buf).metadata();
  if (!meta.hasAlpha) return null;
  // analyse a thumbnail — same answer, a fraction of the work
  const { data, info } = await sharp(buf)
    .resize(64, 64, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let lum = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const a = data[i + 3] / 255;
    if (a < 0.05) continue; // effectively invisible
    lum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * a;
    weight += a;
  }
  if (weight === 0) return "#ffffff"; // fully transparent — white is the safe default
  return lum / weight > 140 ? "#111111" : "#ffffff";
}

/**
 * Design field edits from the dashboard — currently C2's artwork capture:
 * a lightweight snapshot (multipart) and/or the link to the master file.
 * The master lives in Drive/S3 per spec §3.6; the snapshot powers Kanban
 * thumbnails and downstream visual reference.
 */
/** "" and undefined → null; never coerce an absent dimension to 0. */
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const design = cachedRecord(id);
    if (!design || design.dbKey !== "designs") {
      return NextResponse.json({ error: "Design not found in cache — refresh first" }, { status: 404 });
    }

    const contentType = req.headers.get("content-type") ?? "";
    const values: Record<string, SimpleValue> = {};
    let productSwapped = false;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const link = form.get("artworkLink");
      if (typeof link === "string") values["Master PNG Link"] = link || null;
      const winningModel = form.get("winningModel");
      if (typeof winningModel === "string") values["Winning Model"] = winningModel || null;
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
        // Downscale before Notion: a full-res generation is many MB, and this
        // is a thumbnail. The MASTER file is never touched — only this preview.
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
    } else {
      const body = await req.json();
      // rename from the board — empty never overwrites a title
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return NextResponse.json({ error: "A design needs a name." }, { status: 400 });
        values["Name"] = name;
      }
      if (body.artworkLink !== undefined) values["Master PNG Link"] = body.artworkLink ? String(body.artworkLink) : null;
      if (body.winningModel !== undefined) values["Winning Model"] = body.winningModel ? String(body.winningModel) : null;
      if (body.masterWidth !== undefined) values["Master Width"] = toNum(body.masterWidth);
      if (body.masterHeight !== undefined) values["Master Height"] = toNum(body.masterHeight);
      // C8 output — saving the link stamps the date the master was saved
      if (body.psdLink !== undefined) {
        values["PSD Master Link"] = body.psdLink ? String(body.psdLink) : null;
        values["PSD Saved At"] = body.psdLink ? new Date().toISOString().slice(0, 10) : null;
      }
      // C8's judgement call — "Unset" is stored as itself, not as empty, so
      // the gate can tell "not looked at yet" from "looked at, unconstrained"
      if (body.garmentCompatibility !== undefined) {
        values["Garment Compatibility"] = body.garmentCompatibility
          ? String(body.garmentCompatibility)
          : null;
      }
      if (body.garmentCompatibilityReason !== undefined) {
        values["Garment Compatibility Reason"] = String(body.garmentCompatibilityReason ?? "");
      }
      if (body.textSource !== undefined) values["Text Source"] = body.textSource ? String(body.textSource) : null;
      if (body.textDetail !== undefined) values["Text Detail"] = String(body.textDetail ?? "");
      if (body.textureDetail !== undefined) values["Texture Detail"] = String(body.textureDetail ?? "");
      if (body.textureId !== undefined) {
        values["Texture"] = body.textureId ? [String(body.textureId)] : [];
      }
      // primary product assignable from the runner — master canvas rides along,
      // same as at creation (§5.1: canvas comes from the product's print areas)
      if (body.productId !== undefined) {
        if (body.productId) {
          const product = cachedRecord(String(body.productId));
          if (!product || product.dbKey !== "products") {
            return NextResponse.json({ error: "Product not found in cache — refresh first" }, { status: 400 });
          }
          values["Primary Product"] = [product.id];
          if (product.props["Print Areas (JSON)"]) {
            values["Master Canvas (JSON)"] = String(product.props["Print Areas (JSON)"]);
          }
          // SWAPPING products (not the first pick) invalidates work sized
          // against the old canvas — flagged after the write, below
          const prior = ((design.props["Primary Product"] as string[] | null) ?? [])[0] ?? null;
          if (prior && prior !== product.id) productSwapped = true;
        } else {
          values["Primary Product"] = [];
        }
      }
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("designs", id, values);
    // renaming the design carries its formulaic listing names along —
    // "{design} — {product}" prefixes follow; hand-renamed listings don't
    if (values["Name"] !== undefined) {
      await reconcileListingNames();
    }
    // A changed master invalidates every recomposition made from the old
    // one — derivatives flip to Stale, and the L6 gate stops trusting them
    // until they're re-saved. Made-only: a Stale one stays Stale.
    const masterKeys = ["Master PNG Link", "Master Width", "Master Height"] as const;
    const masterChanged = masterKeys.some(
      (k) => k in values && (values[k] ?? null) !== (design.props[k] ?? null)
    );
    if (masterChanged) {
      const derivatives = cachedRecords("design_derivatives").filter(
        (d) =>
          ((d.props["Design"] as string[] | null) ?? []).includes(id) &&
          String(d.props["Status"] ?? "") === "Made"
      );
      for (const d of derivatives) {
        await updateRecord("design_derivatives", d.id, { Status: "Stale" });
      }
    }

    // The Phase 2 canvas bug, closed: swapping the primary product rewrote
    // Master Canvas silently while C7's export and C8's dimension check
    // still described the OLD product. Stale, never silent — done steps
    // only; a design that hasn't reached C7 loses nothing.
    if (productSwapped) {
      await markStepsStale(
        id,
        ["C7", "C8"],
        "Primary product changed — the master was sized against the old product's print areas. Re-check C8, re-export if C7's master doesn't fit the new canvas."
      );
    }
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
