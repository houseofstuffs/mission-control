import { NextResponse } from "next/server";
import { refreshAll, refreshDb } from "@/server/notion/store";
import { DB_KEYS } from "@/server/notion/schema";
import { getDbId } from "@/server/cache/db";
import { reconcileKeywordBuckets } from "@/server/keywords";

export const dynamic = "force-dynamic";

/** Explicit refresh — the only path that queries Notion for reads. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const db = body?.db as string | undefined;
    if (db && db !== "all") {
      if (!DB_KEYS.includes(db)) {
        return NextResponse.json({ error: `Unknown database "${db}"` }, { status: 400 });
      }
      const count = await refreshDb(db);
      if (db === "keywords") await reconcileKeywordBuckets();
      return NextResponse.json({ refreshed: { [db]: count } });
    }
    const counts = await refreshAll();
    // compute-on-refresh: rows edited straight in Notion (or imported) get
    // bucketed here; manual overrides are skipped inside
    if (getDbId("keywords")) await reconcileKeywordBuckets();
    return NextResponse.json({ refreshed: counts });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
