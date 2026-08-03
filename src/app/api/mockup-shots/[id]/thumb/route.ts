import { NextResponse } from "next/server";
import { cachedRecord } from "@/server/notion/store";
import { thumbForFresh, ThumbSourceExpiredError, THUMB_HEADERS } from "@/server/thumb";

export const dynamic = "force-dynamic";

/** Template card thumbnail — the cropped sample its geometry was drawn on. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const shot = cachedRecord(id);
    if (!shot || shot.dbKey !== "mockup_shots") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const version = new URL(req.url).searchParams.get("v") ?? shot.lastEdited;
    const thumb = await thumbForFresh("mockup_shots", shot, "Sample Image", version);
    return new NextResponse(new Uint8Array(thumb), { headers: THUMB_HEADERS });
  } catch (err) {
    const expired = err instanceof ThumbSourceExpiredError;
    return NextResponse.json(
      { error: (err as Error).message },
      { status: expired ? 502 : 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
