"use client";

/**
 * Etsy OAuth connect + Shipping Profiles sync — same shape as ProvisionButton
 * (one-click, idempotent, status inline) but for the Etsy side of the app
 * instead of Notion. Etsy is read-only here: this only ever pulls Shipping
 * Profiles into Notion, never writes (writes are isolated to
 * src/server/etsy/publisher.ts, and shipping profiles aren't in scope there).
 */
import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { apiJson } from "@/lib/api";
import { Kicker } from "./ui";

export interface EtsyStatus {
  connected: boolean;
  shopName: string | null;
  connectedAt: string | null;
}

export function EtsyConnectCard({ status }: { status: EtsyStatus }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The OAuth callback lands back here with ?etsy_connected= or
  // ?etsy_error= — show it once, then strip it so a reload doesn't repeat it.
  useEffect(() => {
    const connected = searchParams.get("etsy_connected");
    const etsyError = searchParams.get("etsy_error");
    if (!connected && !etsyError) return;
    if (connected) setNotice(`Connected to ${connected}.`);
    if (etsyError) setError(etsyError);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("etsy_connected");
    params.delete("etsy_error");
    router.replace(params.toString() ? `${pathname}?${params}` : pathname, { scroll: false });
    // one-time on arrival only — re-running on every searchParams change would loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sync() {
    setSyncing(true);
    setError(null);
    const res = await apiJson<{ result?: { synced: number } }>("/api/etsy/sync-shipping-profiles", "POST", {});
    if (!res.ok) setError(res.error);
    else {
      const n = res.data.result?.synced ?? 0;
      setNotice(`Synced ${n} shipping profile${n === 1 ? "" : "s"}.`);
    }
    setSyncing(false);
    router.refresh();
  }

  async function disconnectEtsy() {
    setDisconnecting(true);
    setError(null);
    setNotice(null);
    await apiJson("/api/etsy/disconnect", "POST", {});
    setDisconnecting(false);
    router.refresh();
  }

  return (
    <div className="card supporting" style={{ gap: 10 }}>
      <div className="row-gap-12" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <Kicker>ETSY</Kicker>
        {status.connected ? (
          <span className="chip done">
            connected{status.shopName ? ` · ${status.shopName}` : ""}
          </span>
        ) : (
          <span className="chip stale">not connected</span>
        )}
        <span className="row-gap-8" style={{ marginLeft: "auto" }}>
          {status.connected ? (
            <>
              <button className="btn btn-secondary" onClick={sync} disabled={syncing}>
                {syncing ? <span className="spinner" /> : null}
                Sync shipping profiles
              </button>
              <button className="btn btn-tertiary" onClick={disconnectEtsy} disabled={disconnecting}>
                {disconnecting ? <span className="spinner" /> : null}
                Disconnect
              </button>
            </>
          ) : (
            <a className="btn btn-primary" href="/api/etsy/oauth/start">
              Connect Etsy
            </a>
          )}
        </span>
      </div>
      {status.connected && status.connectedAt ? (
        <span className="hint">connected {status.connectedAt.slice(0, 10)} — read-only, pulls Shipping Profiles into Notion</span>
      ) : (
        <span className="hint">
          One-time consent screen, then this pulls your Etsy Shipping Profiles into Notion so the L3
          calculator can show what buyers actually pay for shipping.
        </span>
      )}
      {notice ? <span className="hint">{notice}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
