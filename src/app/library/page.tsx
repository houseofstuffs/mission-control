/**
 * Library — the inbox-grid archetype serving three collections: Styles,
 * Textures, Mockup Templates (spec §12 archetype 3). Read-only in Phase 1;
 * records are created by prompts (Phase 2) and the browser clipper (Phase 3).
 */
import { cachedRecords } from "@/server/notion/store";
import { syncState } from "@/server/cache/db";
import { RefreshButton } from "@/components/RefreshButton";
import { EmptyState, Kicker } from "@/components/ui";
import { assetUrl } from "@/lib/assets";

export const dynamic = "force-dynamic";

export default function LibraryPage() {
  const styles = cachedRecords("styles");
  const textures = cachedRecords("textures");
  const mockups = cachedRecords("mockup_templates");
  const designs = cachedRecords("designs");
  const sync = syncState()["styles"];

  const empty = styles.length === 0 && textures.length === 0 && mockups.length === 0;

  const textureUsage = (textureId: string) =>
    designs.filter((d) => (d.props["Texture"] as string[] | null)?.includes(textureId)).length;
  const styleUsage = (styleId: string) =>
    designs.filter((d) => (d.props["Style"] as string[] | null)?.includes(styleId)).length;

  return (
    <div className="content-inner">
      <div className="page-head">
        <h1 className="page-title">Library</h1>
        <RefreshButton lastSyncedAt={sync?.lastSyncedAt ?? null} />
      </div>

      {empty ? (
        <EmptyState
          title="Your library builds itself"
          copy="Styles come from the Capture prompt, textures and mockup templates from the clipper. Favorites derive from usage, not a hand-maintained list."
          hint="Capture mode + the browser extension arrive in Phases 2–3."
          patternUrl={assetUrl("pattern")}
          figureUrl={assetUrl("figure")}
        />
      ) : (
        <div className="stack-22">
          <section className="stack-12">
            <Kicker>STYLES · {styles.length}</Kicker>
            <div className="inbox-grid">
              {styles.map((s) => (
                <div key={s.id} className="idea-card">
                  {(() => {
                    const img = s.props["Source Image"];
                    const first = Array.isArray(img) && img.length > 0 ? (img[0] as { url?: string }) : null;
                    return first?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={first.url} alt="" className="idea-thumb" />
                    ) : null;
                  })()}
                  <div className="title">{s.title}</div>
                  <div className="body-sm">{String(s.props["Description"] ?? "").slice(0, 140)}</div>
                  {s.props["Rule of Thumb"] ? (
                    <div className="hint">{String(s.props["Rule of Thumb"])}</div>
                  ) : null}
                  <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
                    {s.props["Category"] ? (
                      <span className="chip neutral">{String(s.props["Category"])}</span>
                    ) : null}
                    {s.props["Print Suitability"] ? (
                      <span className={`chip ${s.props["Print Suitability"] === "Avoid" ? "blocked" : "done"}`}>
                        {String(s.props["Print Suitability"])}
                      </span>
                    ) : null}
                    <span className="chip count">used in {styleUsage(s.id)}</span>
                  </div>
                </div>
              ))}
              {styles.length === 0 ? <div className="hint">No styles captured yet.</div> : null}
            </div>
          </section>

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
