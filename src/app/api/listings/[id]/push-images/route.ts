import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";
import { etsyConfigured } from "@/server/etsy/client";
import { connectionStatus } from "@/server/etsy/connection";
import {
  deleteListingImage,
  fetchListingState,
  getListingImages,
  uploadListingImage,
} from "@/server/etsy/publisher";
import { fetchMaster } from "@/server/mockup/generateJob";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * L7's image push: the filled slots, uploaded to the Etsy draft IN SLOT
 * ORDER — slot 1 lands at rank 1, the search thumbnail, by construction.
 *
 * Additive by default: Printify's own mockups coexist at higher ranks
 * (Etsy re-ranks, never rejects). Removing them is a SEPARATE,
 * explicitly-confirmed action ({ removeImageIds }) that only accepts ids
 * the caller read off the listing first.
 *
 * Idempotent by stored state: each upload's listing_image_id is saved to
 * "Pushed Images (JSON)" AS IT LANDS, so a re-push skips slots whose
 * asset hasn't changed and whose image is still on the listing, replaces
 * changed ones (delete old + upload new), and a run that dies at slot 7
 * resumes from slot 7 — slots 1–6 are already recorded.
 *
 * Codec, per slot (the type-crispness rule):
 *   PNG  — graphic cards (any Product Link Role) and "Artwork Only":
 *          flat art + glyph edges, exactly where JPEG ringing shows.
 *   JPEG q90 — photographic renders (everything else).
 *   Grid Composite — genuinely mixed (flat ground + type + photo cells):
 *          encoded BOTH ways; PNG wins while it stays under 4 MB, else
 *          the JPEG (q92). The result line reports which won and why.
 * Every result line carries format + size, so the first real listing
 * reports its own cost table.
 */

const MIXED_PNG_CAP = 4 * 1024 * 1024;

interface PushedImage {
  etsyImageId: number;
  assetKey: string;
  rank: number;
  format: string;
  bytes: number;
}
type PushedImages = Record<string, PushedImage>;

