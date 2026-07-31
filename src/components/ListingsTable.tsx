"use client";

/**
 * Listings table — multi-select rows with the batch action bar. The schema
 * is batch-capable from day one; the UI keeps batch actions minimal in v1
 * (batch operations UI is explicitly deferred, spec §10).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiJson } from "@/lib/api";

export interface ListingRow {
  id: string;
  title: string;
  currentStep: string;
  etsyState: string;
  originType: string;
  productName: string;
  sectionName: string;
  price: number | null;
  costAtCreation: number | null;
  hasStale: boolean;
  hasBlocked: boolean;
  /** this listing carries its design's primary product */
  isPrimaryProduct: boolean;
}

export function ListingsTable({ rows }: { rows: ListingRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveName(id: string) {
    const name = nameDraft.trim();
    if (!name) return setEditingId(null);
    setRenaming(true);
    const res = await apiJson(`/api/listings/${id}`, "PATCH", { name });
    if (!res.ok) setError(res.error);
    else {
      setError(null);
      setEditingId(null);
      router.refresh();
    }
    setRenaming(false);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <>
      {error ? <div className="callout blocked">{error}</div> : null}
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>
              <span
                role="checkbox"
                aria-checked={allSelected}
                tabIndex={0}
                className={`checkbox${allSelected ? " checked" : ""}`}
                onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
              >
                {allSelected ? "✓" : ""}
              </span>
            </th>
            <th>Listing</th>
            <th>Step</th>
            <th>Etsy state</th>
            <th>Origin</th>
            <th>Product</th>
            <th>Section</th>
            <th>Price</th>
            <th>Cost @ creation</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSel = selected.has(row.id);
            return (
              <tr
                key={row.id}
                className={`row${isSel ? " selected" : ""}`}
                onClick={() => router.push(`/listings/${row.id}`)}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <span
                    role="checkbox"
                    aria-checked={isSel}
                    tabIndex={0}
                    className={`checkbox${isSel ? " checked" : ""}`}
                    onClick={() => toggle(row.id)}
                  >
                    {isSel ? "✓" : ""}
                  </span>
                </td>
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }} onClick={(e) => {
                  if (editingId === row.id) e.stopPropagation();
                }}>
                  {editingId === row.id ? (
                    <input
                      className="input input-compact"
                      value={nameDraft}
                      autoFocus
                      disabled={renaming}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveName(row.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => saveName(row.id)}
                    />
                  ) : (
                    <span className="row-gap-8" style={{ alignItems: "baseline" }}>
                      {row.title}
                      <button
                        aria-label={`Rename ${row.title}`}
                        title="Rename (the internal label — the Etsy title lives at L2)"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNameDraft(row.title);
                          setEditingId(row.id);
                        }}
                        style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2, color: "var(--text-secondary, #8a7a5c)" }}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M11.1 2.4a1.6 1.6 0 0 1 2.3 2.3l-7.3 7.2-3 .8.8-3 7.2-7.3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </span>
                  )}
                </td>
                <td>{row.currentStep}</td>
                <td>{row.etsyState}</td>
                <td>{row.originType}</td>
                <td>
                  <span className="row-gap-8" style={{ alignItems: "baseline" }}>
                    {row.productName}
                    {row.isPrimaryProduct ? <span className="chip done">primary</span> : null}
                  </span>
                </td>
                <td>{row.sectionName}</td>
                <td>{row.price != null ? `$${row.price.toFixed(2)}` : "—"}</td>
                <td>{row.costAtCreation != null ? `$${row.costAtCreation.toFixed(2)}` : "—"}</td>
                <td>
                  <span className="row-gap-8">
                    {row.hasBlocked ? <span className="chip blocked">blocked</span> : null}
                    {row.hasStale ? <span className="chip stale">stale</span> : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selected.size > 0 ? (
        <div className="batch-bar">
          <span className="count">
            {selected.size} selected
          </span>
          <button className="btn btn-secondary" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          {/* Batch operations UI is deferred (spec §10) — the bar and the
              selection model exist so adding actions later is additive. */}
          <span className="hint">Batch actions arrive with Phase 2</span>
        </div>
      ) : null}
    </>
  );
}
