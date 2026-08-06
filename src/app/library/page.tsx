/**
 * Library — the inbox-grid archetype serving the clipper-fed collections:
 * Textures and Mockup Templates (spec §12 archetype 3). Both arrive via the
 * browser extension in Phase 3. Styles moved to their own page — they're
 * AI-captured and hand-edited, a different lifecycle entirely.
 */
import { cachedRecords } from "@/server/notion/store";
import { productLabel } from "@/server/viewmodels";
import { syncState } from "@/server/cache/db";
import { RefreshButton } from "@/components/RefreshButton";
import { EmptyState, Kicker } from "@/components/ui";
import { assetUrl } from "@/lib/assets";
import { MockupTemplatesSection, type MockupTemplateCard, type MockupShotOption } from "@/components/MockupTemplates";
import { parseQuad } from "@/config/mockups";
import { driveConfigured } from "@/server/drive/client";
import { jobStatus } from "@/server/drive/importJob";
import { connectionStatus as driveConnectionStatus } from "@/server/drive/connection";
import type { SimpleRecord } from "@/server/notion/props";

export const dynamic = "force-dynamic";

function shotOption(s: SimpleRecord, mockups: SimpleRecord[], slots: SimpleRecord[]): MockupShotOption {
  let cropRect = null;
  try {
    const parsed = JSON.parse(String(s.props["Crop Rect (JSON)"] ?? ""));
    if (parsed && typeof parsed.x === "number" && typeof parsed.y === "number" && typeof parsed.size === "number") {
      cropRect = parsed;
    }
  } catch {
    /* no crop set yet */
  }
  const variants = mockups.filter((m) => ((m.props["Shot"] as string[] | null) ?? []).includes(s.id));
  const variantIds = new Set(variants.map((v) => v.id));
  // distinct listings whose slots hold one of this template's variants —
  // the honest count for "delete anyway?"
  const listingIds = new Set(
    slots
      .filter((sl) => (((sl.props["Mockup Template"] as string[] | null) ?? []).some((t) => variantIds.has(t))))
      .flatMap((sl) => (sl.props["Listing"] as string[] | null) ?? [])
  );
  const hasSample = Array.isArray(s.props["Sample Image"]) && (s.props["Sample Image"] as unknown[]).length > 0;
  return {
    id: s.id,
    name: s.title || "Untitled template",
    cropRect,
    printRegionQuad: parseQuad(String(s.props["Print Region Quad (JSON)"] ?? "")),
    driveFolderLink: String(s.props["Drive Folder Link"] ?? ""),
    // colours already saved under this template — the Drive review list
    // starts these unticked so a re-run can't duplicate them
    existingColours: variants.map((m) => String(m.props["Garment Color"] ?? "").trim()).filter(Boolean),
    thumbUrl: hasSample ? `/api/mockup-shots/${s.id}/thumb?v=${encodeURIComponent(s.lastEdited)}` : null,
    variantCount: variants.length,
    listingCount: listingIds.size,
    productId: (((s.props["Product"] as string[] | null) ?? [])[0]) ?? "",
    shotType: String(s.props["Shot Type"] ?? ""),
    importJob: (() => {
      const job = jobStatus(s.id);
      return job
        ? { status: job.status, done: job.done, total: job.total, imported: job.imported }
        : null;
    })(),
  };
}

