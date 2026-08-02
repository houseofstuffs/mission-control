import { NextResponse } from "next/server";
import { completeConnect } from "@/server/etsy/connection";

export const dynamic = "force-dynamic";

/**
 * Behind Railway's proxy, req.url resolves to the container's internal
 * address (localhost) rather than the public domain — the same reason
 * oauth/start/route.ts derives its redirect_uri from forwarded headers
 * instead of trusting req.url directly. Landing the browser on "localhost"
 * sends the user's OWN machine to refuse the connection, not the server.
 */
function originFromRequest(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

/** Lands the browser back on Today with a query param the page can read and clear. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = new URL("/", originFromRequest(req));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const etsyError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (etsyError) {
    home.searchParams.set("etsy_error", etsyError);
    return NextResponse.redirect(home);
  }
  if (!code || !state) {
    home.searchParams.set("etsy_error", "Etsy's callback was missing code/state.");
    return NextResponse.redirect(home);
  }

  try {
    const result = await completeConnect(code, state);
    home.searchParams.set("etsy_connected", result.shopName);
  } catch (err) {
    home.searchParams.set("etsy_error", (err as Error).message);
  }
  return NextResponse.redirect(home);
}
