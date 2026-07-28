"use client";

/**
 * One-off cleanup for duplicate databases created by provisioning runs that
 * predate the adopt-by-title logic. Scans first and shows the full plan;
 * nothing moves until you confirm. Archiving puts databases in Notion's
 * trash, restorable for about 30 days.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";

interface PlanItem {
  title: string;
  keepId: string | null;
  archiveIds: string[];
  skipped?: string;
}

export function DedupePanel() {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [totalToArchive, setTotal] = useState(0);
  const [scanned, setScanned] = useState(0);
  const [busy, setBusy] = useState<"scan" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function call(dryRun: boolean) {
    setBusy(dryRun ? "scan" : "run");
    setError(null);
    try {
      const res = await fetch("/api/notion/dedupe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Scan failed");
      setPlan(json.plan);
      setScanned(json.scanned ?? 0);
      setTotal(json.totalToArchive ?? 0);
      if (!dryRun) {
        setDone(json.archived ?? 0);
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const duplicates = (plan ?? []).filter((p) => p.archiveIds.length > 0);
  const skipped = (plan ?? []).filter((p) => p.skipped);

  return (
    <div className="card supporting">
      <Kicker>DATABASE CLEANUP</Kicker>
      <div className="body-sm muted">
        Finds duplicate Notion databases left by earlier provisioning runs, keeps the copy this app
        is registered to, and moves the rest to Notion&apos;s trash (restorable ~30 days).
      </div>

      {error ? <div className="callout blocked">{error}</div> : null}

      {done != null ? (
        <div className="callout stale" style={{ background: "#eef8f4", borderColor: "#68c2a9", color: "#134a3a" }}>
          Archived {done} duplicate database{done === 1 ? "" : "s"}. Run Sync schema, then Refresh.
        </div>
      ) : null}

      {plan && done == null ? (
        duplicates.length === 0 ? (
          <div className="body-sm">
            Scanned {scanned} databases — no duplicates found. Nothing to clean up.
          </div>
        ) : (
          <>
            <div className="callout stale">
              Found {totalToArchive} duplicate database{totalToArchive === 1 ? "" : "s"} across{" "}
              {duplicates.length} name{duplicates.length === 1 ? "" : "s"}. Review below, then
              confirm.
            </div>
            <div className="stack-12">
              {duplicates.map((p) => (
                <div key={p.title} className="well">
                  <strong>{p.title}</strong>
                  <div className="body-sm" style={{ marginTop: 4 }}>
                    keep <code>…{(p.keepId ?? "").replace(/-/g, "").slice(-8)}</code> · archive{" "}
                    {p.archiveIds
                      .map((id) => `…${id.replace(/-/g, "").slice(-8)}`)
                      .join(", ")}
                  </div>
                </div>
              ))}
            </div>
            {skipped.length > 0 ? (
              <div className="body-sm muted">
                Left alone (no registered copy): {skipped.map((s) => s.title).join(", ")}
              </div>
            ) : null}
          </>
        )
      ) : null}

      <div className="row-gap-12">
        <button className="btn btn-secondary" onClick={() => call(true)} disabled={busy !== null}>
          {busy === "scan" ? <span className="spinner" /> : null}
          {plan ? "Re-scan" : "Scan for duplicates"}
        </button>
        {duplicates.length > 0 && done == null ? (
          <button className="btn btn-primary" onClick={() => call(false)} disabled={busy !== null}>
            {busy === "run" ? <span className="spinner" /> : null}
            Archive {totalToArchive} duplicate{totalToArchive === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
