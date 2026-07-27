"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** One-click schema setup for cloud deployments — no terminal required. */
export function ProvisionButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const router = useRouter();

  async function provision() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/provision", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Provisioning failed");
      setDone(json.result.databases.length);
      // pull the freshly created (empty) databases into the cache
      await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ db: "all" }),
      });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-12" style={{ alignItems: "center" }}>
      <button className="btn btn-primary" onClick={provision} disabled={busy}>
        {busy ? <span className="spinner" /> : null}
        {busy ? "Building databases in Notion…" : "Provision Notion schema"}
      </button>
      {done != null ? <span className="hint">{done} databases ready.</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
