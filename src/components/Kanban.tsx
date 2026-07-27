"use client";

/**
 * Designs Kanban — artwork-forward cards over creative stages. Dragging a
 * card BACK routes through the backtrack path (reason prompted, downstream
 * steps staled, logged) — the board never silently rewrites step state.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KANBAN_STAGES } from "@/lib/workflows";
import { StatusChip } from "./ui";

export interface KanbanCardData {
  id: string;
  title: string;
  currentStep: string;
  stageKey: string;
  nicheName?: string | null;
  gate?: string | null;
  hasStale: boolean;
  hasBlocked: boolean;
  listingCount: number;
  artworkUrl?: string | null;
  meta: string;
}

export function Kanban({ cards }: { cards: KanbanCardData[] }) {
  const router = useRouter();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageOrder = KANBAN_STAGES.map((s) => s.key);

  async function drop(stageKey: string) {
    const card = cards.find((c) => c.id === dragId);
    setOverStage(null);
    setDragId(null);
    if (!card || card.stageKey === stageKey) return;

    const stage = KANBAN_STAGES.find((s) => s.key === stageKey)!;
    const toStep = stage.steps[0];
    const backward = stageOrder.indexOf(stageKey) < stageOrder.indexOf(card.stageKey);

    let reason: string | undefined;
    if (backward) {
      const answer = window.prompt(
        `Moving "${card.title}" back to ${stage.label} marks dependent later steps stale. Why are you going back?`
      );
      if (answer == null || answer.trim() === "") return; // backtracks always carry a reason
      reason = answer.trim();
    }

    const res = await fetch("/api/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageId: card.id,
        action: backward ? "back" : "move",
        step: toStep === "Done" ? "C11" : toStep,
        reason,
      }),
    });
    if (toStep === "Done" && res.ok) {
      // moving to Done = marking the final step complete
      await fetch("/api/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: card.id, action: "done", step: "C11" }),
      });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setError(json.error ?? "Move failed");
    else setError(null);
    router.refresh();
  }

  return (
    <div className="stack-16">
      {error ? <div className="callout blocked">{error}</div> : null}
      <div className="kanban">
        {KANBAN_STAGES.map((stage) => {
          const colCards = cards.filter((c) => c.stageKey === stage.key);
          return (
            <div
              key={stage.key}
              className={`kanban-col${overStage === stage.key ? " drop-target" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage.key);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage.key ? null : s))}
              onDrop={() => drop(stage.key)}
            >
              <div className="kanban-col-head">
                <span className="kicker">{stage.label}</span>
                <span className="hint">{colCards.length}</span>
              </div>
              {colCards.map((card) => (
                <Link
                  key={card.id}
                  href={`/designs/${card.id}`}
                  className={`kanban-card${dragId === card.id ? " dragging" : ""}`}
                  draggable
                  onDragStart={() => setDragId(card.id)}
                  onDragEnd={() => setDragId(null)}
                >
                  <div className="art">
                    {card.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.artworkUrl} alt="" />
                    ) : (
                      <span className="hint">no artwork yet</span>
                    )}
                  </div>
                  <div className="body">
                    <div className={`title${card.gate === "Killed" ? " killed-title" : ""}`}>
                      {card.title}
                    </div>
                    <div className="meta">{card.meta}</div>
                    <div className="chips">
                      {card.hasBlocked ? <StatusChip kind="blocked">blocked</StatusChip> : null}
                      {card.hasStale ? <StatusChip kind="stale">stale</StatusChip> : null}
                      {card.gate === "Greenlit" ? <StatusChip kind="done">✓ greenlit</StatusChip> : null}
                      {card.gate === "Parked" ? <StatusChip kind="parked">❙❙ parked</StatusChip> : null}
                      {card.gate === "Killed" ? <StatusChip kind="killed">✕ killed</StatusChip> : null}
                      {card.listingCount > 0 ? (
                        <StatusChip kind="count">In {card.listingCount} listing{card.listingCount === 1 ? "" : "s"}</StatusChip>
                      ) : null}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
