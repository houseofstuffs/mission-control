import { NextResponse } from "next/server";
import { beginConnect } from "@/server/drive/connection";
import { driveConfigured } from "@/server/drive/client";

export const dynamic = "force-dynamic";

/** Redirect_uri must exactly match what's authorized on the Google OAuth client — derived from the actual request, not assumed. */
function originFromRequest(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export async function GET(req: Request) {
  if (!driveConfigured()) {
    return NextResponse.json(
      { error: "Google Drive isn't configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." },
      { status: 500 }
    );
  }
  const redirectUri = `${originFromRequest(req)}/api/drive/oauth/callback`;
  return NextResponse.redirect(beginConnect(redirectUri));
}
