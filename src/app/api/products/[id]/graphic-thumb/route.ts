import { NextResponse } from "next/server";
import sharp from "sharp";
import { cachedRecord } from "@/server/notion/store";
import { fetchMaster } from "@/server/mockup/generateJob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Small preview of a product's branded graphic (size chart / care /
 * colorways). The stored value is a LINK — usually a Drive share link,
 * which an <img> can't render (Drive serves an HTML viewer page) — so
 * this proxies through the same Drive-aware fetch the compositor uses
 * and returns a card-sized webp. What lets the Products card show the
 * asset instead of the URL.
 */
const FIELDS: Record<string, string> = {
  highlights: "Highlights & Sizing Graphic Link",
  care: "Care & Policies Graphic Link",
  colorways: "Colorways Graphic Link",
};

const memo = new Map<string, Buffer>();
const MEMO_CAP = 40;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const product = cachedRecord(id);
    if (!product || product.dbKey !== "products") {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }
    const field = FIELDS[new URL(req.url).searchParams.get("field") ?? ""];
    if (!field) {
      return NextResponse.json({ error: `field must be one of ${Object.keys(FIELDS).join(", ")}.` }, { status: 400 });
    }
    const link = String(product.props[field] ?? "").trim();
    if (!link) return NextResponse.json({ error: "No graphic link set." }, { status: 404 });

    const key = `${id}:${field}:${link}`;
    let thumb = memo.get(key);
    if (!thumb) {
      const buf = await fetchMaster(link);
      thumb = await sharp(buf)
        .resize(320, 320, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      if (memo.size >= MEMO_CAP) {
        const oldest = memo.keys().next().value;
        if (oldest) memo.delete(oldest);
      }
      memo.set(key, thumb);
    }
    return new NextResponse(new Uint8Array(thumb), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=600" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
