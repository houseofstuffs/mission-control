import { NextResponse } from "next/server";
import { seedProduct } from "@/server/printify/seed";

export const dynamic = "force-dynamic";

/** Seeds one blueprint × provider pair into Notion (Products + Variants). */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const blueprintId = Number(body.blueprintId);
    const providerId = Number(body.providerId);
    const providerName = String(body.providerName ?? "");
    if (!blueprintId || !providerId) {
      return NextResponse.json({ error: "blueprintId and providerId are required" }, { status: 400 });
    }
    const result = await seedProduct(blueprintId, providerId, providerName);
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
