import { NextResponse } from "next/server";
import { refreshAll, refreshDb } from "@/server/notion/store";
import { DB_KEYS } from "@/server/notion/schema";

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
      return NextResponse.json({ refreshed: { [db]: count } });
    }
    const counts = await refreshAll();
    return NextResponse.json({ refreshed: counts });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
