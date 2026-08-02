/**
 * Local cache — SQLite. This is a CACHE of Notion, never a second database:
 * it is fully rebuildable from Notion at any time via explicit refresh, and
 * every write goes to Notion first, then here (write-through).
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { SimpleRecord } from "@/server/notion/props";

let _db: Database.Database | null = null;

export function cacheDb(): Database.Database {
  if (_db) return _db;
  const dbPath = process.env.CACHE_DB_PATH || "./data/cache.db";
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      page_id TEXT PRIMARY KEY,
      db_key TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      record_json TEXT NOT NULL,
      last_edited TEXT NOT NULL DEFAULT '',
      cached_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_records_db ON records(db_key);
    CREATE TABLE IF NOT EXISTS sync_state (
      db_key TEXT PRIMARY KEY,
      last_synced_at TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  return _db;
}

/* ---------- meta (also holds the Notion database-id registry) ---------- */

export function getMeta(key: string): string | null {
  const row = cacheDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  cacheDb()
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function deleteMeta(key: string): void {
  cacheDb().prepare("DELETE FROM meta WHERE key = ?").run(key);
}

export function getDbId(dbKey: string): string | null {
  return getMeta(`notion_db_id:${dbKey}`);
}

export function setDbId(dbKey: string, id: string): void {
  setMeta(`notion_db_id:${dbKey}`, id);
}

/* ---------- records ---------- */

export function upsertRecord(rec: SimpleRecord, archived = false): void {
  cacheDb()
    .prepare(
      `INSERT INTO records (page_id, db_key, title, archived, record_json, last_edited, cached_at)
       VALUES (@id, @dbKey, @title, @archived, @json, @lastEdited, @cachedAt)
       ON CONFLICT(page_id) DO UPDATE SET
         title = excluded.title, archived = excluded.archived,
         record_json = excluded.record_json, last_edited = excluded.last_edited,
         cached_at = excluded.cached_at`
    )
    .run({
      id: rec.id,
      dbKey: rec.dbKey,
      title: rec.title,
      archived: archived ? 1 : 0,
      json: JSON.stringify(rec),
      lastEdited: rec.lastEdited,
      cachedAt: new Date().toISOString(),
    });
}

export function removeRecord(pageId: string): void {
  cacheDb().prepare("DELETE FROM records WHERE page_id = ?").run(pageId);
}

export function listRecords(dbKey: string): SimpleRecord[] {
  const rows = cacheDb()
    .prepare("SELECT record_json FROM records WHERE db_key = ? AND archived = 0 ORDER BY last_edited DESC")
    .all(dbKey) as Array<{ record_json: string }>;
  return rows.map((r) => JSON.parse(r.record_json) as SimpleRecord);
}

export function getRecord(pageId: string): SimpleRecord | null {
  const row = cacheDb()
    .prepare("SELECT record_json FROM records WHERE page_id = ?")
    .get(pageId) as { record_json: string } | undefined;
  return row ? (JSON.parse(row.record_json) as SimpleRecord) : null;
}

/** Replace the full contents of one database's cache (used by refresh). */
export function replaceDbRecords(dbKey: string, recs: SimpleRecord[]): void {
  const db = cacheDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM records WHERE db_key = ?").run(dbKey);
    for (const rec of recs) upsertRecord(rec);
    db.prepare(
      `INSERT INTO sync_state (db_key, last_synced_at, page_count) VALUES (?, ?, ?)
       ON CONFLICT(db_key) DO UPDATE SET last_synced_at = excluded.last_synced_at, page_count = excluded.page_count`
    ).run(dbKey, new Date().toISOString(), recs.length);
  });
  tx();
}

export function syncState(): Record<string, { lastSyncedAt: string; pageCount: number }> {
  const rows = cacheDb().prepare("SELECT db_key, last_synced_at, page_count FROM sync_state").all() as Array<{
    db_key: string;
    last_synced_at: string;
    page_count: number;
  }>;
  const out: Record<string, { lastSyncedAt: string; pageCount: number }> = {};
  for (const r of rows) out[r.db_key] = { lastSyncedAt: r.last_synced_at, pageCount: r.page_count };
  return out;
}
