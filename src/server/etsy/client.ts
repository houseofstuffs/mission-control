/**
 * Etsy Open API v3 client — OAuth 2.0 with PKCE for the authorization code
 * exchange itself (client_id is the Keystring; PKCE protects the code, no
 * secret needed there). But as of Etsy's Feb 9 2026 platform change, the
 * x-api-key header on EVERY v3 call — including the token exchange — must
 * carry both credentials together as "<keystring>:<shared secret>", not
 * the Keystring alone. Pre-Feb-2026 docs (and this file, until this fix)
 * described the Shared Secret as unused under PKCE; that's no longer true.
 *
 * Every authenticated call needs BOTH headers:
 *   x-api-key: <keystring>:<shared secret>
 *   Authorization: Bearer <access_token>
 */
import { createHash, randomBytes } from "node:crypto";

const AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const API_BASE = "https://api.etsy.com/v3/application";

export function etsyConfigured(): boolean {
  return Boolean(process.env.ETSY_KEYSTRING) && Boolean(process.env.ETSY_SHARED_SECRET);
}

function keystring(): string {
  const key = process.env.ETSY_KEYSTRING;
  if (!key) throw new Error("ETSY_KEYSTRING is not set. Register an app at etsy.com/developers first.");
  return key;
}

function sharedSecret(): string {
  const secret = process.env.ETSY_SHARED_SECRET;
  if (!secret) {
    throw new Error(
      "ETSY_SHARED_SECRET is not set. Etsy's x-api-key header requires it alongside the Keystring since Feb 2026 — copy it from etsy.com/developers, same page as the Keystring."
    );
  }
  return secret;
}

/** The x-api-key header value every v3 call needs — Keystring and Shared Secret together. */
function apiKeyHeader(): string {
  return `${keystring()}:${sharedSecret()}`;
}

/* ---------- PKCE ---------- */

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newCodeVerifier(): string {
  return base64url(randomBytes(48));
}

export function codeChallengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function newState(): string {
  return base64url(randomBytes(24));
}

/**
 * shops_r covers Shipping Profiles; listings_r/w are what L7's push needs —
 * reading a draft's state and applying the copy bundle to it. Connections
 * made before the write scopes were added carry only shops_r, so the push
 * asks for a reconnect on its first 403 rather than failing cryptically.
 */
const SCOPES = "shops_r listings_r listings_w";

export function authorizeUrl(redirectUri: string, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: keystring(),
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/* ---------- token exchange ---------- */

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number; // seconds
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-api-key": apiKeyHeader(),
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Etsy token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: keystring(),
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    })
  );
}

export function refreshToken(currentRefreshToken: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: keystring(),
      refresh_token: currentRefreshToken,
    })
  );
}

/** The numeric user id is the prefix of either token, before the first dot — Etsy's documented extraction method, no introspection endpoint exists. */
export function userIdFromToken(token: string): string {
  const id = token.split(".")[0];
  if (!id) throw new Error("Couldn't read a user id out of the Etsy token.");
  return id;
}

/* ---------- authenticated calls ---------- */

/**
 * Serialised throttle: Etsy allows 10 requests/second, and a shipping-profile
 * sync fires one destinations call per profile back-to-back, which clears
 * that ceiling easily. ≥150ms between calls keeps us near 6 rps — the same
 * shape as the Notion client's throttle, for the same reason.
 */
let queue: Promise<unknown> = Promise.resolve();
const GAP_MS = 150;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const result = await fn();
    await new Promise((r) => setTimeout(r, GAP_MS));
    return result;
  });
  // keep the chain alive even when a call fails
  queue = run.catch(() => undefined);
  return run;
}

/**
 * The throttle keeps us under the limit in the steady state; this catches
 * the case where something else (a concurrent sync, Etsy counting more
 * strictly than documented) pushes us over anyway. Backs off and retries
 * rather than stranding a half-finished sync.
 */
const MAX_429_RETRIES = 3;

async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  return apiRequest<T>("GET", path, accessToken);
}

