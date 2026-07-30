"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TimeStamp } from "./TimeStamp";

/**
 * Explicit refresh — the only way reads reach Notion (spec §2.1). Shows the
 * last-synced time so staleness is visible, not silent.
 *
 * Always refreshes ALL databases: every view renders names from related
 * records (niche names on idea cards, product names on listings), so a
 * partial refresh can show stale cross-references and quietly lie.
 */
export function RefreshButton({ lastSyncedAt }: { db?: string; lastSyncedAt?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ db: "all" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Refresh failed");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row-gap-12">
      {error ? <span className="field-error">{error}</span> : null}
      <span className="hint">
        {lastSyncedAt ? <>Synced <TimeStamp iso={lastSyncedAt} /></> : "Not synced yet"}
      </span>
      <button className="btn btn-secondary" onClick={refresh} disabled={busy}>
        {busy ? <span className="spinner" /> : null}
        {busy ? "Refreshing" : "Refresh from Notion"}
      </button>
    </div>
  );
}
