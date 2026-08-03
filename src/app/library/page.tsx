/**
 * Library — the inbox-grid archetype serving the clipper-fed collections:
 * Textures and Mockup Templates (spec §12 archetype 3). Both arrive via the
 * browser extension in Phase 3. Styles moved to their own page — they're
 * AI-captured and hand-edited, a different lifecycle entirely.
 */
import { cachedRecords } from "@/server/notion/store";
import { syncState } from "@/server/cache/db";
import { RefreshButton } from "@/components/RefreshButton";
import { EmptyState, Kicker } from "@/components/ui";
import { assetUrl } from "@/lib/assets";
import { MockupTemplatesSection, type MockupTemplateCard, type MockupShotOption } from "@/components/MockupTemplates";
import { parseQuad } from "@/config/mockups";
import { driveConfigured } from "@/server/drive/client";
import { connectionStatus as driveConnectionStatus } from "@/server/drive/connection";
import type { SimpleRecord } from "@/server/notion/props";

export const dynamic = "force-dynamic";

function shotOption(s: SimpleRecord, mockups: SimpleRecord[]): MockupShotOption {
  let cropRect = null;
  try {
    const parsed = JSON.parse(String(s.props["Crop Rect (JSON)"] ?? ""));
    if (parsed && typeof parsed.x === "number" && typeof parsed.y === "number" && typeof parsed.size === "number") {
      cropRect = parsed;
    }
  } catch {
    /* no crop set yet */
  }
  return {
    id: s.id,
    name: s.title || "Untitled template",
    cropRect,
    printRegionQuad: parseQuad(String(s.props["Print Region Quad (JSON)"] ?? "")),
    driveFolderLink: String(s.props["Drive Folder Link"] ?? ""),
    // colours already saved under this template — the Drive review list
    // starts these unticked so a re-run can't duplicate them
    existingColours: mockups
      .filter((m) => ((m.props["Shot"] as string[] | null) ?? []).includes(s.id))
      .map((m) => String(m.props["Garment Color"] ?? "").trim())
      .filter(Boolean),
  };
}

function templateCard(m: SimpleRecord, shotsById: Map<string, SimpleRecord>): MockupTemplateCard {
  const fileUrl = (prop: string): string | null => {
    const v = m.props[prop];
    if (!Array.isArray(v) || v.length === 0) return null;
    return (v[0] as { url?: string })?.url || null;
  };
  const shotId = ((m.props["Shot"] as string[] | null) ?? [])[0];
  const shotName = shotId ? shotsById.get(shotId)?.title ?? null : null;
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
  };
}

export default function LibraryPage() {
  const textures = cachedRecords("textures");
  const mockups = cachedRecords("mockup_templates");
  const mockupShots = cachedRecords("mockup_shots");
  const shotsById = new Map(mockupShots.map((s) => [s.id, s]));
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
          shots={mockupShots.map((s) => shotOption(s, mockups))}
          palette={palette}
          drive={{ configured: driveConfigured(), ...driveConnectionStatus() }}
        />
      </div>
    </div>
  );
}
