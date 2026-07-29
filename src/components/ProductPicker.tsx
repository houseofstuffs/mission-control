"use client";

/**
 * Primary product, assignable from the runner — no trip to Notion. Setting
 * it also refreshes the master canvas from the product's print areas, which
 * is the generation constraint C2 works inside. Unset = Candy attention.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProductPicker({
  designId,
  products,
  currentId,
}: {
  designId: string;
  products: Array<{ id: string; name: string }>;
  currentId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
      <span className="kicker">PRIMARY PRODUCT</span>
      <select
        className="select input-compact"
        style={{
          width: 260,
          ...(currentId ? {} : { borderColor: "var(--status-blocked, #d7242a)", color: "var(--text-muted, #8a7a5c)" }),
        }}
        value={currentId ?? ""}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError(null);
          const res = await fetch(`/api/designs/${designId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId: e.target.value || null }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) setError((json as { error?: string }).error ?? "Update failed");
          else router.refresh();
          setBusy(false);
        }}
      >
        <option value="">Primary product</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
