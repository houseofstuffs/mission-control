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
 * Phase 1 status: interface + flag wiring only. Real Etsy OAuth + calls land
 * in Phase 2 (Listing Optimizer integration). Keeping the boundary in place
 * from day one is the point — scattering Etsy writes turns the mode-two
 * upgrade into surgery.
 */

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
  attributes?: Record<string, string>;
  description?: string; // assembled: hook + body + boilerplate + disclosure
}

/**
 * Apply optimisation fields to an EXISTING draft listing that Printify
 * created. Phase 2 implements this against the Etsy Open API v3.
 */
export async function applyListingOptimisation(_opt: ListingOptimisation): Promise<never> {
  publishMode(); // validate the flag even while stubbed
  throw new Error(
    "Etsy writes are not implemented in Phase 1. This module is the only place they will ever live."
  );
}

/**
 * Poll listing state to detect premature activation (spec §6.1 L7): flag
 * anything that went active before its L6 gates passed. Phase 2.
 */
export async function fetchListingState(_etsyListingId: string): Promise<never> {
  throw new Error("Etsy reads are not implemented in Phase 1.");
}
