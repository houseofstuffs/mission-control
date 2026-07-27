/**
 * Generic converters between Notion property payloads and simple JS values,
 * driven by the schema in schema.ts. Simple values:
 *   title/rich_text → string · number → number · checkbox → boolean
 *   select → string · multi_select → string[] · url → string · date → ISO string
 *   files → array of {name, url} · relation → page-id string[] · created_time → ISO string
 */
import type { DbSpec, PropSpec } from "./schema";

export type SimpleValue = string | number | boolean | string[] | Array<{ name: string; url: string }> | null;
export type SimpleRecord = {
  id: string;
  dbKey: string;
  title: string;
  lastEdited: string;
  props: Record<string, SimpleValue>;
};

/** Notion caps a rich_text item at 2000 chars — chunk long strings (print-area JSON etc). */
function chunkText(text: string): Array<{ type: "text"; text: { content: string } }> {
  const chunks: Array<{ type: "text"; text: { content: string } }> = [];
  for (let i = 0; i < text.length; i += 2000) {
    chunks.push({ type: "text", text: { content: text.slice(i, i + 2000) } });
  }
  return chunks.slice(0, 100); // Notion caps arrays at 100 items
}

/** Build a Notion properties payload from simple values, per the db spec. */
export function toNotionProperties(
  spec: DbSpec,
  values: Record<string, SimpleValue>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const propSpec: PropSpec | undefined = spec.properties[name];
    if (!propSpec) throw new Error(`Unknown property "${name}" on ${spec.key}`);
    if (propSpec.type === "created_time") continue; // read-only

    switch (propSpec.type) {
      case "title":
        out[name] = { title: value == null ? [] : chunkText(String(value)) };
        break;
      case "rich_text":
        out[name] = { rich_text: value == null || value === "" ? [] : chunkText(String(value)) };
        break;
      case "number":
        out[name] = { number: value == null ? null : Number(value) };
        break;
      case "checkbox":
        out[name] = { checkbox: Boolean(value) };
        break;
      case "select":
        out[name] = { select: value == null || value === "" ? null : { name: String(value) } };
        break;
      case "multi_select":
        out[name] = {
          multi_select: Array.isArray(value) ? (value as string[]).map((v) => ({ name: v })) : [],
        };
        break;
      case "url":
        out[name] = { url: value == null || value === "" ? null : String(value) };
        break;
      case "date":
        out[name] = { date: value == null || value === "" ? null : { start: String(value) } };
        break;
      case "relation":
        out[name] = {
          relation: Array.isArray(value) ? (value as string[]).map((id) => ({ id })) : [],
        };
        break;
      case "files":
        // External files only via API; uploads happen in Notion itself.
        out[name] = {
          files: Array.isArray(value)
            ? (value as Array<{ name: string; url: string }>).map((f) => ({
                type: "external",
                name: f.name || "file",
                external: { url: f.url },
              }))
            : [],
        };
        break;
    }
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function plainText(arr: any[]): string {
  return (arr ?? []).map((t: any) => t?.plain_text ?? "").join("");
}

/** Flatten a Notion page into a SimpleRecord, per the db spec. */
export function fromNotionPage(spec: DbSpec, page: any): SimpleRecord {
  const props: Record<string, SimpleValue> = {};
  let title = "";
  for (const [name, propSpec] of Object.entries(spec.properties)) {
    const p = page.properties?.[name];
    if (!p) {
      props[name] = null;
      continue;
    }
    switch (propSpec.type) {
      case "title":
        title = plainText(p.title);
        props[name] = title;
        break;
      case "rich_text":
        props[name] = plainText(p.rich_text);
        break;
      case "number":
        props[name] = p.number ?? null;
        break;
      case "checkbox":
        props[name] = Boolean(p.checkbox);
        break;
      case "select":
        props[name] = p.select?.name ?? null;
        break;
      case "multi_select":
        props[name] = (p.multi_select ?? []).map((o: any) => o.name);
        break;
      case "url":
        props[name] = p.url ?? null;
        break;
      case "date":
        props[name] = p.date?.start ?? null;
        break;
      case "relation":
        props[name] = (p.relation ?? []).map((r: any) => r.id);
        break;
      case "files":
        props[name] = (p.files ?? []).map((f: any) => ({
          name: f.name ?? "file",
          url: f.external?.url ?? f.file?.url ?? "",
        }));
        break;
      case "created_time":
        props[name] = p.created_time ?? null;
        break;
    }
  }
  return {
    id: page.id,
    dbKey: spec.key,
    title,
    lastEdited: page.last_edited_time ?? "",
    props,
  };
}
