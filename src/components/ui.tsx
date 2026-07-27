import type { ReactNode } from "react";
import { FigurePlaceholder, PatternPlaceholder, RefreshGlyph } from "./marks";
import type { StepStatus } from "@/lib/workflows";

/**
 * Empty state (build spec §4): Ocean Breeze card, pattern fill at .14 with a
 * radial mask clearing a hole behind the figure. Copy tone: warm, brief,
 * active. Never the word "empty"; never grey the screen out.
 */
export function EmptyState({
  title,
  copy,
  action,
  hint,
  patternUrl,
  figureUrl,
}: {
  title: string;
  copy: string;
  action?: ReactNode;
  hint?: string;
  patternUrl?: string | null;
  figureUrl?: string | null;
}) {
  return (
    <div className="empty-wrap">
      <div className="empty-state">
        {patternUrl ? (
          <div
            className="pattern"
            style={{
              backgroundImage: `url(${patternUrl})`,
              backgroundRepeat: "repeat",
              backgroundSize: "220px",
            }}
          />
        ) : (
          <PatternPlaceholder />
        )}
        {figureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={figureUrl} alt="" className="figure" style={{ height: 140 }} />
        ) : (
          <FigurePlaceholder height={140} />
        )}
        <div className="title">{title}</div>
        <div className="copy">{copy}</div>
        {action}
        {hint ? <div className="hint">{hint}</div> : null}
      </div>
    </div>
  );
}

/** Status icon per build spec §1 — every state distinguishable without colour. */
export function StepIcon({ status, selected }: { status: StepStatus; selected?: boolean }) {
  const cls = `step-icon ${status}`;
  if (status === "done") return <span className={cls} aria-label="done">✓</span>;
  if (status === "stale")
    return (
      <span className={cls} aria-label="stale">
        <RefreshGlyph />
      </span>
    );
  if (status === "blocked") return <span className={cls} aria-label="blocked">✕</span>;
  return <span className={cls} aria-label={selected ? "current" : "pending"} />;
}

export function StatusChip({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`chip ${kind}`}>{children}</span>;
}

export function Kicker({ children }: { children: ReactNode }) {
  return <div className="kicker">{children}</div>;
}
