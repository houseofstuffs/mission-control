import { productCards, shippingProfileOptions } from "@/server/viewmodels";
import { printifyConfigured } from "@/server/printify/client";
import { anthropicConfigured } from "@/server/anthropic/client";
import { syncState } from "@/server/cache/db";
import { ProductsView } from "@/components/ProductsView";
import { RefreshButton } from "@/components/RefreshButton";
import { EmptyState } from "@/components/ui";
import { assetUrl } from "@/lib/assets";

export const dynamic = "force-dynamic";

export default function ProductsPage() {
  const products = productCards();
  const sync = syncState()["products"];
  const ready = printifyConfigured();
  const profiles = shippingProfileOptions();

  return (
    <div className="content-inner">
      <div className="page-head">
        <h1 className="page-title">Products</h1>
        <RefreshButton db="products" lastSyncedAt={sync?.lastSyncedAt ?? null} />
      </div>
      {products.length === 0 ? (
        <>
          <ProductsView products={[]} printifyReady={ready} anthropicReady={anthropicConfigured()} />
          <EmptyState
            title="Seed your first product"
            copy="Blueprint × print provider, straight from the Printify catalog — print areas, ratios and costs land automatically. You supply nothing."
            hint="The same shirt from two providers can have different print areas and costs."
            patternUrl={assetUrl("pattern")}
            figureUrl={assetUrl("figure")}
          />
        </>
      ) : (
        <ProductsView
          products={products}
          printifyReady={ready}
          anthropicReady={anthropicConfigured()}
          shippingProfiles={profiles}
        />
      )}
    </div>
  );
}
