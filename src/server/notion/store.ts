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

/**
 * Refresh ONE record from Notion — used to mint fresh signed file URLs
 * right before a render, without paying for a whole-database refresh.
 * Notion's file links expire roughly an hour after the page was last
 * fetched, so an action that reads files (mockup render) needs one on
 * demand rather than waiting for the operator to notice and hit Refresh.
 */
export async function refreshRecord(dbKey: string, pageId: string): Promise<SimpleRecord> {
  const spec = fullSpec(dbKey);
  const page: any = await throttled(() => notion().pages.retrieve({ page_id: pageId }));
  const rec = fromNotionPage(spec, page);
  upsertRecord(rec);
  return rec;
}

export async function refreshAll(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const db of SCHEMA) {
    counts[db.key] = await refreshDb(db.key);
  }
  return counts;
}

/* ---------------- write-through ---------------- */

/**
 * Every write that names a property the Notion database doesn't carry yet
 * fails the same way, and Notion's own wording ("X is not a property that
 * exists") reads like a code bug rather than the one-click fix it is. This
 * is the generic shape of "the schema gained a field after the last
 * provision run" — the only cure is Provision Notion schema, so say so.
 */
function explainWriteFailure(dbKey: string, err: unknown): Error {
  const message = (err as Error)?.message ?? String(err);
  // Notion lists several in one message, separated by ". " — and the name
  // pattern has to allow "." for names like "Print Region Quad (JSON)", so
  // the second match onward drags the previous sentence's punctuation with
  // it. Strip anything before the name's first real character.
  const missing = Array.from(message.matchAll(/([\w ()/'’&%+.-]+?) is not a property that exists/g))
    .map((m) => m[1].trim().replace(/^[^\w(]+/, "").trim())
    .filter(Boolean);
  if (missing.length === 0) return err as Error;
  return new Error(
    `The Notion "${dbKey}" database is missing ${missing.length === 1 ? "a property" : "properties"} ` +
      `this app writes: ${missing.join(", ")}. Run "Provision Notion schema" on the Settings page, ` +
      `then try again. (Nothing was saved.)`
  );
}

export async function createRecord(
  dbKey: string,
  values: Record<string, SimpleValue>
): Promise<SimpleRecord> {
  const spec = fullSpec(dbKey);
  const dbId = requireDbId(dbKey);
  let page: any;
  try {
    page = await throttled(() =>
      notion().pages.create({
        parent: { database_id: dbId },
        properties: toNotionProperties(spec, values) as any,
      })
    );
  } catch (err) {
    throw explainWriteFailure(dbKey, err);
  }
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
  let page: any;
  try {
    page = await throttled(() =>
      notion().pages.update({
        page_id: pageId,
        properties: toNotionProperties(spec, values) as any,
      })
    );
  } catch (err) {
    throw explainWriteFailure(dbKey, err);
  }
  const rec = fromNotionPage(spec, page);
  upsertRecord(rec);
  return rec;
}

export async function archiveRecord(dbKey: string, pageId: string): Promise<void> {
  await throttled(() => notion().pages.update({ page_id: pageId, archived: true }));
  const rec = getRecord(pageId);
  if (rec) upsertRecord(rec, true);
}
