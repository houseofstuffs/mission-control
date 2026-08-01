import { NextResponse } from "next/server";
import { cachedRecord, refreshRecord } from "@/server/notion/store";
import type { SimpleRecord } from "@/server/notion/props";
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

class LayerExpiredError extends Error {}

async function fetchLayer(url: string | null, label: string): Promise<Buffer | null> {
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) {
    // Notion file URLs expire about an hour after a sync — the caller
    // gets one chance to re-mint them before this becomes a real error.
    throw new LayerExpiredError(`Couldn't fetch the ${label} (${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Every layer for one attempt — thrown LayerExpiredError signals "refetch the record and retry". */
async function fetchLayers(template: SimpleRecord) {
  const base = await fetchLayer(firstFileUrl(template.props["Base Image"]), "base image");
  const displacement = await fetchLayer(firstFileUrl(template.props["Displacement Map"]), "displacement map");
  const shadow = await fetchLayer(firstFileUrl(template.props["Shadow Layer"]), "shadow layer");
  const highlight = await fetchLayer(firstFileUrl(template.props["Highlight Layer"]), "highlight layer");
  return { base, displacement, shadow, highlight };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    let template = cachedRecord(id);
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

    // Notion's signed file URLs go stale roughly an hour after the record
    // was last fetched. Rather than making the operator notice a 403 and
    // hit Refresh by hand, re-fetch this ONE record from Notion (fresh
    // URLs) and retry once before surfacing anything.
    let layers;
    try {
      layers = await fetchLayers(template);
    } catch (err) {
      if (!(err instanceof LayerExpiredError)) throw err;
      template = await refreshRecord("mockup_templates", id);
      try {
        layers = await fetchLayers(template);
      } catch (err2) {
        const msg = err2 instanceof LayerExpiredError ? err2.message : (err2 as Error).message;
        return NextResponse.json(
          { error: `${msg} Re-uploading the file on this template would fix it for good.` },
          { status: 502 }
        );
      }
    }
    if (!layers.base) {
      return NextResponse.json({ error: "This template has no base image." }, { status: 400 });
    }

    const quadOverrideRaw = form.get("quadOverride");
    const opacityRaw = Number(form.get("artworkOpacity") ?? 1);
    const artworkOpacity = Number.isFinite(opacityRaw) ? Math.min(1, Math.max(0.05, opacityRaw)) : 1;
    const png = await renderMockup(
      {
        pipelineType,
        quad: parseQuad(String(template.props["Print Area Quad (JSON)"] ?? "")),
        blend: (String(template.props["Blend Mode"] ?? "") || DEFAULT_BLEND) as BlendMode,
        fit: (String(template.props["Fit"] ?? "") || DEFAULT_FIT) as FitMode,
      },
      {
        base: layers.base,
        displacement: layers.displacement,
        shadow: layers.shadow,
        highlight: layers.highlight,
      },
      Buffer.from(await artwork.arrayBuffer()),
      typeof quadOverrideRaw === "string" && quadOverrideRaw ? parseQuad(quadOverrideRaw) : null,
      artworkOpacity
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
