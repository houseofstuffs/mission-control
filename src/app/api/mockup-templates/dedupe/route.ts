import { NextResponse } from "next/server";
import { cachedRecords, archiveRecord } from "@/server/notion/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Cleanup for the duplicate-variant incident: two full import passes (a
 * stale second tab whose review list predated the first run) saved every
 * colour twice, and same-colour files in one folder doubled a colour
 * within a single run. Duplicates by this pipeline are EXACT-name twins
 * ("{template} - {colour} - {px}"), so name is the grouping key — the
 * first record of each name survives, the rest are archived in Notion
 * (recoverable from Notion's trash, not deleted).
 *
 * Save-time prevention now lives in the import job; this handles the
 * records that predate it.
 */
export async function POST() {
  try {
    const byName = new Map<string, Array<{ id: string; name: string }>>();
    for (const t of cachedRecords("mockup_templates")) {
      const name = (t.title || "").trim();
      if (!name) continue;
      const list = byName.get(name) ?? [];
      list.push({ id: t.id, name });
      byName.set(name, list);
    }

    const removed: string[] = [];
    for (const list of byName.values()) {
      // keep the first, archive the rest — identical names carry
      // identical content by construction of the import naming rule
      for (const extra of list.slice(1)) {
        await archiveRecord("mockup_templates", extra.id);
        removed.push(extra.name);
      }
    }

    const counts = new Map<string, number>();
    for (const n of removed) counts.set(n, (counts.get(n) ?? 0) + 1);
    return NextResponse.json({
      removed: removed.length,
      names: [...counts.entries()].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
