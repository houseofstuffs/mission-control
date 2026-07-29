/**
 * Compose jobs — the multi-candidate compose is a minutes-long generation,
 * far too long to live inside one web request. POST starts the job and the
 * finished candidates write straight onto the design record; this table only
 * tracks status so the client knows when to refresh. Ephemeral working
 * state, not a second database.
 */
import { randomUUID } from "node:crypto";
import { cacheDb } from "./db";

export interface ComposeJob {
  id: string;
  designId: string;
  status: "running" | "done" | "error";
  error: string | null;
  createdAt: string;
}

function ensureTable() {
  cacheDb().exec(`
    CREATE TABLE IF NOT EXISTS compose_jobs (
      id TEXT PRIMARY KEY,
      design_id TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export function createComposeJob(designId: string): string {
  ensureTable();
  const db = cacheDb();
  db.prepare("DELETE FROM compose_jobs WHERE created_at < datetime('now', '-1 day')").run();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO compose_jobs (id, design_id, status, created_at) VALUES (?, ?, 'running', datetime('now'))"
  ).run(id, designId);
  return id;
}

export function getComposeJob(id: string): ComposeJob | null {
  ensureTable();
  // Orphaned by a server restart — nothing legitimately runs this long.
  cacheDb()
    .prepare(
      "UPDATE compose_jobs SET status = 'error', error = 'Compose was interrupted by a deploy — hit Compose again.' WHERE id = ? AND status = 'running' AND created_at < datetime('now', '-10 minutes')"
    )
    .run(id);
  const row = cacheDb().prepare("SELECT * FROM compose_jobs WHERE id = ?").get(id) as
    | Record<string, string | null>
    | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    designId: String(row.design_id),
    status: row.status as ComposeJob["status"],
    error: (row.error as string) ?? null,
    createdAt: String(row.created_at),
  };
}

export function completeComposeJob(id: string): void {
  cacheDb().prepare("UPDATE compose_jobs SET status = 'done' WHERE id = ?").run(id);
}

export function failComposeJob(id: string, error: string): void {
  cacheDb().prepare("UPDATE compose_jobs SET status = 'error', error = ? WHERE id = ?").run(error, id);
}
