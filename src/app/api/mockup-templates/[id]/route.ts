import { NextResponse } from "next/server";
import { cachedRecord, updateRecord, archiveRecord } from "@/server/notion/store";
import { BLEND_MODES, FIT_MODES, SURFACE_TAGS, parseQuad } from "@/config/mockups";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/**
 * Template edits after intake: re-place corners, change blend or surface.
 * Pipeline Type is deliberately NOT editable here — it was the branching
 * decision at intake, and flipping it casually would strand required layers.
 * Re-capture the template if the pipeline was wrong.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const template = cachedRecord(id);
    if (!template || template.dbKey !== "mockup_templates") {
      return NextResponse.json({ error: "Template not found in cache — refresh first" }, { status: 404 });
    }

    const values: Record<string, SimpleValue> = {};

    if (body.quad !== undefined) {
      const quad = parseQuad(body.quad);
      if (!quad) return NextResponse.json({ error: "That quad doesn't parse — four corners, 0–1 each." }, { status: 400 });
      values["Print Area Quad (JSON)"] = JSON.stringify(quad);
    }
    if (body.blendMode !== undefined) {
      if (!BLEND_MODES.includes(body.blendMode)) {
        return NextResponse.json({ error: `Unknown blend mode "${body.blendMode}"` }, { status: 400 });
      }
      values["Blend Mode"] = String(body.blendMode);
    }
    if (body.fitMode !== undefined) {
      if (!FIT_MODES.includes(body.fitMode)) {
        return NextResponse.json({ error: `Unknown fit "${body.fitMode}"` }, { status: 400 });
      }
      values["Fit"] = String(body.fitMode);
    }
    if (body.surface !== undefined) {
      if (!SURFACE_TAGS.includes(body.surface)) {
        return NextResponse.json({ error: `Unknown surface tag "${body.surface}"` }, { status: 400 });
      }
      values["Surface"] = String(body.surface);
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("mockup_templates", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const template = cachedRecord(id);
    if (!template || template.dbKey !== "mockup_templates") {
      return NextResponse.json({ error: "Template not found in cache — refresh first" }, { status: 404 });
    }
    await archiveRecord("mockup_templates", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
