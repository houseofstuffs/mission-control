import { NextResponse } from "next/server";
import { cachedRecord } from "@/server/notion/store";
import { thumbForFresh, ThumbSourceExpiredError, THUMB_HEADERS } from "@/server/thumb";

export const dynamic = "force-dynamic";

/** Design card thumbnail — the C2 snapshot, card-sized and cacheable. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const design = cachedRecord(id);
    if (!design || design.dbKey !== "designs") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const version = new URL(req.url).searchParams.get("v") ?? design.lastEdited;
    const thumb = await thumbForFresh("designs", design, "Artwork Snapshot", version);
    return new NextResponse(new Uint8Array(thumb), { headers: THUMB_HEADERS });
  } catch (err) {
    const expired = err instanceof ThumbSourceExpiredError;
    return NextResponse.json(
      { error: (err as Error).message },
      { status: expired ? 502 : 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
