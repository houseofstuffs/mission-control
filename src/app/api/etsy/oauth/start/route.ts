import { NextResponse } from "next/server";
import { beginConnect } from "@/server/etsy/connection";
import { etsyConfigured } from "@/server/etsy/client";

export const dynamic = "force-dynamic";

/** Redirect_uri must exactly match what's registered on the Etsy app — derived from the actual request, not assumed. */
function originFromRequest(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export async function GET(req: Request) {
  if (!etsyConfigured()) {
    return NextResponse.json(
      { error: "Etsy isn't configured — both ETSY_KEYSTRING and ETSY_SHARED_SECRET must be set." },
      { status: 500 }
    );
  }
  const redirectUri = `${originFromRequest(req)}/api/etsy/oauth/callback`;
  const url = beginConnect(redirectUri);
  return NextResponse.redirect(url);
}
