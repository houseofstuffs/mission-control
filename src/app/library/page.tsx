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

export const dynamic = "force-dynamic";

export default function LibraryPage() {
  const textures = cachedRecords("textures");
  const mockups = cachedRecords("mockup_templates");
  const designs = cachedRecords("designs");
  const sync = syncState()["textures"];

  const empty = textures.length === 0 && mockups.length === 0;

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
          copy="Textures and mockup templates arrive with the browser clipper. Favorites derive from usage, not a hand-maintained list. Styles live on their own page now."
          hint="The browser extension arrives in Phase 3."
          patternUrl={assetUrl("pattern")}
          figureUrl={assetUrl("figure")}
        />
      ) : (
        <div className="stack-22">
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

          <section className="stack-12">
            <Kicker>MOCKUP TEMPLATES · {mockups.length}</Kicker>
            <div className="inbox-grid">
              {mockups.map((m) => (
                <div key={m.id} className="idea-card">
                  <div className="title">{m.title}</div>
                  <div className="hint">{String(m.props["Product Types"] ?? "")}</div>
                </div>
              ))}
              {mockups.length === 0 ? <div className="hint">No mockup templates yet.</div> : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
