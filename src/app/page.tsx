/**
 * Today — only what's actionable now (spec §2.2). If this screen ever starts
 * resembling a Notion table view, delete it.
 */
import Link from "next/link";
import { todaySummary } from "@/server/viewmodels";
import { syncState, getMeta } from "@/server/cache/db";
import { notionConfigured } from "@/server/notion/client";
import { RefreshButton } from "@/components/RefreshButton";
import { ProvisionButton } from "@/components/ProvisionButton";
import { DedupePanel } from "@/components/DedupePanel";
import { EmptyState, Kicker } from "@/components/ui";
import { assetUrl } from "@/lib/assets";

export const dynamic = "force-dynamic";

export default function TodayPage() {
  const provisioned = Boolean(getMeta("schema_provisioned_at"));
  const sync = syncState();
  const lastSync = Object.values(sync)
    .map((s) => s.lastSyncedAt)
    .sort()
    .pop();

  if (!notionConfigured() || !provisioned) {
    return (
      <div className="content-inner">
        <div className="page-head">
          <h1 className="page-title">Today</h1>
        </div>
        <EmptyState
          title="Let's wire up Notion"
          copy={
            !notionConfigured()
              ? "Set NOTION_TOKEN and NOTION_PARENT_PAGE_ID in the environment (host dashboard or .env.local), share the parent page with the integration, then come back here."
              : "Tokens found — one click builds all the databases under your parent page."
          }
          action={notionConfigured() ? <ProvisionButton /> : undefined}
          hint={notionConfigured() ? "Safe to re-run any time — it patches, never duplicates." : "notion.so/my-integrations → new integration → share your page with it"}
          patternUrl={assetUrl("pattern")}
          figureUrl={assetUrl("figure")}
        />
      </div>
    );
  }

  const s = todaySummary();
  const nothingYet = s.designs.total === 0 && s.listings.total === 0 && s.inboxCount === 0;

  return (
    <div className="content-inner">
      <div className="page-head">
        <h1 className="page-title">Today</h1>
        <div className="page-head-actions">
          {/* Applies schema changes (new fields/relations) — idempotent, adopts, never duplicates */}
          <ProvisionButton compact />
          <RefreshButton lastSyncedAt={lastSync ?? null} />
        </div>
      </div>

      {nothingYet ? (
        <EmptyState
          title="Nothing to triage"
          copy="Go make something weird — or capture the idea before it dies in the camera roll."
          action={<Link href="/inbox" className="btn btn-primary">Capture an idea</Link>}
          patternUrl={assetUrl("pattern")}
          figureUrl={assetUrl("figure")}
        />
      ) : (
        <div className="stack-22">
          {/* what to do next, in priority order — Today's whole job (spec §2.2) */}
          {s.nextUp.length > 0 && (
            <div className="card" style={{ gap: 12 }}>
              <Kicker>NEXT UP</Kicker>
              {s.nextUp.map((n) => (
                <Link key={n.label} href={n.href} style={{ display: "block" }}>
                  <div className="body-sm">
                    <strong>{n.label}</strong>
                    <span className="muted"> — {n.why}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {(s.designs.blocked > 0 || s.listings.blocked > 0) && (
            <div className="callout blocked">
              {s.designs.blocked + s.listings.blocked} record
              {s.designs.blocked + s.listings.blocked === 1 ? " is" : "s are"} blocked — open them to
              see the unblocking step.
            </div>
          )}
          {(s.designs.stale > 0 || s.listings.stale > 0) && (
            <div className="callout stale">
              {s.designs.stale + s.listings.stale} record
              {s.designs.stale + s.listings.stale === 1 ? " has" : "s have"} stale steps after a
              backtrack — redo them or confirm still valid.
            </div>
          )}
          {s.urgentIdeas > 0 && (
            <div className="callout stale">
              {s.urgentIdeas} seasonal idea{s.urgentIdeas === 1 ? "" : "s"} must enter creative this
              week to make their occasion. <Link href="/inbox">Triage now →</Link>
            </div>
          )}

          <div className="grid-cards">
            <Link href="/designs" style={{ display: "block" }}>
              <div className="card" style={{ gap: 10 }}>
                <Kicker>DESIGNS IN CREATIVE</Kicker>
                <div className="card-title">{s.designs.total}</div>
                <div className="body-sm muted">
                  {s.designs.byStep.map((b) => `${b.count} at ${b.step}`).join(" · ") || "none yet"}
                </div>
              </div>
            </Link>
            <Link href="/listings" style={{ display: "block" }}>
              <div className="card" style={{ gap: 10 }}>
                <Kicker>LISTINGS IN FLIGHT</Kicker>
                <div className="card-title">{s.listings.total}</div>
                <div className="body-sm muted">draft-only publishing — final publish in Shop Manager</div>
              </div>
            </Link>
            <Link href="/inbox" style={{ display: "block" }}>
              <div className="card" style={{ gap: 10 }}>
                <Kicker>IDEAS INBOX</Kicker>
                <div className="card-title">{s.inboxCount}</div>
                <div className="body-sm muted">capture is one action; triage weekly</div>
              </div>
            </Link>
          </div>

          {s.greenlitWaiting.length > 0 && (
            <div className="card supporting">
              <Kicker>GREENLIT, WAITING FOR A DESIGN</Kicker>
              <div className="body-sm">{s.greenlitWaiting.join(" · ")}</div>
            </div>
          )}

          <DedupePanel />

          <div className="card supporting">
            <Kicker>RECENT MOVES</Kicker>
            {s.recentMoves.length === 0 ? (
              <div className="body-sm muted">No workflow activity yet.</div>
            ) : (
              <div className="stack-12">
                {s.recentMoves.map((m) => (
                  <div key={m.id} className="body-sm">
                    <strong>{m.event}</strong> — {m.name}
                    {m.detail ? ` (${m.detail})` : ""}
                    <span className="muted"> · {m.at ? new Date(m.at).toLocaleString() : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
