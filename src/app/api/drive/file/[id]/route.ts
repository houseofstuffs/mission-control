import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/server/drive/connection";
import { fetchFileBytes, ReconnectError } from "@/server/drive/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // full-resolution source photos, ~10MB each

/**
 * Proxies one Drive file's bytes to the browser. Deliberate hop: the crop
 * must run against the ORIGINAL file in the browser, where the proven
 * adaptive pipeline (mockupCrop.ts) lives — duplicating that server-side
 * would fork the one implementation the manual path already trusts.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
      return NextResponse.json({ error: "Bad file id." }, { status: 400 });
    }
    const token = await getValidAccessToken();
    const { bytes, contentType } = await fetchFileBytes(id, token);
    return new NextResponse(bytes, { headers: { "Content-Type": contentType } });
  } catch (err) {
    if (err instanceof ReconnectError) {
      return NextResponse.json({ error: err.message, needsReconnect: true }, { status: 401 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
