/**
 * Etsy connection lifecycle — the OAuth handshake's transient state, and
 * the persisted access/refresh tokens afterward. Same storage the Printify
 * probe already uses for its shop id (cache/db's meta table): this is a
 * single-operator app, so one row per key is enough, no session framework
 * needed.
 */
import { getMeta, setMeta, deleteMeta } from "@/server/cache/db";
import {
  authorizeUrl,
  codeChallengeFor,
  exchangeCode,
  getShippingProfileDestinations,
  getShippingProfiles,
  myShop,
  newCodeVerifier,
  newState,
  refreshToken,
  userIdFromToken,
  type EtsyShippingProfile,
  type EtsyShippingProfileDestination,
} from "./client";

const META = {
  state: "etsy_oauth_state",
  verifier: "etsy_oauth_code_verifier",
  redirectUri: "etsy_oauth_redirect_uri",
  accessToken: "etsy_access_token",
  refreshToken: "etsy_refresh_token",
  expiresAt: "etsy_token_expires_at",
  userId: "etsy_user_id",
  shopId: "etsy_shop_id",
  shopName: "etsy_shop_name",
  connectedAt: "etsy_connected_at",
} as const;

/** Step 1: build the URL to send the browser to, stashing the PKCE pair for the callback. */
export function beginConnect(redirectUri: string): string {
  const verifier = newCodeVerifier();
  const state = newState();
  setMeta(META.verifier, verifier);
  setMeta(META.state, state);
  setMeta(META.redirectUri, redirectUri);
  return authorizeUrl(redirectUri, state, codeChallengeFor(verifier));
}

export interface ConnectResult {
  shopName: string;
}

/** Step 2: the callback route hands us the query params Etsy sent back. */
export async function completeConnect(code: string, state: string): Promise<ConnectResult> {
  const expectedState = getMeta(META.state);
  const verifier = getMeta(META.verifier);
  const redirectUri = getMeta(META.redirectUri);
  if (!expectedState || !verifier || !redirectUri) {
    throw new Error("No Etsy connect flow in progress — start over from the Connect Etsy button.");
  }
  if (state !== expectedState) {
    throw new Error("State mismatch on the Etsy OAuth callback — possible CSRF, connect again.");
  }

  const tokens = await exchangeCode(code, redirectUri, verifier);
  const userId = userIdFromToken(tokens.access_token);
  const shop = await myShop(userId, tokens.access_token);

  persistTokens(tokens);
  setMeta(META.userId, userId);
  setMeta(META.shopId, String(shop.shop_id));
  setMeta(META.shopName, shop.shop_name);
  setMeta(META.connectedAt, new Date().toISOString());
  deleteMeta(META.state);
  deleteMeta(META.verifier);
  deleteMeta(META.redirectUri);

  return { shopName: shop.shop_name };
}

function persistTokens(tokens: { access_token: string; refresh_token: string; expires_in: number }): void {
  setMeta(META.accessToken, tokens.access_token);
  setMeta(META.refreshToken, tokens.refresh_token);
  // subtract a minute of margin so a call started right at the edge doesn't
  // fire with a token that expires mid-flight
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000);
  setMeta(META.expiresAt, expiresAt.toISOString());
}

export interface EtsyConnectionStatus {
  connected: boolean;
  shopName: string | null;
  connectedAt: string | null;
}

export function connectionStatus(): EtsyConnectionStatus {
  return {
    connected: Boolean(getMeta(META.refreshToken)),
    shopName: getMeta(META.shopName),
    connectedAt: getMeta(META.connectedAt),
  };
}

export function disconnect(): void {
  for (const key of [
    META.accessToken,
    META.refreshToken,
    META.expiresAt,
    META.userId,
    META.shopId,
    META.shopName,
    META.connectedAt,
  ]) {
    deleteMeta(key);
  }
}

/** Refreshes when the stored token is expired or missing, then returns a usable one. */
export async function getValidAccessToken(): Promise<string> {
  const refresh = getMeta(META.refreshToken);
  if (!refresh) throw new Error("Etsy isn't connected yet — use the Connect Etsy button first.");

  const expiresAt = getMeta(META.expiresAt);
  const access = getMeta(META.accessToken);
  if (access && expiresAt && new Date(expiresAt).getTime() > Date.now()) {
    return access;
  }

  // Etsy rotates the refresh token on every refresh — the new one MUST
  // replace the stored one, or the next refresh fails.
  const tokens = await refreshToken(refresh);
  persistTokens(tokens);
  return tokens.access_token;
}

function shopId(): number {
  const id = getMeta(META.shopId);
  if (!id) throw new Error("Etsy isn't connected yet — use the Connect Etsy button first.");
  return Number(id);
}

export interface ProfileWithDestinations {
  profile: EtsyShippingProfile;
  destinations: EtsyShippingProfileDestination[];
}

/** Pulls every shipping profile plus its destinations for the connected shop. */
export async function pullShippingProfiles(): Promise<ProfileWithDestinations[]> {
  const accessToken = await getValidAccessToken();
  const shop = shopId();
  const profiles = await getShippingProfiles(shop, accessToken);
  const out: ProfileWithDestinations[] = [];
  for (const profile of profiles) {
    const destinations = await getShippingProfileDestinations(shop, profile.shipping_profile_id, accessToken);
    out.push({ profile, destinations });
  }
  return out;
}
