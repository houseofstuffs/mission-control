import { NextResponse } from "next/server";
import { seedProduct } from "@/server/printify/seed";
import { CATEGORIES } from "@/config/product-categories";

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
    // category rides along from the seed modal — optional, validated
    let category: string | null = null;
    if (body.category) {
      if (!CATEGORIES.includes(body.category)) {
        return NextResponse.json({ error: `Unknown category "${body.category}"` }, { status: 400 });
      }
      category = String(body.category);
    }
    const result = await seedProduct(blueprintId, providerId, providerName, category);
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
