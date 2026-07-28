"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** One-click schema setup for cloud deployments — no terminal required. */
interface Diagnosis {
  target: string;
  targetVisible: boolean;
  visible: Array<{ id: string; type: string; title: string }>;
}

export function ProvisionButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const router = useRouter();

  async function provision() {
    setBusy(true);
    setError(null);
    setDiag(null);
    try {
      const res = await fetch("/api/provision", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        // On failure, ask Notion what this token can actually see — turns
        // "could not find page" into a self-explanatory answer.
        try {
          const dRes = await fetch("/api/notion/diagnose", { method: "POST" });
          const dJson = await dRes.json();
          if (dRes.ok) setDiag(dJson);
        } catch {
          /* diagnosis is best-effort */
        }
        throw new Error(json.error ?? "Provisioning failed");
      }
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
    <div className="stack-12" style={{ alignItems: compact ? "flex-end" : "center" }}>
      <button className={`btn ${compact ? "btn-secondary" : "btn-primary"}`} onClick={provision} disabled={busy}>
        {busy ? <span className="spinner" /> : null}
        {compact ? (busy ? "Syncing schema" : "Sync schema") : busy ? "Building databases in Notion…" : "Provision Notion schema"}
      </button>
      {done != null ? <span className="hint">{done} databases ready.</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
      {diag ? (
        <div className="body-sm" style={{ textAlign: "left", maxWidth: 420 }}>
          {diag.visible.length === 0 ? (
            <>
              This integration can&apos;t see <strong>anything</strong> in your workspace yet — the
              connection step hasn&apos;t reached any page. In Notion, open the parent page →{" "}
              <strong>••• → Connections → Add connection</strong> → pick the integration this
              token belongs to.
            </>
          ) : diag.targetVisible ? (
            <>The page is visible now — provisioning should succeed. Try the button again.</>
          ) : (
            <>
              The integration CAN see {diag.visible.length} item
              {diag.visible.length === 1 ? "" : "s"}:{" "}
              {diag.visible.map((v) => `“${v.title}”`).join(", ")} — but none of them is the page
              id configured in NOTION_PARENT_PAGE_ID ({diag.target.slice(0, 8)}…). Either point
              the env var at one of the pages above (paste its link), or add the connection to
              the intended page.
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
