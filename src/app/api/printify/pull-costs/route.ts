import { NextResponse } from "next/server";
import { pullCosts } from "@/server/printify/probe";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // create + read + delete per 100-variant chunk

/**
 * Pull real account-level costs for ONE product (the probe). One product per
 * request so a big catalog can't time the whole batch out — the client loops.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }
    const result = await pullCosts(String(body.productId));
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
