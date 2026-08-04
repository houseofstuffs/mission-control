import { NextResponse } from "next/server";
import { cachedRecord, refreshRecord } from "@/server/notion/store";

export const dynamic = "force-dynamic";

/**
 * The stable address of a generated mockup's image. Notion's file URLs
 * expire hourly; everything that references a render — the L4 grid, an L5
 * slot's Asset Ref — points HERE, and this re-mints the signed URL on
 * demand. Redirect, not proxy: the browser fetches the bytes from Notion's
 * CDN directly.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    let rec = cachedRecord(id);
    if (!rec || rec.dbKey !== "generated_mockups") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const url = () => {
      const v = rec!.props["Image"];
      return Array.isArray(v) && v.length > 0 ? ((v[0] as { url?: string })?.url ?? "") : "";
    };
    let target = url();
    if (!target) return NextResponse.json({ error: "No image on this record." }, { status: 404 });
    // cached URL may be expired — probe cheaply and re-mint once
    const head = await fetch(target, { method: "HEAD" }).catch(() => null);
    if (!head || !head.ok) {
      rec = await refreshRecord("generated_mockups", id);
      target = url();
      if (!target) return NextResponse.json({ error: "No image on this record." }, { status: 404 });
    }
    return NextResponse.redirect(target, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
