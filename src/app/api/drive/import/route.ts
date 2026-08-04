import { NextResponse } from "next/server";
import { cachedRecord } from "@/server/notion/store";
import { startImportJob, jobStatus, type ImportFile } from "@/server/drive/importJob";
import { parseQuad } from "@/config/mockups";

export const dynamic = "force-dynamic";

/**
 * Kicks off the background import for one template. Geometry comes off the
 * template RECORD, not the request — the client picks which files and what
 * colour each one is; the crop is whatever the template says it is.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const shotId = String(body.shotId ?? "");
    const shot = shotId ? cachedRecord(shotId) : null;
    if (!shot || shot.dbKey !== "mockup_shots") {
      return NextResponse.json({ error: "Template not found — refresh and try again." }, { status: 404 });
    }

    let rect: { x: number; y: number; size: number } | null = null;
    try {
      const parsed = JSON.parse(String(shot.props["Crop Rect (JSON)"] ?? ""));
      if (typeof parsed?.x === "number" && typeof parsed?.y === "number" && typeof parsed?.size === "number" && parsed.size > 0) {
        rect = parsed;
      }
    } catch {
      /* handled below */
    }
    if (!rect) {
      return NextResponse.json({ error: "This template has no crop set — define it first." }, { status: 400 });
    }

    const files = (Array.isArray(body.files) ? body.files : [])
      .map((f: { id?: unknown; name?: unknown; colour?: unknown }) => ({
        id: String(f.id ?? ""),
        name: String(f.name ?? ""),
        colour: String(f.colour ?? "").trim(),
      }))
      .filter((f: ImportFile) => f.id && f.colour);
    if (files.length === 0) {
      return NextResponse.json({ error: "Nothing to import — tick at least one file with a colour." }, { status: 400 });
    }

    // a live job is a conflict, not a server error — the second tab gets
    // told what's running, with the count to watch
    const existing = jobStatus(shotId);
    if (existing?.status === "running") {
      return NextResponse.json(
        { error: `An import is already running for this template (${existing.done}/${existing.total}) — wait for it to finish.` },
        { status: 409 }
      );
    }

    const job = startImportJob({
      shotId,
      templateName: shot.title || "Untitled template",
      rect,
      quad: parseQuad(String(shot.props["Print Region Quad (JSON)"] ?? "")),
      files,
    });
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Live progress for one template's job — the page polls this while open. */
export async function GET(req: Request) {
  const shotId = new URL(req.url).searchParams.get("shotId") ?? "";
  if (!shotId) return NextResponse.json({ error: "shotId required" }, { status: 400 });
  return NextResponse.json({ job: jobStatus(shotId) });
}
