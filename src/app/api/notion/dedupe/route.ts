import { NextResponse } from "next/server";
import { notion, parentPageId, throttled } from "@/server/notion/client";
import { SCHEMA } from "@/server/notion/schema";
import { getDbId } from "@/server/cache/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // up to ~30 throttled archive calls

/* eslint-disable @typescript-eslint/no-explicit-any */

interface PlanItem {
  title: string;
  keepId: string | null;
  archiveIds: string[];
  skipped?: string;
}

/**
 * Cleans up duplicate databases left by provisioning runs that predate the
 * adopt-by-title logic. Deliberately conservative:
 *   - only looks at child databases of NOTION_PARENT_PAGE_ID
 *   - only considers titles this schema owns — never touches anything else
 *   - only acts on titles that appear more than once
 *   - keeps the copy this app is registered to; if no copy is registered,
 *     the group is skipped rather than guessed at
 *   - archives (Notion trash, restorable ~30 days), never hard-deletes
 * Defaults to a dry run; pass { dryRun: false } to execute.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;

    // enumerate child databases under the parent page
    const children: Array<{ id: string; title: string }> = [];
    let cursor: string | undefined;
    do {
      const page: any = await throttled(() =>
        notion().blocks.children.list({
          block_id: parentPageId(),
          start_cursor: cursor,
          page_size: 100,
        })
      );
      for (const block of page.results ?? []) {
        if (block.type === "child_database") {
          children.push({ id: block.id, title: block.child_database?.title ?? "" });
        }
      }
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);

    const titleToKey = new Map(SCHEMA.map((d) => [d.title, d.key]));
    const groups = new Map<string, string[]>();
    for (const child of children) {
      if (!titleToKey.has(child.title)) continue; // not ours — leave alone
      groups.set(child.title, [...(groups.get(child.title) ?? []), child.id]);
    }

    const plan: PlanItem[] = [];
    for (const [title, ids] of groups) {
      if (ids.length < 2) continue;
      const registered = (getDbId(titleToKey.get(title)!) ?? "").replace(/-/g, "");
      const keepId = ids.find((id) => id.replace(/-/g, "") === registered) ?? null;
      if (!keepId) {
        plan.push({
          title,
          keepId: null,
          archiveIds: [],
          skipped: "no registered copy — left alone",
        });
        continue;
      }
      plan.push({ title, keepId, archiveIds: ids.filter((id) => id !== keepId) });
    }

    const totalToArchive = plan.reduce((n, p) => n + p.archiveIds.length, 0);
    if (dryRun) {
      return NextResponse.json({ dryRun: true, plan, totalToArchive, scanned: children.length });
    }

    let archived = 0;
    for (const item of plan) {
      for (const id of item.archiveIds) {
        await throttled(() => notion().databases.update({ database_id: id, archived: true } as any));
        archived++;
      }
    }
    return NextResponse.json({ dryRun: false, plan, archived, scanned: children.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
