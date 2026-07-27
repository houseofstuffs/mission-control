import { ideaCards } from "@/server/viewmodels";
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
      {ideas.length === 0 ? (
        <>
          <InboxGrid ideas={[]} niches={niches} />
          <EmptyState
            title="Nothing to triage"
            copy="Ideas die in the camera roll because capture costs too much. Here it's one line and done — organize later, at a desk."
            hint="Phone album sync and the browser clipper arrive in Phase 3."
            patternUrl={assetUrl("pattern")}
            figureUrl={assetUrl("figure")}
          />
        </>
      ) : (
        <InboxGrid ideas={ideas} niches={niches} />
      )}
    </div>
  );
}
