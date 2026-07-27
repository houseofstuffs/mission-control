import { designKanbanCards } from "@/server/viewmodels";
import { cachedRecords } from "@/server/notion/store";
import { syncState } from "@/server/cache/db";
import { Kanban } from "@/components/Kanban";
import { RefreshButton } from "@/components/RefreshButton";
import { NewDesignButton } from "@/components/NewRecordButtons";
import { EmptyState } from "@/components/ui";
import { assetUrl } from "@/lib/assets";

export const dynamic = "force-dynamic";

export default function DesignsPage() {
  const cards = designKanbanCards();
  const niches = cachedRecords("niches")
    .filter((n) => n.props["Gate"] === "Greenlit")
    .map((n) => ({ id: n.id, name: n.title }));
  const products = cachedRecords("products").map((p) => ({ id: p.id, name: p.title }));
  const sync = syncState()["designs"];

  return (
    <div className="content-inner full">
      <div className="page-head">
        <h1 className="page-title">Designs</h1>
        <div className="page-head-actions">
          <RefreshButton db="designs" lastSyncedAt={sync?.lastSyncedAt ?? null} />
          <NewDesignButton greenlitNiches={niches} products={products} />
        </div>
      </div>
      {cards.length === 0 ? (
        <EmptyState
          title="No designs in flight"
          copy="Greenlight a niche, then start the first one. The runner walks you through every step from prompt to fan-out."
          patternUrl={assetUrl("pattern")}
          figureUrl={assetUrl("figure")}
        />
      ) : (
        <Kanban cards={cards} />
      )}
    </div>
  );
}
