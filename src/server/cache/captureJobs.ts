/**
 * Capture jobs — server-owned so navigating away doesn't kill the work.
 *
 * The browser hands over the image and gets a job id back immediately; the
 * model call runs here and the draft lands in this table. The client polls,
 * and on return-to-page resumes from localStorage. Ephemeral working state,
 * not a second database: rows expire after a day and the table can be
 * dropped with the rest of the cache at any time.
 */
import { randomUUID } from "node:crypto";
import { cacheDb } from "./db";

export interface CaptureJob {
  id: string;
  status: "running" | "done" | "error";
  imageB64: string;
  mediaType: string;
  fileName: string;
  hint: string;
  resultJson: string | null;
  error: string | null;
  createdAt: string;
}

function ensureTable() {
  cacheDb().exec(`
    CREATE TABLE IF NOT EXISTS capture_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      image_b64 TEXT NOT NULL,
      media_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      hint TEXT NOT NULL DEFAULT '',
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export function createCaptureJob(imageB64: string, mediaType: string, fileName: string, hint: string): string {
  ensureTable();
  const db = cacheDb();
  // expire stale rows so the disposable cache stays small
  db.prepare("DELETE FROM capture_jobs WHERE created_at < datetime('now', '-1 day')").run();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO capture_jobs (id, status, image_b64, media_type, file_name, hint, created_at) VALUES (?, 'running', ?, ?, ?, ?, datetime('now'))"
  ).run(id, imageB64, mediaType, fileName, hint);
  return id;
}

export function getCaptureJob(id: string): CaptureJob | null {
  ensureTable();
  // A job "running" longer than any request could survive means the server
  // restarted (deploy) mid-capture — the work died with the old process.
  // Fail it so the client stops waiting and the operator can just retry.
  cacheDb()
    .prepare(
      "UPDATE capture_jobs SET status = 'error', error = 'Capture was interrupted by a deploy — drop the reference and try again.' WHERE id = ? AND status = 'running' AND created_at < datetime('now', '-5 minutes')"
    )
    .run(id);
  const row = cacheDb().prepare("SELECT * FROM capture_jobs WHERE id = ?").get(id) as
    | Record<string, string | null>
    | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    status: row.status as CaptureJob["status"],
    imageB64: String(row.image_b64),
    mediaType: String(row.media_type),
    fileName: String(row.file_name),
    hint: String(row.hint ?? ""),
    resultJson: (row.result_json as string) ?? null,
    error: (row.error as string) ?? null,
    createdAt: String(row.created_at),
  };
}

export function completeCaptureJob(id: string, resultJson: string): void {
  cacheDb().prepare("UPDATE capture_jobs SET status = 'done', result_json = ? WHERE id = ?").run(resultJson, id);
}

export function failCaptureJob(id: string, error: string): void {
  cacheDb().prepare("UPDATE capture_jobs SET status = 'error', error = ? WHERE id = ?").run(error, id);
}

export function deleteCaptureJob(id: string): void {
  ensureTable();
  cacheDb().prepare("DELETE FROM capture_jobs WHERE id = ?").run(id);
}
