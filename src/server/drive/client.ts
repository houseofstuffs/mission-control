/**
 * Google Drive client — OAuth 2.0 web flow, read-only scope. Server-side
 * only; tokens never reach the browser.
 *
 * The app is in Google's "Testing" publishing status, which expires
 * refresh tokens after ~7 days. That's not a transient failure: the
 * refresh comes back invalid_grant and the only fix is reconnecting.
 * Callers get a distinctive ReconnectError so the UI can offer exactly
 * that instead of a dead retry button.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function driveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET);
}

function clientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not set.");
  return id;
}

function clientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET is not set.");
  return secret;
}

/** The connection is dead and only a fresh consent fixes it. */
export class ReconnectError extends Error {
  constructor() {
    super("Google Drive connection expired — reconnect to continue. (Testing-mode apps expire weekly.)");
    this.name = "ReconnectError";
  }
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    // offline + consent is what makes Google return a refresh_token on
    // every connect, not just the first — exactly what the weekly
    // Testing-mode re-auth needs
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number; // seconds
  refresh_token?: string; // present on the code exchange, absent on refresh
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    // invalid_grant on a refresh = revoked or Testing-mode-expired token
    if (text.includes("invalid_grant")) throw new ReconnectError();
    throw new Error(`Google token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as TokenResponse;
}

export function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      code,
    })
  );
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
    })
  );
}

/** Accepts a full folder URL, a ?id= form, or a bare folder id. */
export function folderIdFromLink(link: string): string | null {
  const trimmed = link.trim();
  if (!trimmed) return null;
  const folders = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folders) return folders[1];
  const idParam = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return idParam[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

async function apiGet(path: string, accessToken: string): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (res.status === 401) throw new ReconnectError();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return res;
}

/** Every image directly inside the folder — paginated to the end. */
export async function listFolderImages(folderId: string, accessToken: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      fields: "nextPageToken, files(id, name, mimeType, size)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await apiGet(`/files?${params.toString()}`, accessToken);
    const json = (await res.json()) as {
      nextPageToken?: string;
      files?: Array<{ id: string; name: string; mimeType: string; size?: string }>;
    };
    for (const f of json.files ?? []) {
      out.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size ?? 0) });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * The folders directly inside this one. Only asked for when the image list
 * came back empty: "0 recognised" and "you linked the parent folder, the
 * photos are one level down" are the same screen otherwise, and only one of
 * them tells you what to do next.
 */
export async function listSubfolders(folderId: string, accessToken: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
    fields: "files(id, name, mimeType)",
    pageSize: "100",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await apiGet(`/files?${params.toString()}`, accessToken);
  const json = (await res.json()) as { files?: Array<{ id: string; name: string; mimeType: string }> };
  return (json.files ?? []).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: 0 }));
}

/** The file's bytes — the crop itself stays in the browser, where the proven pipeline lives. */
export async function fetchFileBytes(
  fileId: string,
  accessToken: string
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await apiGet(`/files/${fileId}?alt=media&supportsAllDrives=true`, accessToken);
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}
