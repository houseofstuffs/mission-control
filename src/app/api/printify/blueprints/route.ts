import { NextResponse } from "next/server";
import { listBlueprints } from "@/server/printify/client";
import { getMeta, setMeta } from "@/server/cache/db";

export const dynamic = "force-dynamic";

const CACHE_KEY = "printify_blueprints";
const TTL_MS = 24 * 60 * 60 * 1000; // catalog is reference data; refresh daily

export async function GET() {
  try {
    const cached = getMeta(CACHE_KEY);
    if (cached) {
      const { at, data } = JSON.parse(cached);
      if (Date.now() - at < TTL_MS) return NextResponse.json({ blueprints: data, cached: true });
    }
    const blueprints = await listBlueprints();
    const slim = blueprints.map((b) => ({
      id: b.id,
      title: b.title,
      brand: b.brand,
      model: b.model,
      image: b.images?.[0] ?? null,
    }));
    setMeta(CACHE_KEY, JSON.stringify({ at: Date.now(), data: slim }));
    return NextResponse.json({ blueprints: slim, cached: false });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
