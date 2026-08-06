import { NextResponse } from "next/server";
import { cachedRecord, refreshRecord } from "@/server/notion/store";

export const dynamic = "force-dynamic";

/**
 * The stable address of a generated mockup's image. Notion's file URLs
 * expire hourly; everything that references a render — the L4 grid, an L5
 * slot's Asset Ref — points HERE, and this re-mints the signed URL on
 * demand. Redirect, not proxy: the browser fetches the bytes from Notion's
 * CDN directly.
 *
 * ?download=1 proxies instead, with a Content-Disposition filename. A
 * redirect can't carry one across origins, so a plain download link would
 * save the render under Notion's opaque hash — useless in a folder of
 * twelve. Same re-minting, one extra hop, only on the download path.
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
    if (new URL(req.url).searchParams.get("download")) {
      const res = await fetch(target);
      if (!res.ok) {
        return NextResponse.json({ error: `Couldn't fetch the render (${res.status}).` }, { status: 502 });
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const stored = ((rec.props["Image"] as Array<{ name?: string }> | null) ?? [])[0]?.name ?? "";
      const ext = (stored.match(/\.(webp|png|jpe?g)$/i)?.[1] ?? "webp").toLowerCase();
      // the variant name the operator already recognises, not a hash
      const base = (rec.title || "mockup").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
      // HTTP headers are Latin-1: an em dash in the title throws before the
      // response is even built. RFC 5987 dual form — ASCII fallback in
      // filename=, the real name UTF-8-encoded in filename*=.
      const ascii = base.replace(/[^\x20-\x7e]+/g, "-").replace(/-{2,}/g, "-").trim() || "mockup";
      const encoded = encodeURIComponent(`${base}.${ext}`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": res.headers.get("content-type") ?? `image/${ext}`,
          "Content-Disposition": `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encoded}`,
          "Cache-Control": "private, max-age=600",
        },
      });
    }
    return NextResponse.redirect(target, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
