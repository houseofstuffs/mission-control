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
  /** what this connection's consent actually granted; null = pre-scope-recording (old read-only ask) */
  scopes: string | null;
  canWriteListings: boolean;
}

/** the stored scope string, in plain words */
function scopeWords(scopes: string): string {
  const has = new Set(scopes.split(/\s+/));
  const parts: string[] = [];
  if (has.has("shops_r")) parts.push("shop & shipping profiles (read)");
  if (has.has("listings_r") || has.has("listings_w")) {
    parts.push(has.has("listings_w") ? "listings (read + write — L7 push ready)" : "listings (read)");
  }
  return parts.join(" · ") || scopes;
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
      {status.connected ? (
        // report what the STORED connection can do, never what the code
        // wishes it could — a hardcoded "read-only" caption sat here while
        // the scopes question was live, and captions that guess are worse
        // than none
        status.scopes ? (
          <span className="hint">
            connected {status.connectedAt ? status.connectedAt.slice(0, 10) : ""} — {scopeWords(status.scopes)}
          </span>
        ) : (
          <span className="hint" style={{ color: "var(--status-stale, #9a6e12)" }}>
            connected {status.connectedAt ? status.connectedAt.slice(0, 10) : ""} — an older read-only
            grant (before listing access existed). Disconnect and reconnect to add listing read/write;
            Etsy will show the expanded consent screen, which is how you know the widened request
            reached it.
          </span>
        )
      ) : (
        <span className="hint">
          One-time consent screen. Grants shop &amp; shipping-profile reads (L3) and listing
          read/write (L7&apos;s push — drafts only, publish stays in Shop Manager).
        </span>
      )}
      {notice ? <span className="hint">{notice}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
