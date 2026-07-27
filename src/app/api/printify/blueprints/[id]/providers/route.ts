import { NextResponse } from "next/server";
import { listProviders } from "@/server/printify/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const providers = await listProviders(Number(id));
    return NextResponse.json({ providers });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