function templateCard(m: SimpleRecord, shotsById: Map<string, SimpleRecord>): MockupTemplateCard {
  const fileUrl = (prop: string): string | null => {
    const v = m.props[prop];
    if (!Array.isArray(v) || v.length === 0) return null;
    return (v[0] as { url?: string })?.url || null;
  };
  const shotId = ((m.props["Shot"] as string[] | null) ?? [])[0];
  const shot = shotId ? shotsById.get(shotId) : undefined;
  const shotName = shot?.title ?? null;
  // the crop the Adjust-crop editor starts from: the variant's own stored
  // rect, else the shot's shared rect (legacy variants predate per-variant
  // provenance and start where the batch cropped)
  const parseRect = (raw: unknown) => {
    try {
      const parsed = JSON.parse(String(raw ?? ""));
      if (parsed && typeof parsed.x === "number" && typeof parsed.y === "number" && typeof parsed.size === "number") {
        return parsed as { x: number; y: number; size: number };
      }
    } catch {
      /* not set */
    }
    return null;
  };
  const sourceCropRect = parseRect(m.props["Source Crop Rect (JSON)"]) ?? parseRect(shot?.props["Crop Rect (JSON)"]);
  return {
    id: m.id,
    name: m.title || "Untitled variant",
    thumbUrl: fileUrl("Base Image")
      ? `/api/mockup-templates/${m.id}/thumb?v=${encodeURIComponent(m.lastEdited)}`
      : null,
    pipelineType: String(m.props["Pipeline Type"] ?? ""),
    surface: String(m.props["Surface"] ?? ""),
    blend: String(m.props["Blend Mode"] ?? ""),
    quadSet: String(m.props["Print Area Quad (JSON)"] ?? "").trim().length > 0,
    fit: String(m.props["Fit"] ?? ""),
    garmentColor: String(m.props["Garment Color"] ?? ""),
    baseImageUrl: fileUrl("Base Image"),
    hasDisplacement: fileUrl("Displacement Map") != null,
    hasShadow: fileUrl("Shadow Layer") != null,
    hasHighlight: fileUrl("Highlight Layer") != null,
    sourceLink: String(m.props["File Link"] ?? ""),
    shotName: shotName || null,
    shotId: shotId ?? null,
    hasSource: String(m.props["Source Drive File"] ?? "").trim().length > 0,
    sourceCropRect,
  };
}

export default function LibraryPage() {
  const textures = cachedRecords("textures");
  const mockups = cachedRecords("mockup_templates");
  const mockupShots = cachedRecords("mockup_shots");
  const shotsById = new Map(mockupShots.map((s) => [s.id, s]));
  const imageSlots = cachedRecords("image_slots");
  const designs = cachedRecords("designs");
  // the closed set filenames are matched against — every colour any
  // product variant actually comes in
  const palette = Array.from(
    new Set(
      cachedRecords("product_variants")
        .map((v) => String(v.props["Color"] ?? "").trim())
        .filter(Boolean)
    )
  ).sort();
  const sync = syncState()["textures"];

  // Templates count as content — a library holding only templates is not
  // empty. (And the empty state must never be the whole page: it hides the
  // create button, which would make a first template impossible.)
  const empty = textures.length === 0 && mockups.length === 0 && mockupShots.length === 0;

  const textureUsage = (textureId: string) =>
    designs.filter((d) => (d.props["Texture"] as string[] | null)?.includes(textureId)).length;

  return (
    <div className="content-inner">
      <div className="page-head">
        <h1 className="page-title">Library</h1>
        <RefreshButton lastSyncedAt={sync?.lastSyncedAt ?? null} />
      </div>

      {empty ? (
        <EmptyState
          title="Your library builds itself"
          copy="Textures arrive with the browser clipper. Mockup templates you define here — start with ＋ New template below."
          hint="The browser extension arrives in Phase 3."
          patternUrl={assetUrl("pattern")}
          figureUrl={assetUrl("figure")}
        />
      ) : null}

      <div className="stack-22">
        {empty ? null : (
          <section className="stack-12">
            <Kicker>TEXTURES · {textures.length}</Kicker>
            <div className="inbox-grid">
              {textures.map((t) => (
                <div key={t.id} className="idea-card">
                  <div className="title">{t.title}</div>
                  <div className="hint">
                    {String(t.props["Source"] ?? "")}
                    {t.props["Source"] === "Kittl" ? " · thumbnail only (no API)" : " · real composites possible"}
                  </div>
                  <span className="chip count">used in {textureUsage(t.id)}</span>
                </div>
              ))}
              {textures.length === 0 ? <div className="hint">No textures yet — owned files unlock real composite previews.</div> : null}
            </div>
          </section>
        )}

        <MockupTemplatesSection
          templates={mockups.map((m) => templateCard(m, shotsById))}
          shots={mockupShots.map((s) => shotOption(s, mockups, imageSlots))}
          palette={palette}
          drive={{ configured: driveConfigured(), ...driveConnectionStatus() }}
          products={cachedRecords("products").map((p) => ({ id: p.id, label: productLabel(p) }))}
          // exact-name twins — the duplicate-import incident's residue.
          // Non-zero surfaces the one-click cleanup.
          duplicateVariants={mockups.length - new Set(mockups.map((m) => (m.title || "").trim())).size}
        />
      </div>
    </div>
  );
}
