import { NextResponse } from "next/server";
import { pullShipping } from "@/server/printify/shipping";

export const dynamic = "force-dynamic";

/** One product per request, same shape as pull-costs — the client loops. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }
    const result = await pullShipping(String(body.productId));
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
