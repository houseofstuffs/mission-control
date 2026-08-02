/**
 * Etsy Open API v3 client — OAuth 2.0 with PKCE. Etsy issues a Keystring
 * (the "client_id") to every app, personal-access or not, and never a
 * confidential client secret for this flow — PKCE is the only thing
 * protecting the code exchange, not optional the way it is for some
 * providers.
 *
 * Every authenticated call needs BOTH headers — a documented Etsy quirk,
 * not a mistake:
 *   x-api-key: <keystring>
 *   Authorization: Bearer <access_token>
 */
import { createHash, randomBytes } from "node:crypto";

const AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const API_BASE = "https://api.etsy.com/v3/application";

export function etsyConfigured(): boolean {
  return Boolean(process.env.ETSY_KEYSTRING);
}

function keystring(): string {
  const key = process.env.ETSY_KEYSTRING;
  if (!key) throw new Error("ETSY_KEYSTRING is not set. Register an app at etsy.com/developers first.");
  return key;
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

/** Read-only for now — shops_r covers Shipping Profiles. */
const SCOPES = "shops_r";

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
      "x-api-key": keystring(),
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

async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "x-api-key": keystring(),
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Etsy ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
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
