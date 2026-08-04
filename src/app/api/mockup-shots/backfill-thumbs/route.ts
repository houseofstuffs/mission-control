import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecords, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { getValidAccessToken } from "@/server/drive/connection";
import { folderIdFromLink, listFolderImages, fetchFileBytes, ReconnectError, type DriveFile } from "@/server/drive/client";
import { classifyFile, flatten } from "@/lib/colourFromFilename";

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
 *
 * Which photo becomes the sample: the shop's convention is the PEPPER
 * shot on every template, so the Library reads uniform. Preference order:
 * Pepper → any detected garment colour → smallest unclassified file.
 * Info-graphic files (size charts, care cards) are never eligible — the
 * first run picked one as a template thumbnail, which is exactly the
 * mistake the classifier exists to prevent.
 *
 * body { overwrite: true } re-picks over templates that already have a
 * thumbnail — the one-click correction for the first run's picks.
 */
export async function POST(req: Request) {
  try {
    const overwrite = Boolean(await req.json().then((b) => b?.overwrite).catch(() => false));
    const shots = cachedRecords("mockup_shots").filter((s) => {
      if (overwrite) return true;
      const sample = s.props["Sample Image"];
      return !Array.isArray(sample) || sample.length === 0;
    });
    if (shots.length === 0) {
      return NextResponse.json({ results: [], done: "Every template already has a thumbnail." });
    }
    // the closed set colours are detected against — same palette the
    // review list uses
    const palette = Array.from(
      new Set(
        cachedRecords("product_variants")
          .map((v) => String(v.props["Color"] ?? "").trim())
          .filter(Boolean)
      )
    );

    /** Pepper → any garment colour → smallest unclassified. Never an info graphic. */
    const pickSample = (files: DriveFile[]): DriveFile | null => {
      const classified = files.map((f) => ({ f, role: classifyFile(f.name, palette) }));
      const pepper = classified.find(
        (c) => c.role.kind === "variant" && flatten(c.role.colour) === "pepper"
      );
      if (pepper) return pepper.f;
      const anyColour = classified.find((c) => c.role.kind === "variant");
      if (anyColour) return anyColour.f;
      const unknown = classified
        .filter((c) => c.role.kind === "unknown")
        .sort((a, b) => a.f.size - b.f.size);
      return unknown[0]?.f ?? null;
    };

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
        const pick = pickSample(files);
        if (!pick) {
          results.push({ name, ok: false, detail: "folder holds only info graphics — placeholder stays" });
          continue;
        }
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
