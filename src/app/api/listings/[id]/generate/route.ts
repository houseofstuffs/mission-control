import { NextResponse } from "next/server";
import { startGenerateJob, generateJobStatus } from "@/server/mockup/generateJob";

export const dynamic = "force-dynamic";

/** Kick off the compositor for one listing; GET polls its progress. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const existing = generateJobStatus(id);
    if (existing?.status === "running") {
      return NextResponse.json(
        { error: `A generate run is already going (${existing.done}/${existing.total}) — wait for it.` },
        { status: 409 }
      );
    }
    const job = startGenerateJob({ listingId: id, regenerate: Boolean(body.regenerate) });
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ job: generateJobStatus(id) });
}