/** Insufficient OAuth scope — the fix is a reconnect, not a retry. */
export class EtsyScopeError extends Error {
  constructor() {
    super(
      "The Etsy connection was made before listing access was added — reconnect Etsy (Today page) to grant it, then push again."
    );
    this.name = "EtsyScopeError";
  }
}

/**
 * One HTTP door for every authenticated Etsy call. WRITE METHODS ARE FOR
 * src/server/etsy/publisher.ts ONLY (spec §2.4) — this helper exists so the
 * throttle and 429 backoff aren't duplicated, not to open a second write
 * path. x-www-form-urlencoded body: Etsy's v3 update endpoints reject JSON.
 */
export async function apiRequest<T>(
  method: "GET" | "PATCH" | "PUT" | "POST",
  path: string,
  accessToken: string,
  body?: Record<string, string>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await throttled(() =>
      fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          "x-api-key": apiKeyHeader(),
          Authorization: `Bearer ${accessToken}`,
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: body ? new URLSearchParams(body).toString() : undefined,
        cache: "no-store",
      })
    );
    if (res.ok) return (await res.json()) as T;

    const text = await res.text().catch(() => "");
    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      // 1s, 2s, 4s — Etsy's per-second window only needs the first one
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (res.status === 403 && /scope|insufficient/i.test(text)) throw new EtsyScopeError();
    throw new Error(`Etsy ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
}

export interface EtsyShop {
  shop_id: number;
  shop_name: string;
}

/**
 * Etsy's response envelope for this endpoint isn't confirmed against a
 * primary source (secondary-source research flagged it) — defensively
 * accepts a bare object, a bare array, or a {results: [...]} list wrapper.
 */
export async function myShop(userId: string, accessToken: string): Promise<EtsyShop> {
  const raw = await apiGet<unknown>(`/users/${userId}/shops`, accessToken);
  const candidate = Array.isArray(raw)
    ? raw[0]
    : Array.isArray((raw as { results?: unknown[] })?.results)
      ? (raw as { results: unknown[] }).results[0]
      : raw;
  const shop = candidate as Partial<EtsyShop> | undefined;
  if (!shop || typeof shop.shop_id !== "number") {
    throw new Error("Etsy didn't return a shop for this account — connect the account that owns the STUFFS shop.");
  }
  return { shop_id: shop.shop_id, shop_name: String(shop.shop_name ?? "") };
}

/**
 * Raw profile shape, loosely typed — Etsy migrated processing-time fields
 * off this object shortly before this was built, so only title/id are
 * trusted; everything else rides along in the raw JSON callers store.
 */
export interface EtsyShippingProfile {
  shipping_profile_id: number;
  title: string;
  [key: string]: unknown;
}

export async function getShippingProfiles(shopId: number, accessToken: string): Promise<EtsyShippingProfile[]> {
  const raw = await apiGet<unknown>(`/shops/${shopId}/shipping-profiles`, accessToken);
  const list = Array.isArray(raw) ? raw : (raw as { results?: unknown[] })?.results;
  return Array.isArray(list) ? (list as EtsyShippingProfile[]) : [];
}

export interface EtsyShippingProfileDestination {
  shipping_profile_destination_id: number;
  destination_country_iso?: string;
  destination_region?: string;
  primary_cost?: { amount: number; divisor: number; currency_code: string };
  secondary_cost?: { amount: number; divisor: number; currency_code: string };
  min_delivery_days?: number;
  max_delivery_days?: number;
  [key: string]: unknown;
}

export async function getShippingProfileDestinations(
  shopId: number,
  profileId: number,
  accessToken: string
): Promise<EtsyShippingProfileDestination[]> {
  const raw = await apiGet<unknown>(
    `/shops/${shopId}/shipping-profiles/${profileId}/destinations`,
    accessToken
  );
  const list = Array.isArray(raw) ? raw : (raw as { results?: unknown[] })?.results;
  return Array.isArray(list) ? (list as EtsyShippingProfileDestination[]) : [];
}
