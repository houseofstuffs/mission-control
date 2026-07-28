/**
 * Record store — the only read/write path between the app and Notion.
 *
 * Reads:  always from the SQLite cache. Notion is queried only on explicit
 *         refresh (refreshDb / refreshAll) — never on render (spec §2.1).
 * Writes: write-through. Notion first (it is the system of record), then the
 *         cache is updated from Notion's response.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { notion, throttled } from "./client";
import { getDbSpec, SCHEMA, SECOND_PASS_RELATIONS } from "./schema";
import { fromNotionPage, toNotionProperties, type SimpleRecord, type SimpleValue } from "./props";
import { getDbId, replaceDbRecords, upsertRecord, listRecords, getRecord } from "@/server/cache/db";

function requireDbId(dbKey: string): string {
  const id = getDbId(dbKey);
  if (!id) {
    throw new Error(
      `The app doesn't know where the "${dbKey}" database lives (fresh or wiped cache). ` +
        `Open Today and click "Provision Notion schema" — it re-adopts existing databases, no duplicates.`
    );
  }
  return id;
}

/** Spec including second-pass props (Parent Listing) so mappers see them. */
function fullSpec(dbKey: string) {
  const spec = getDbSpec(dbKey);
  const extra = SECOND_PASS_RELATIONS.filter((r) => r.dbKey === dbKey);
  if (extra.length === 0) return spec;
  const properties = { ...spec.properties };
  for (const r of extra) {
    properties[r.propName] = { type: "relation" as const, relation: r.targetKey };
  }
  return { ...spec, properties };
}

/* ---------------- reads (cache) ---------------- */

export function cachedRecords(dbKey: string): SimpleRecord[] {
  return listRecords(dbKey);
}

export function cachedRecord(pageId: string): SimpleRecord | null {
  return getRecord(pageId);
}

/* ---------------- explicit refresh ---------------- */

export async function refreshDb(dbKey: string): Promise<number> {
  const spec = fullSpec(dbKey);
  const dbId = requireDbId(dbKey);
  const records: SimpleRecord[] = [];
  let cursor: string | undefined;
  do {
    const page: any = await throttled(() =>
      notion().databases.query({
        database_id: dbId,
        start_cursor: cursor,
        page_size: 100,
      })
    );
    for (const result of page.results) {
      if (result.archived || result.in_trash) continue;
      records.push(fromNotionPage(spec, result));
    }
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  replaceDbRecords(dbKey, records);
  return records.length;
}

export async function refreshAll(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const db of SCHEMA) {
    counts[db.key] = await refreshDb(db.key);
  }
  return counts;
}

/* ---------------- write-through ---------------- */

export async function createRecord(
  dbKey: string,
  values: Record<string, SimpleValue>
): Promise<SimpleRecord> {
  const spec = fullSpec(dbKey);
  const dbId = requireDbId(dbKey);
  const page: any = await throttled(() =>
    notion().pages.create({
      parent: { database_id: dbId },
      properties: toNotionProperties(spec, values) as any,
    })
  );
  const rec = fromNotionPage(spec, page);
  upsertRecord(rec);
  return rec;
}

export async function updateRecord(
  dbKey: string,
  pageId: string,
  values: Record<string, SimpleValue>
): Promise<SimpleRecord> {
  const spec = fullSpec(dbKey);
  const page: any = await throttled(() =>
    notion().pages.update({
      page_id: pageId,
      properties: toNotionProperties(spec, values) as any,
    })
  );
  const rec = fromNotionPage(spec, page);
  upsertRecord(rec);
  return rec;
}

export async function archiveRecord(dbKey: string, pageId: string): Promise<void> {
  await throttled(() => notion().pages.update({ page_id: pageId, archived: true }));
  const rec = getRecord(pageId);
  if (rec) upsertRecord(rec, true);
}
