/**
 * Google Drive connection lifecycle — same storage the Etsy connection
 * uses (cache/db's meta table): single-operator app, one row per key.
 *
 * The one behavioural difference from Etsy: Google's Testing publishing
 * status expires refresh tokens weekly, so "connected" here is a claim
 * that can go stale. Token-using calls throw ReconnectError when that
 * happens, and callers surface a reconnect action rather than a retry.
 */
import { getMeta, setMeta, deleteMeta } from "@/server/cache/db";
import {
  authorizeUrl,
  exchangeCode,
  refreshAccessToken,
  ReconnectError,
} from "./client";
import { randomBytes } from "node:crypto";

const META = {
  state: "google_oauth_state",
  redirectUri: "google_oauth_redirect_uri",
  accessToken: "google_access_token",
  refreshToken: "google_refresh_token",
  expiresAt: "google_token_expires_at",
  connectedAt: "google_connected_at",
} as const;

/** Step 1: the URL to send the browser to, with CSRF state stashed for the callback. */
export function beginConnect(redirectUri: string): string {
  const state = randomBytes(24).toString("base64url");
  setMeta(META.state, state);
  setMeta(META.redirectUri, redirectUri);
  return authorizeUrl(redirectUri, state);
}

/** Step 2: the callback hands over Google's code + state. */
export async function completeConnect(code: string, state: string): Promise<void> {
  const expectedState = getMeta(META.state);
  const redirectUri = getMeta(META.redirectUri);
  if (!expectedState || !redirectUri) {
    throw new Error("No Drive connect flow in progress — start over from the Connect button.");
  }
  if (state !== expectedState) {
    throw new Error("State mismatch on the Google OAuth callback — possible CSRF, connect again.");
  }

  const tokens = await exchangeCode(code, redirectUri);
  if (!tokens.refresh_token) {
    // prompt=consent should force one every time; if Google still didn't
    // send it, the connection would die within the hour — refuse now
    throw new Error("Google didn't return a refresh token — try connecting again.");
  }
  setMeta(META.refreshToken, tokens.refresh_token);
  persistAccessToken(tokens.access_token, tokens.expires_in);
  setMeta(META.connectedAt, new Date().toISOString());
  deleteMeta(META.state);
  deleteMeta(META.redirectUri);
}

function persistAccessToken(accessToken: string, expiresIn: number): void {
  setMeta(META.accessToken, accessToken);
  // a minute of margin so a call started at the edge doesn't fly with a
  // token that expires mid-flight
  setMeta(META.expiresAt, new Date(Date.now() + (expiresIn - 60) * 1000).toISOString());
}

export interface DriveConnectionStatus {
  connected: boolean;
  connectedAt: string | null;
}

export function connectionStatus(): DriveConnectionStatus {
  return {
    connected: Boolean(getMeta(META.refreshToken)),
    connectedAt: getMeta(META.connectedAt),
  };
}

export function disconnect(): void {
  for (const key of [META.accessToken, META.refreshToken, META.expiresAt, META.connectedAt]) {
    deleteMeta(key);
  }
}

/** A usable access token, refreshing if stale. Throws ReconnectError when only a fresh consent can fix it. */
export async function getValidAccessToken(): Promise<string> {
  const refresh = getMeta(META.refreshToken);
  if (!refresh) throw new ReconnectError();

  const expiresAt = getMeta(META.expiresAt);
  const access = getMeta(META.accessToken);
  if (access && expiresAt && new Date(expiresAt).getTime() > Date.now()) {
    return access;
  }

  try {
    const tokens = await refreshAccessToken(refresh);
    persistAccessToken(tokens.access_token, tokens.expires_in);
    return tokens.access_token;
  } catch (err) {
    if (err instanceof ReconnectError) {
      // the stored tokens are dead weight now — clear them so status
      // honestly reads "not connected" instead of claiming a connection
      // that every call will refuse
      disconnect();
    }
    throw err;
  }
}
