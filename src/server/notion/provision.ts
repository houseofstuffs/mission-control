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
import {
  SCHEMA,
  SECOND_PASS_RELATIONS,
  RENAMED_PROPERTIES,
  type DbSpec,
  type PropSpec,
} from "./schema";
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
    case "formula":
      return { formula: { expression: spec.expression ?? "" } };
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
): Promise<{ id: string; created: boolean; warning?: string }> {
  // Try the registered id first, then a live child with the same title —
  // if the registered database was deleted (duplicate cleanup), adopt the
  // survivor instead of erroring or creating yet another copy.
  const candidates = [getDbId(db.key), childIndex.get(db.title)].filter(
    (id, i, arr): id is string => Boolean(id) && arr.indexOf(id) === i
  );
  for (const existing of candidates) {
    // ONLY a failed retrieve means "this candidate isn't usable". Anything
    // that goes wrong AFTER a successful retrieve must never fall through to
    // creation — that path is what silently duplicated databases when a
    // property patch hit a transient error or a cut-off request.
    let current: any;
    try {
      current = await throttled(() => notion().databases.retrieve({ database_id: existing }));
    } catch {
      continue; // genuinely unreachable — try the next candidate
    }
    if (current?.archived || current?.in_trash) continue; // trashed — try next

    // From here the database provably exists. Patch failures are reported,
    // never a reason to create a second copy.
    let warning: string | undefined;
    try {
      // Renames first (content-preserving), so the patch step below doesn't
      // create an empty duplicate under the new name.
      for (const rename of RENAMED_PROPERTIES.filter((r) => r.dbKey === db.key)) {
        if (current.properties?.[rename.from] && !current.properties?.[rename.to]) {
          await throttled(() =>
            notion().databases.update({
              database_id: existing,
              properties: { [rename.from]: { name: rename.to } },
            } as any)
          );
          current.properties[rename.to] = current.properties[rename.from];
          delete current.properties[rename.from];
        }
      }
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
    } catch (err) {
      warning = `${db.title}: properties not fully updated — ${(err as Error).message}. Re-run to finish.`;
    }
    setDbId(db.key, existing); // winner may be an adopted survivor, not the registered id
    return { id: existing, created: false, warning };
  }

  // Nothing adoptable. If a live database with this title is already on the
  // page, refuse to create — duplicating it is never the right answer.
  if (childIndex.has(db.title)) {
    throw new Error(
      `"${db.title}" already exists on the parent page but could not be opened. ` +
        `Refusing to create a duplicate. Check that the integration still has access to it.`
    );
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
  return { id: created.id, created: true };
}

export interface ProvisionResult {
  databases: Array<{ key: string; title: string; id: string; created: boolean }>;
  /** Databases newly created this run — should be empty after first setup. */
  createdTitles: string[];
  /** Non-fatal problems (e.g. a property patch that needs a re-run). */
  warnings: string[];
}

export async function provisionSchema(): Promise<ProvisionResult> {
  const dbIds: Record<string, string> = {};
  const results: ProvisionResult["databases"] = [];
  const childIndex = await indexParentChildDatabases();

  const warnings: string[] = [];
  const createdTitles: string[] = [];

  for (const db of SCHEMA) {
    const outcome = await ensureDatabase(db, dbIds, childIndex);
    dbIds[db.key] = outcome.id;
    if (outcome.created) createdTitles.push(db.title);
    if (outcome.warning) warnings.push(outcome.warning);
    results.push({ key: db.key, title: db.title, id: outcome.id, created: outcome.created });
  }

  // Second pass: self-relations and forward references (targets created
  // later in SCHEMA order than their source).
  for (const rel of SECOND_PASS_RELATIONS) {
    const dbId = dbIds[rel.dbKey];
    const current: any = await throttled(() => notion().databases.retrieve({ database_id: dbId }));
    if (!current.properties?.[rel.propName]) {
      const relation = rel.dual
        ? { database_id: dbIds[rel.targetKey], dual_property: {} }
        : { database_id: dbIds[rel.targetKey], single_property: {} };
      await throttled(() =>
        notion().databases.update({
          database_id: dbId,
          properties: { [rel.propName]: { relation } },
        } as any)
      );
    }
    // Dual relations: Notion auto-creates the reverse property on the target
    // with a clunky default name — rename it to rel.dual if not done yet.
    if (rel.dual) {
      const targetId = dbIds[rel.targetKey];
      const target: any = await throttled(() =>
        notion().databases.retrieve({ database_id: targetId })
      );
      if (!target.properties?.[rel.dual]) {
        const reverse = Object.entries(target.properties ?? {}).find(
          ([, p]: [string, any]) =>
            p?.type === "relation" &&
            String(p.relation?.database_id ?? "").replace(/-/g, "") === dbId.replace(/-/g, "") &&
            p.relation?.dual_property?.synced_property_name === rel.propName
        );
        if (reverse) {
          await throttled(() =>
            notion().databases.update({
              database_id: targetId,
              properties: { [reverse[0]]: { name: rel.dual } },
            } as any)
          );
        }
      }
    }
  }

  setMeta("schema_provisioned_at", new Date().toISOString());
  return { databases: results, createdTitles, warnings };
}

/* ---------------- verification (read-only) ---------------- */

export interface SchemaCheck {
  ok: boolean;
  databases: Array<{
    key: string;
    title: string;
    registered: boolean;
    reachable: boolean;
    missingProperties: string[];
  }>;
}

/**
 * Answers "is the schema actually provisioned?" without writing anything.
 *
 * Provisioning patches in properties added to SCHEMA since the last run, so
 * "I ran Provision" is not proof that any PARTICULAR field exists — the run
 * only carries whatever SCHEMA the deployed build shipped. This compares the
 * running build's SCHEMA against Notion live, per property.
 */
export async function checkSchema(): Promise<SchemaCheck> {
  const databases: SchemaCheck["databases"] = [];
  for (const db of SCHEMA) {
    const id = getDbId(db.key);
    if (!id) {
      databases.push({ key: db.key, title: db.title, registered: false, reachable: false, missingProperties: [] });
      continue;
    }
    let current: any;
    try {
      current = await throttled(() => notion().databases.retrieve({ database_id: id }));
    } catch {
      databases.push({ key: db.key, title: db.title, registered: true, reachable: false, missingProperties: [] });
      continue;
    }
    const missingProperties = Object.keys(db.properties).filter((name) => !current.properties?.[name]);
    databases.push({ key: db.key, title: db.title, registered: true, reachable: true, missingProperties });
  }
  const ok = databases.every((d) => d.registered && d.reachable && d.missingProperties.length === 0);
  return { ok, databases };
}
