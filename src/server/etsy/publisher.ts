/**
 * ═══════════════════════════════════════════════════════════════════════
 *  THE ETSY WRITE MODULE — the ONLY file allowed to write to Etsy.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Non-negotiable (spec §2.4, §10): all Etsy writes go through this one
 * module, behind a publish-mode flag. v1 is DRAFT-ONLY — the dashboard
 * prepares everything; final publish happens in Etsy Shop Manager.
 * "preview-approve" (mode two) is deferred and throws.
 *
 * Division of labour (spec §2.3): Printify OWNS listing creation — product,
 * images, variants, pricing, SKUs, push-to-Etsy-as-draft. This module owns
 * listing OPTIMISATION only: title, tags, attributes, description applied to
 * the draft Printify created. Never both. Nothing in this module may create
 * a listing.
 *
 * Implemented against the Etsy Open API v3 via the shared client transport
 * (apiRequest) — the client owns the throttle and backoff; this module owns
 * every write CALL. Draft-only is enforced by checking the listing's actual
 * state before writing: a live listing is refused, not edited.
 */
import { apiRequest } from "./client";
import { getValidAccessToken, shopId } from "./connection";

export type PublishMode = "draft-only" | "preview-approve";

export function publishMode(): PublishMode {
  const mode = (process.env.ETSY_PUBLISH_MODE ?? "draft-only") as PublishMode;
  if (mode !== "draft-only" && mode !== "preview-approve") {
    throw new Error(`Invalid ETSY_PUBLISH_MODE "${mode}". Valid: draft-only | preview-approve`);
  }
  if (mode === "preview-approve") {
    throw new Error("preview-approve is mode two and is deferred. v1 is draft-only.");
  }
  return mode;
}

export interface ListingOptimisation {
  etsyListingId: string;
  title?: string; // <15 words — short-form confirmed
  tags?: string[]; // 13 tags, ≤20 chars, no repeated stems
  description?: string; // assembled: hook + body copy (the stitched boilerplate)
}

interface EtsyListing {
  listing_id: number;
  state: string; // draft | active | inactive | expired | sold_out | edit
  title: string;
}

/**
 * The draft's current state, straight from Etsy. Also serves premature-
 * activation detection (spec §6.1 L7): anything active before its gates
 * passed shows up here.
 */
export async function fetchListingState(etsyListingId: string): Promise<string> {
  const token = await getValidAccessToken();
  const listing = await apiRequest<EtsyListing>("GET", `/listings/${etsyListingId}`, token);
  return String(listing.state ?? "");
}

/**
 * Apply optimisation fields to an EXISTING draft listing that Printify
 * created. Refuses live listings outright: draft-only means the app never
 * touches anything a buyer can see — publish stays a Shop Manager act.
 * Attributes are NOT applied here: Etsy models them as per-taxonomy
 * structured properties, and pushing free-text at that API silently
 * mangles them — they stay a Shop Manager step, listed in the app.
 */
export async function applyListingOptimisation(opt: ListingOptimisation): Promise<{ state: string }> {
  publishMode(); // draft-only, validated every call
  const state = await fetchListingState(opt.etsyListingId);
  if (state === "active") {
    throw new Error(
      "That Etsy listing is LIVE — v1 only writes to drafts. If this is deliberate, edit it in Shop Manager."
    );
  }

  const body: Record<string, string> = {};
  if (opt.title !== undefined) body.title = opt.title;
  if (opt.description !== undefined) body.description = opt.description;
  if (opt.tags !== undefined) body.tags = opt.tags.join(",");
  if (Object.keys(body).length === 0) throw new Error("Nothing to apply.");

  const token = await getValidAccessToken();
  await apiRequest<EtsyListing>("PATCH", `/shops/${shopId()}/listings/${opt.etsyListingId}`, token, body);
  return { state };
}

/* ---------- listing images (spec §2.3 amendment: the app owns SLOT
   images too — Etsy v3 uploadListingImage takes rank, so slot order
   becomes Etsy order by construction; Printify's own mockups coexist
   at higher ranks) ---------- */

export interface EtsyListingImage {
  listing_image_id: number;
  rank?: number;
  url_570xN?: string;
  [key: string]: unknown;
}

/** Every image currently on the listing — ours and Printify's alike. */
export async function getListingImages(etsyListingId: string): Promise<EtsyListingImage[]> {
  const token = await getValidAccessToken();
  const raw = await apiRequest<unknown>("GET", `/listings/${etsyListingId}/images`, token);
  const list = Array.isArray(raw) ? raw : (raw as { results?: unknown[] })?.results;
  return Array.isArray(list) ? (list as EtsyListingImage[]) : [];
}

/** Upload ONE image at a rank. Caller has already verified the listing is a draft. */
export async function uploadListingImage(
  etsyListingId: string,
  bytes: Buffer,
  filename: string,
  mime: "image/jpeg" | "image/png",
  rank: number
): Promise<EtsyListingImage> {
  publishMode();
  const token = await getValidAccessToken();
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(bytes)], { type: mime }), filename);
  form.append("rank", String(rank));
  return apiRequest<EtsyListingImage>(
    "POST",
    `/shops/${shopId()}/listings/${etsyListingId}/images`,
    token,
    form
  );
}

/** Remove ONE image by id — the replace half of re-push, and the
 *  confirm-gated "remove non-slot images" cleanup. Never called blind:
 *  callers pass ids they read off the listing first. */
export async function deleteListingImage(etsyListingId: string, listingImageId: number): Promise<void> {
  publishMode();
  const token = await getValidAccessToken();
  await apiRequest<unknown>(
    "DELETE",
    `/shops/${shopId()}/listings/${etsyListingId}/images/${listingImageId}`,
    token
  );
}

/** Title, description, tags and state straight off the draft — the read
 *  half of Verify on Etsy. */
export interface EtsyListingDetail {
  listing_id: number;
  state: string;
  title: string;
  description: string;
  tags: string[];
}

export async function fetchListingDetail(etsyListingId: string): Promise<EtsyListingDetail> {
  const token = await getValidAccessToken();
  const raw = await apiRequest<EtsyListingDetail>("GET", `/listings/${etsyListingId}`, token);
  return {
    listing_id: raw.listing_id,
    state: String(raw.state ?? ""),
    title: String(raw.title ?? ""),
    description: String(raw.description ?? ""),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
  };
}
