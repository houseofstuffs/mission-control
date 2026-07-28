/**
 * Provisions the Notion schema: creates every database in schema.ts under
 * NOTION_PARENT_PAGE_ID, then patches self-relations in a second pass.
 *
 * Idempotent: if a database id is already registered (SQLite meta) and still
 * exists, it patches missing properties instead of creating a duplicate. Safe
 * to re-run after adding fields to the schema.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { notion, parentPageId, throttled } from "./client";
import { SCHEMA, SECOND_PASS_RELATIONS, type DbSpec, type PropSpec } from "./schema";
import { getDbId, setDbId, setMeta } from "@/server/cache/db";

function propPayload(spec: PropSpec, dbIds: Record<string, string>): any {
  switch (spec.type) {
    case "title":
      return { title: {} };
    case "rich_text":
      return { rich_text: {} };
    case "number":
      return { number: { format: "number" } };
    case "checkbox":
      return { checkbox: {} };
    case "select":
      return { select: { options: (spec.options ?? []).map((name) => ({ name })) } };
    case "multi_select":
      return { multi_select: { options: (spec.options ?? []).map((name) => ({ name })) } };
    case "url":
      return { url: {} };
    case "date":
      return { date: {} };
    case "files":
      return { files: {} };
    case "created_time":
      return { created_time: {} };
    case "relation": {
      const target = dbIds[spec.relation!];
      if (!target) throw new Error(`Relation target "${spec.relation}" not provisioned yet`);
      return { relation: { database_id: target, single_property: {} } };
    }
  }
}

/**
 * Index of child databases already under the parent page, by exact title.
 * This is what makes provisioning idempotent even when the local registry
 * is empty (fresh volume, wiped cache): existing databases are ADOPTED,
 * never recreated as duplicates.
 */
async function indexParentChildDatabases(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
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
        index.set(block.child_database?.title ?? "", block.id);
      }
    }
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return index;
}

async function ensureDatabase(
  db: DbSpec,
  dbIds: Record<string, string>,
  childIndex: Map<string, string>
): Promise<string> {
  let existing = getDbId(db.key);
  if (!existing) {
    const adopted = childIndex.get(db.title);
    if (adopted) {
      setDbId(db.key, adopted);
      existing = adopted;
    }
  }
  if (existing) {
    try {
      const current: any = await throttled(() => notion().databases.retrieve({ database_id: existing }));
      // Patch any properties added to the schema since last provision.
      const missing: Record<string, any> = {};
      for (const [name, spec] of Object.entries(db.properties)) {
        if (!current.properties?.[name] && spec.type !== "title") {
          missing[name] = propPayload(spec, dbIds);
        }
      }
      if (Object.keys(missing).length > 0) {
        await throttled(() =>
          notion().databases.update({ database_id: existing, properties: missing } as any)
        );
      }
      return existing;
    } catch {
      // registered id no longer resolves — fall through and create fresh
    }
  }

  const properties: Record<string, any> = {};
  for (const [name, spec] of Object.entries(db.properties)) {
    properties[name] = propPayload(spec, dbIds);
  }
  const created: any = await throttled(() =>
    notion().databases.create({
      parent: { type: "page_id", page_id: parentPageId() },
      title: [{ type: "text", text: { content: db.title } }],
      description: [{ type: "text", text: { content: db.description } }],
      properties,
    } as any)
  );
  setDbId(db.key, created.id);
  return created.id;
}

export interface ProvisionResult {
  databases: Array<{ key: string; title: string; id: string; created: boolean }>;
}

export async function provisionSchema(): Promise<ProvisionResult> {
  const dbIds: Record<string, string> = {};
  const results: ProvisionResult["databases"] = [];
  const childIndex = await indexParentChildDatabases();

  for (const db of SCHEMA) {
    const before = getDbId(db.key) ?? childIndex.get(db.title) ?? null;
    const id = await ensureDatabase(db, dbIds, childIndex);
    dbIds[db.key] = id;
    results.push({ key: db.key, title: db.title, id, created: before !== id });
  }

  // Second pass: self-relations (e.g. Etsy Listings → Parent Listing).
  for (const rel of SECOND_PASS_RELATIONS) {
    const dbId = dbIds[rel.dbKey];
    const current: any = await throttled(() => notion().databases.retrieve({ database_id: dbId }));
    if (!current.properties?.[rel.propName]) {
      await throttled(() =>
        notion().databases.update({
          database_id: dbId,
          properties: {
            [rel.propName]: { relation: { database_id: dbIds[rel.targetKey], single_property: {} } },
          },
        } as any)
      );
    }
  }

  setMeta("schema_provisioned_at", new Date().toISOString());
  return { databases: results };
}
