import { NextResponse } from "next/server";
import { completeConnect } from "@/server/etsy/connection";

export const dynamic = "force-dynamic";

/** Lands the browser back on Today with a query param the page can read and clear. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = new URL("/", url.origin);
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
