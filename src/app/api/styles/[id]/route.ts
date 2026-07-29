import { NextResponse } from "next/server";
import { cachedRecord, updateRecord, archiveRecord } from "@/server/notion/store";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/** Form keys → Notion property names. Only these fields are editable here. */
const EDITABLE: Record<string, string> = {
  name: "Name",
  category: "Category",
  description: "Description",
  composition: "Composition",
  slots: "Slots",
  typography: "Typography",
  keywordBank: "Keyword Bank",
  reusablePrompt: "Reusable Prompt",
  typePrompt: "Type Prompt",
  printsBeautifullyOn: "Prints Beautifully On",
  worksWithTweaksOn: "Works With Tweaks On",
  avoidOn: "Avoid On",
  ruleOfThumb: "Rule of Thumb",
  notes: "Notes",
};

/** Edits from the Styles page, written through to Notion (system of record). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const style = cachedRecord(id);
    if (!style || style.dbKey !== "styles") {
      return NextResponse.json({ error: "Style not found in cache — refresh first" }, { status: 404 });
    }

    const values: Record<string, SimpleValue> = {};
    for (const [key, prop] of Object.entries(EDITABLE)) {
      if (body[key] != null) values[prop] = String(body[key]);
    }
    if (typeof values["Name"] === "string" && !values["Name"].trim()) {
      return NextResponse.json({ error: "A style needs a name." }, { status: 400 });
    }
    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const record = await updateRecord("styles", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Archive, not hard delete — the Notion API can't destroy pages, and that's
 * fine: the style sits in Notion's trash, recoverable for 30 days.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const style = cachedRecord(id);
    if (!style || style.dbKey !== "styles") {
      return NextResponse.json({ error: "Style not found in cache — refresh first" }, { status: 404 });
    }
    await archiveRecord("styles", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
