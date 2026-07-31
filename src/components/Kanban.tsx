"use client";

/**
 * Designs Kanban — artwork-forward cards over creative stages. Dragging a
 * card BACK routes through the backtrack path (reason prompted, downstream
 * steps staled, logged) — the board never silently rewrites step state.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiJson } from "@/lib/api";
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
  // inline rename — the card is a Link, so every editing interaction has to
  // stop the navigation and the drag underneath it
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);

  async function saveName(id: string) {
    const name = nameDraft.trim();
    if (!name) return setEditingId(null);
    setRenaming(true);
    const res = await apiJson(`/api/designs/${id}`, "PATCH", { name });
    if (!res.ok) setError(res.error);
    else {
      setError(null);
      setEditingId(null);
      router.refresh();
    }
    setRenaming(false);
  }

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

    const res = await apiJson("/api/step", "POST", ({
        pageId: card.id,
        action: backward ? "back" : "move",
        step: toStep === "Done" ? "C9" : toStep,
        reason,
      }));
    if (toStep === "Done" && res.ok) {
      // moving to Done = marking the final step complete
      await apiJson("/api/step", "POST", { pageId: card.id, action: "done", step: "C9" });
    }
    if (!res.ok) setError(res.error);
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
                  draggable={editingId !== card.id}
                  onDragStart={() => setDragId(card.id)}
                  onDragEnd={() => setDragId(null)}
                  onClick={(e) => {
                    if (editingId === card.id) e.preventDefault();
                  }}
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
                    {editingId === card.id ? (
                      <input
                        className="input input-compact"
                        value={nameDraft}
                        autoFocus
                        disabled={renaming}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onClick={(e) => e.preventDefault()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveName(card.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onBlur={() => saveName(card.id)}
                      />
                    ) : (
                      <div className="row-gap-8" style={{ alignItems: "baseline" }}>
                        <div
                          className={`title${card.gate === "Killed" ? " killed-title" : ""}`}
                          style={{ flex: 1, minWidth: 0 }}
                        >
                          {card.title}
                        </div>
                        <button
                          aria-label={`Rename ${card.title}`}
                          title="Rename"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setNameDraft(card.title);
                            setEditingId(card.id);
                          }}
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            padding: 2,
                            color: "var(--text-secondary, #8a7a5c)",
                            flex: "0 0 auto",
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M11.1 2.4a1.6 1.6 0 0 1 2.3 2.3l-7.3 7.2-3 .8.8-3 7.2-7.3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    )}
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
