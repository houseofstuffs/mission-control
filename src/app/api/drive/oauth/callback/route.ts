import { NextResponse } from "next/server";
import { completeConnect } from "@/server/drive/connection";

export const dynamic = "force-dynamic";

/**
 * Lands the browser back on the Library (where the Drive controls live)
 * with a query param the section reads and clears. Origin from forwarded
 * headers — req.url is the container's localhost behind Railway's proxy,
 * the exact bug the Etsy callback had.
 */
function originFromRequest(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = new URL("/library", originFromRequest(req));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  if (googleError) {
    home.searchParams.set("drive_error", googleError);
    return NextResponse.redirect(home);
  }
  if (!code || !state) {
    home.searchParams.set("drive_error", "Google's callback was missing code/state.");
    return NextResponse.redirect(home);
  }
  try {
    await completeConnect(code, state);
    home.searchParams.set("drive_connected", "1");
  } catch (err) {
    home.searchParams.set("drive_error", (err as Error).message);
  }
  return NextResponse.redirect(home);
}
