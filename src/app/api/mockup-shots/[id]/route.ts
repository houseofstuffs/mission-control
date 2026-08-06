import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, updateRecord, archiveRecord } from "@/server/notion/store";
import { parseQuad } from "@/config/mockups";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // a rename may touch every variant under the template

/** The variants attached to this template — everything a rename or delete has to reckon with. */
function variantsOf(shotId: string) {
  return cachedRecords("mockup_templates").filter((m) =>
    (((m.props["Shot"] as string[] | null) ?? [])).includes(shotId)
  );
}

/**
 * Saves the shot's shared crop rectangle, the hand-set framing flag, or —
 * post-creation edits — the name and Drive folder link.
 *
 * Rename safety: every relation references the template by id, so nothing
 * structural moves on rename. The one thing that would silently rot is
 * cosmetic — the "{template} - {colour} - {px}" strings on variant names —
 * so a rename re-derives those, matched by their old prefix. A variant
 * named by hand (no prefix match) is left alone.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const shot = cachedRecord(id);
    if (!shot || shot.dbKey !== "mockup_shots") {
      return NextResponse.json({ error: "Shot not found in cache — refresh first." }, { status: 404 });
    }
    const body = await req.json();
    const values: Record<string, SimpleValue> = {};

    const oldName = shot.title || "";
    const newName = body.name !== undefined ? String(body.name).trim() : null;
    if (newName !== null) {
      if (!newName) return NextResponse.json({ error: "A template needs a name." }, { status: 400 });
      values["Name"] = newName;
    }

    if (body.productId !== undefined) {
      const pid = String(body.productId).trim();
      if (pid) {
        const product = cachedRecord(pid);
        if (!product || product.dbKey !== "products") {
          return NextResponse.json({ error: "Unknown product — refresh and retry." }, { status: 400 });
        }
        values["Product"] = [pid];
      } else {
        values["Product"] = []; // cleared = shown for every listing again
      }
    }

    if (body.cropRect !== undefined) {
      const r = body.cropRect as { x?: unknown; y?: unknown; size?: unknown } | null;
      if (
        !r ||
        typeof r.x !== "number" ||
        typeof r.y !== "number" ||
        typeof r.size !== "number" ||
        r.size <= 0
      ) {
        return NextResponse.json({ error: "Invalid crop rect." }, { status: 400 });
      }
      values["Crop Rect (JSON)"] = JSON.stringify({ x: r.x, y: r.y, size: r.size });
      values["Crop Set At"] = new Date().toISOString().slice(0, 10);
    }
    if (body.printRegionQuad !== undefined) {
      const quad = parseQuad(body.printRegionQuad);
      if (!quad) {
        return NextResponse.json({ error: "Invalid print region — four corners, 0–1 each." }, { status: 400 });
      }
      values["Print Region Quad (JSON)"] = JSON.stringify(quad);
    }
    if (body.driveFolderLink !== undefined) {
      values["Drive Folder Link"] = String(body.driveFolderLink).trim() || null;
    }
    // shot type edits reach existing variants via Re-sync — the receipt
    // tells the operator to run it
    if (body.shotType !== undefined) {
      const st = String(body.shotType).trim();
      if (!st) return NextResponse.json({ error: "A template needs a shot type — Send matches on it." }, { status: 400 });
      values["Shot Type"] = st;
    }
    if (body.framingFlagged !== undefined) values["Framing Flagged"] = Boolean(body.framingFlagged);
    if (body.framingNotes !== undefined) values["Framing Notes"] = String(body.framingNotes);

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("mockup_shots", id, values);

    let renamedVariants = 0;
    if (newName && oldName && newName !== oldName) {
      const prefix = `${oldName} - `;
      for (const v of variantsOf(id)) {
        const title = v.title || "";
        if (!title.startsWith(prefix)) continue; // hand-named — not ours to rewrite
        await updateRecord("mockup_templates", v.id, {
          Name: `${newName} - ${title.slice(prefix.length)}`,
        });
        renamedVariants++;
      }
    }

    return NextResponse.json({ record, renamedVariants });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Delete (archive) a template. The UI warns with live counts first; the
 * variants themselves are left alone — they keep rendering wherever they're
 * already used, they just lose the shared geometry for future batches.
 * Deleting them too would turn "remove a grouping" into "destroy finished
 * work".
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const rec = cachedRecord(id);
    if (!rec || rec.dbKey !== "mockup_shots") {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }
    await archiveRecord("mockup_shots", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
