import { ideaCards, nicheCards } from "@/server/viewmodels";
import { NichesPanel } from "@/components/NichesPanel";
import { syncState } from "@/server/cache/db";
import { InboxGrid } from "@/components/InboxGrid";
import { RefreshButton } from "@/components/RefreshButton";
import { EmptyState } from "@/components/ui";
import { assetUrl } from "@/lib/assets";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  const { ideas, niches } = ideaCards();
  const sync = syncState()["ideas"];

  return (
    <div className="content-inner">
      <div className="page-head">
        <h1 className="page-title">Inbox</h1>
        <RefreshButton db="ideas" lastSyncedAt={sync?.lastSyncedAt ?? null} />
      </div>
      <div className="stack-22">
        <InboxGrid
          ideas={ideas}
          niches={niches}
          emptyHero={
            ideas.length === 0 ? (
              <EmptyState
                title="Nothing to triage"
                patternUrl={assetUrl("pattern")}
                figureUrl={assetUrl("figure")}
              />
            ) : undefined
          }
        />
        {/* Gate decisions live here: triage ends at the niche, and
            greenlighting one is what unlocks it in New design. */}
        <NichesPanel niches={nicheCards()} />
      </div>
    </div>
  );
}