function parsePushed(raw: unknown): PushedImages {
  try {
    const p = typeof raw === "string" ? JSON.parse(raw || "{}") : {};
    return p && typeof p === "object" && !Array.isArray(p) ? (p as PushedImages) : {};
  } catch {
    return {};
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const rec = cachedRecord(id);
    if (!rec || rec.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found in cache — refresh first." }, { status: 404 });
    }
    if (!etsyConfigured() || !connectionStatus().connected) {
      return NextResponse.json({ error: "Etsy isn't connected — use Connect Etsy on the Today page first." }, { status: 400 });
    }
    const etsyListingId = String(rec.props["Etsy Listing ID"] ?? "").trim();
    if (!/^\d+$/.test(etsyListingId)) {
      return NextResponse.json({ error: "No Etsy listing ID on this record — push the copy bundle first." }, { status: 400 });
    }
    const state = await fetchListingState(etsyListingId);
    if (state === "active") {
      return NextResponse.json(
        { error: "That Etsy listing is LIVE — v1 only writes to drafts. Edit images in Shop Manager if this is deliberate." },
        { status: 400 }
      );
    }
    const body = await req.json().catch(() => ({}));

    // ---- confirm-gated cleanup of non-slot images ----
    if (Array.isArray(body.removeImageIds) && body.removeImageIds.length > 0) {
      const pushed = parsePushed(rec.props["Pushed Images (JSON)"]);
      const ours = new Set(Object.values(pushed).map((p) => p.etsyImageId));
      const onListing = new Set((await getListingImages(etsyListingId)).map((i) => i.listing_image_id));
      const removed: number[] = [];
      for (const rawId of body.removeImageIds) {
        const imageId = Number(rawId);
        // only images that are REALLY on the listing and REALLY not ours
        if (!onListing.has(imageId) || ours.has(imageId)) continue;
        await deleteListingImage(etsyListingId, imageId);
        removed.push(imageId);
      }
      return NextResponse.json({ ok: true, removed: removed.length });
    }

    // ---- the push: filled slots, in slot order ----
    const slots = cachedRecords("image_slots")
      .filter(
        (s) =>
          ((s.props["Listing"] as string[] | null) ?? []).includes(id) &&
          String(s.props["Asset Ref"] ?? "").trim() &&
          ["Made", "Placed"].includes(String(s.props["Status"] ?? ""))
      )
      .sort((a, b) => (Number(a.props["Position"]) || 0) - (Number(b.props["Position"]) || 0));
    if (slots.length === 0) {
      return NextResponse.json({ error: "No filled slots to push — assemble the gallery at L5 first." }, { status: 400 });
    }

    const pushed = parsePushed(rec.props["Pushed Images (JSON)"]);
    const etsyImages = await getListingImages(etsyListingId);
    const onEtsy = new Set(etsyImages.map((i) => i.listing_image_id));

    const results: Array<{
      slot: number; label: string; action: string; format?: string; kb?: number; rank?: number; ok: boolean;
    }> = [];
    let uploaded = 0;
    let skipped = 0;

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const pos = Number(s.props["Position"]) || i + 1;
      const label = s.title || `slot ${pos}`;
      const assetRef = String(s.props["Asset Ref"] ?? "").trim();
      const assetKey = assetRef.split("?")[0];
      const rank = i + 1; // ordinal, not stored position — ranks stay contiguous
      const prior = pushed[s.id];

      if (prior && prior.assetKey === assetKey && onEtsy.has(prior.etsyImageId)) {
        results.push({ slot: pos, label, action: "already on Etsy — unchanged", ok: true });
        skipped++;
        continue;
      }

      try {
        // bytes: our stable route resolves to the render's stored file;
        // hand-pasted external links go through the Drive-aware fetcher
        let bytes: Buffer;
        if (assetRef.startsWith("/api/generated-mockups/")) {
          const genId = /generated-mockups\/([^/?]+)\//.exec(assetRef)?.[1] ?? "";
          const gen = genId ? cachedRecord(genId) : null;
          const url =
            gen && Array.isArray(gen.props["Image"]) && (gen.props["Image"] as unknown[]).length > 0
              ? ((gen.props["Image"] as Array<{ url?: string }>)[0]?.url ?? "")
              : "";
          if (!url) throw new Error("the slot's render has no stored image");
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error(`couldn't fetch the render (${res.status})`);
          bytes = Buffer.from(await res.arrayBuffer());
        } else if (/^https?:\/\//.test(assetRef)) {
          bytes = await fetchMaster(assetRef);
        } else {
          throw new Error(`unrecognised asset ref "${assetRef.slice(0, 60)}"`);
        }

        // codec by slot kind — see the header comment
        const role = String(s.props["Product Link Role"] ?? "").trim();
        const shotType = String(s.props["Shot Type"] ?? "").trim();
        const flatArt = Boolean(role) || shotType === "Artwork Only";
        const mixed = shotType === "Grid Composite";
        let out: Buffer;
        let mime: "image/png" | "image/jpeg";
        let format: string;
        if (flatArt) {
          out = await sharp(bytes).png().toBuffer();
          mime = "image/png";
          format = "png";
        } else if (mixed) {
          const png = await sharp(bytes).png().toBuffer();
          if (png.length <= MIXED_PNG_CAP) {
            out = png;
            mime = "image/png";
            format = "png (mixed, under cap)";
          } else {
            out = await sharp(bytes).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
            mime = "image/jpeg";
            format = `jpeg q92 (png was ${Math.round(png.length / 1024)} KB)`;
          }
        } else {
          out = await sharp(bytes).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
          mime = "image/jpeg";
          format = "jpeg q90";
        }

        // replace: the old image leaves only after the new bytes are ready
        if (prior && onEtsy.has(prior.etsyImageId)) {
          await deleteListingImage(etsyListingId, prior.etsyImageId);
        }
        const ext = mime === "image/png" ? "png" : "jpg";
        const up = await uploadListingImage(etsyListingId, out, `${String(pos).padStart(2, "0")}-${label.replace(/[^\w-]+/g, "_")}.${ext}`, mime, rank);
        pushed[s.id] = {
          etsyImageId: up.listing_image_id,
          assetKey,
          rank,
          format,
          bytes: out.length,
        };
        // persist AS IT LANDS — this is what makes a partial run resumable
        await updateRecord("etsy_listings", id, { "Pushed Images (JSON)": JSON.stringify(pushed) });
        results.push({ slot: pos, label, action: "uploaded", format, kb: Math.round(out.length / 1024), rank, ok: true });
        uploaded++;
      } catch (err) {
        results.push({ slot: pos, label, action: `failed — ${(err as Error).message}`, ok: false });
        return NextResponse.json({
          ok: false,
          results,
          uploaded,
          skipped,
          error: `${uploaded + skipped} of ${slots.length} done — failed at slot ${pos} (${label}). Push again to resume from here; finished slots are skipped.`,
        });
      }
    }

    // how many images on the listing AREN'T ours — the optional cleanup's input
    const finalImages = await getListingImages(etsyListingId);
    const ourIds = new Set(Object.values(pushed).map((p) => p.etsyImageId));
    const others = finalImages.filter((i) => !ourIds.has(i.listing_image_id)).map((i) => i.listing_image_id);

    return NextResponse.json({ ok: true, results, uploaded, skipped, otherImageIds: others });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
