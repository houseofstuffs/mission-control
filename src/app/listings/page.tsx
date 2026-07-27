import { listingRows } from "@/server/viewmodels";
import { cachedRecords } from "@/server/notion/store";
import { syncState } from "@/server/cache/db";
import { ListingsTable } from "@/components/ListingsTable";
import { RefreshButton } from "@/components/RefreshButton";
import { NewListingButton } from "@/components/NewRecordButtons";
import { EmptyState } from "@/components/ui";
import { assetUrl } from "@/lib/assets";

export const dynamic = "force-dynamic";

export default function ListingsPage() {
  const rows = listingRows();
  const designs = cachedRecords("designs").map((d) => ({ id: d.id, name: d.title }));
  const products = cachedRecords("products").map((p) => ({ id: p.id, name: p.title }));
  const sync = syncState()["etsy_listings"];

  return (
    <div className="content-inner full">
      <div className="page-head">
        <h1 className="page-title">Listings</h1>
        <div className="page-head-actions">
          <RefreshButton db="etsy_listings" lastSyncedAt={sync?.lastSyncedAt ?? null} />
          <NewListingButton designs={designs} products={products} />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="No listings yet"
          copy="Validate a design first, then bring it here. The runner carries it from Printify product to a complete Etsy draft."
          patternUrl={assetUrl("pattern")}
          figureUrl={assetUrl("figure")}
        />
      ) : (
        <ListingsTable rows={rows} />
      )}
    </div>
  );
}
