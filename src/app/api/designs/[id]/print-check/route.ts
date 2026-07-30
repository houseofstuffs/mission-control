import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import { inspectPrintFile, checkNotes } from "@/server/printCheck";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Print-file pre-flight (C8). POST multipart — the file is inspected in
 * memory and thrown away; nothing is uploaded to Notion but the findings.
 *
 * The file never leaves this request and is never modified. Advisory only.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const design = cachedRecord(id);
    if (!design || design.dbKey !== "designs") {
      return NextResponse.json({ error: "Design not found in cache — refresh first" }, { status: 404 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string" || file.size === 0) {
      return NextResponse.json({ error: "Drop the master PNG to check it." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "The print file must be an image." }, { status: 400 });
    }

    const dim = (k: string): number | null => {
      const v = form.get(k);
      const n = typeof v === "string" ? Number(v) : NaN;
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    };

    const result = await inspectPrintFile(Buffer.from(await file.arrayBuffer()), {
      width: dim("trueWidth"),
      height: dim("trueHeight"),
    });

    await updateRecord("designs", id, {
      "Print File Checked": true,
      "Print File Check Notes": checkNotes(result),
    });

    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
