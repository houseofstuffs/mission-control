import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecords, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { getValidAccessToken } from "@/server/drive/connection";
import { folderIdFromLink, listFolderImages, fetchFileBytes, ReconnectError } from "@/server/drive/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // several templates × (folder list + ~7MB download + crop + upload)

/**
 * One-time backfill: templates saved before Sample Image existed get their
 * card thumbnail reconstructed from what they already know — the Drive
 * folder link and the stored crop rect. Any photo in the folder works as
 * the sample (one shoot, one framing; that's the premise of a template).
 *
 * Server-side twin of the client crop (src/lib/mockupCrop.ts squareSource):
 * same normalized rect, same shorter-edge semantics, sharp instead of
 * canvas. Preview-sized on purpose — this is a card image, not a variant.
 *
 * Per-template failures skip and report; the placeholder card stays. Only
 * a dead Drive connection aborts the run, because every later fetch would
 * fail the same way.
 */
export async function POST() {
  try {
    const shots = cachedRecords("mockup_shots").filter((s) => {
      const sample = s.props["Sample Image"];
      return !Array.isArray(sample) || sample.length === 0;
    });
    if (shots.length === 0) {
      return NextResponse.json({ results: [], done: "Every template already has a thumbnail." });
    }

    const token = await getValidAccessToken();
    const results: Array<{ name: string; ok: boolean; detail: string }> = [];

    for (const shot of shots) {
      const name = shot.title || "Untitled template";
      try {
        const folderId = folderIdFromLink(String(shot.props["Drive Folder Link"] ?? ""));
        if (!folderId) {
          results.push({ name, ok: false, detail: "no Drive folder link — placeholder stays" });
          continue;
        }
        let rect: { x: number; y: number; size: number } | null = null;
        try {
          const parsed = JSON.parse(String(shot.props["Crop Rect (JSON)"] ?? ""));
          if (typeof parsed?.x === "number" && typeof parsed?.y === "number" && typeof parsed?.size === "number" && parsed.size > 0) {
            rect = parsed;
          }
        } catch {
          /* fall through to the skip below */
        }
        if (!rect) {
          results.push({ name, ok: false, detail: "no stored crop rect — placeholder stays" });
          continue;
        }

        const files = await listFolderImages(folderId, token);
        if (files.length === 0) {
          results.push({ name, ok: false, detail: "folder has no images — placeholder stays" });
          continue;
        }
        // smallest file: same framing as every other, cheapest to move
        const pick = [...files].sort((a, b) => a.size - b.size)[0];
        const { bytes } = await fetchFileBytes(pick.id, token);

        const buf = Buffer.from(bytes);
        const meta = await sharp(buf).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        if (!w || !h) {
          results.push({ name, ok: false, detail: `${pick.name}: unreadable image` });
          continue;
        }
        // squareSource, in sharp: side off the shorter edge, clamped inside
        const side = Math.min(Math.round(rect.size * Math.min(w, h)), w, h);
        const left = Math.round(Math.min(Math.max(rect.x * w, 0), Math.max(w - side, 0)));
        const top = Math.round(Math.min(Math.max(rect.y * h, 0), Math.max(h - side, 0)));
        const target = Math.min(1200, side); // card image — never upscale
        const out = await sharp(buf)
          .extract({ left, top, width: side, height: side })
          .resize(target, target)
          .webp({ quality: 82 })
          .toBuffer();

        const file = new File([new Uint8Array(out)], `${name} sample-${target}.webp`, { type: "image/webp" });
        const up = await uploadFileToNotion(file);
        await updateRecord("mockup_shots", shot.id, {
          "Sample Image": [{ name: file.name, uploadId: up.id }],
        });
        results.push({ name, ok: true, detail: `from ${pick.name} · ${target}×${target}` });
      } catch (err) {
        if (err instanceof ReconnectError) throw err; // dead connection — abort, don't grind
        results.push({ name, ok: false, detail: (err as Error).message });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof ReconnectError) {
      return NextResponse.json({ error: err.message, needsReconnect: true }, { status: 401 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
