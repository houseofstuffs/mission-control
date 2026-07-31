import { NextResponse } from "next/server";
import { cachedRecord } from "@/server/notion/store";
import { renderMockup } from "@/server/mockup/render";
import { parseQuad, DEFAULT_BLEND, DEFAULT_FIT, type PipelineType, type BlendMode, type FitMode } from "@/config/mockups";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // fetch layers + per-pixel warp

/**
 * Render an artwork through a template. The template record carries the
 * pipeline type, so THIS route has no method parameter — intake decided,
 * render obeys. POST multipart: artwork (file), quadOverride (optional JSON,
 * design-specific placement).
 */
function firstFileUrl(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const url = (v[0] as { url?: string })?.url;
  return url || null;
}

async function fetchLayer(url: string | null, label: string): Promise<Buffer | null> {
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) {
    // Notion file URLs expire about an hour after a sync
    throw new Error(`Couldn't fetch the ${label} (${res.status}) — hit Refresh and try again.`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const template = cachedRecord(id);
    if (!template || template.dbKey !== "mockup_templates") {
      return NextResponse.json({ error: "Template not found in cache — refresh first" }, { status: 404 });
    }

    const form = await req.formData();
    const artwork = form.get("artwork");
    if (!artwork || typeof artwork === "string" || artwork.size === 0) {
      return NextResponse.json({ error: "Drop the artwork to render." }, { status: 400 });
    }
    if (!artwork.type.startsWith("image/")) {
      return NextResponse.json({ error: "The artwork must be an image." }, { status: 400 });
    }

    const pipelineType = String(template.props["Pipeline Type"] ?? "") as PipelineType;
    if (pipelineType !== "Simple Placement" && pipelineType !== "Full Displacement") {
      return NextResponse.json(
        { error: "This template predates pipelines — set its pipeline type in Notion, refresh, retry." },
        { status: 400 }
      );
    }

    const base = await fetchLayer(firstFileUrl(template.props["Base Image"]), "base image");
    if (!base) {
      return NextResponse.json({ error: "This template has no base image." }, { status: 400 });
    }

    const quadOverrideRaw = form.get("quadOverride");
    const png = await renderMockup(
      {
        pipelineType,
        quad: parseQuad(String(template.props["Print Area Quad (JSON)"] ?? "")),
        blend: (String(template.props["Blend Mode"] ?? "") || DEFAULT_BLEND) as BlendMode,
        fit: (String(template.props["Fit"] ?? "") || DEFAULT_FIT) as FitMode,
      },
      {
        base,
        displacement: await fetchLayer(firstFileUrl(template.props["Displacement Map"]), "displacement map"),
        shadow: await fetchLayer(firstFileUrl(template.props["Shadow Layer"]), "shadow layer"),
        highlight: await fetchLayer(firstFileUrl(template.props["Highlight Layer"]), "highlight layer"),
      },
      Buffer.from(await artwork.arrayBuffer()),
      typeof quadOverrideRaw === "string" && quadOverrideRaw ? parseQuad(quadOverrideRaw) : null
    );

    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="${(template.title || "mockup").replace(/[^\w.-]+/g, "-")}.png"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
