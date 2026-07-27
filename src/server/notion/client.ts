/**
 * Notion client — server-side only. The token never reaches the browser.
 *
 * The Notion API rate-limits at ~3 requests/second (spec §2.1), so every call
 * goes through a serialised throttle. Do not live-query on render — reads go
 * through the cache; this client is for explicit refresh and write-through.
 */
import { Client } from "@notionhq/client";

let _client: Client | null = null;

export function notion(): Client {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error("NOTION_TOKEN is not set. Copy .env.example to .env.local and fill it in.");
  }
  if (!_client) _client = new Client({ auth: token });
  return _client;
}

export function notionConfigured(): boolean {
  return Boolean(process.env.NOTION_TOKEN && process.env.NOTION_PARENT_PAGE_ID);
}

export function parentPageId(): string {
  const id = process.env.NOTION_PARENT_PAGE_ID;
  if (!id) throw new Error("NOTION_PARENT_PAGE_ID is not set.");
  return id.replace(/-/g, "");
}

/** Serialised throttle: ≥350ms between Notion calls keeps us under 3 rps. */
let queue: Promise<unknown> = Promise.resolve();
const GAP_MS = 350;

export function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const result = await fn();
    await new Promise((r) => setTimeout(r, GAP_MS));
    return result;
  });
  // keep the chain alive even when a call fails
  queue = run.catch(() => undefined);
  return run;
}
