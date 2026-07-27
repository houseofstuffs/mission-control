"use client";

/**
 * "New design" / "New listing" — the two creation paths Phase 1 needs.
 * Designs start from greenlit niches only (ideas don't become designs until
 * greenlit); listings snapshot cost from their product at creation.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Option { id: string; name: string }

export function NewDesignButton({
  greenlitNiches,
  products,
}: {
  greenlitNiches: Option[];
  products: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nicheId, setNicheId] = useState("");
  const [productId, setProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/designs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        nicheId: nicheId || undefined,
        productId: productId || undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Create failed");
    else {
      setOpen(false);
      setName("");
      router.push(`/designs/${json.record.id}`);
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>New design</button>
      {open ? (
        <div className="modal-scrim" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-title">New design</div>
            <div className="field">
              <label className="kicker" htmlFor="nd-name">NAME</label>
              <input id="nd-name" className="input" value={name} autoFocus
                placeholder="e.g. Spooky bakery cat"
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label className="kicker" htmlFor="nd-niche">NICHE (GREENLIT ONLY)</label>
              <select id="nd-niche" className="select" value={nicheId} onChange={(e) => setNicheId(e.target.value)}>
                <option value="">No niche yet</option>
                {greenlitNiches.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              {greenlitNiches.length === 0 ? (
                <span className="hint">No greenlit niches in the cache — designs can start without one.</span>
              ) : null}
            </div>
            <div className="field">
              <label className="kicker" htmlFor="nd-product">PRIMARY PRODUCT</label>
              <select id="nd-product" className="select" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Decide at R6</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="hint">Primary product is a commercial choice; the master canvas comes from the whole line.</span>
            </div>
            {error ? <div className="field-error">{error}</div> : null}
            <div className="row-gap-12">
              <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={create}>
                {busy ? <span className="spinner" /> : null}
                Create design
              </button>
              <button className="btn btn-tertiary" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function NewListingButton({
  designs,
  products,
}: {
  designs: Option[];
  products: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [designId, setDesignId] = useState("");
  const [productId, setProductId] = useState("");
  const [originType, setOriginType] = useState("New concept");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        designIds: designId ? [designId] : [],
        productId: productId || undefined,
        originType,
      }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Create failed");
    else {
      setOpen(false);
      setName("");
      router.push(`/listings/${json.record.id}`);
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>New listing</button>
      {open ? (
        <div className="modal-scrim" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-title">New Etsy listing</div>
            <div className="field">
              <label className="kicker" htmlFor="nl-name">WORKING NAME</label>
              <input id="nl-name" className="input" value={name} autoFocus
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label className="kicker" htmlFor="nl-design">DESIGN</label>
              <select id="nl-design" className="select" value={designId} onChange={(e) => setDesignId(e.target.value)}>
                <option value="">Choose later (bundles add more)</option>
                {designs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="kicker" htmlFor="nl-product">PRODUCT</label>
              <select id="nl-product" className="select" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Not yet</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="hint">Choosing a product snapshots its base cost as cost-at-creation.</span>
            </div>
            <div className="field">
              <label className="kicker" htmlFor="nl-origin">ORIGIN TYPE</label>
              <select id="nl-origin" className="select" value={originType} onChange={(e) => setOriginType(e.target.value)}>
                <option>New concept</option>
                <option>Bundle</option>
                <option>Variant of winner</option>
                <option>Seasonal reissue</option>
              </select>
            </div>
            {error ? <div className="field-error">{error}</div> : null}
            <div className="row-gap-12">
              <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={create}>
                {busy ? <span className="spinner" /> : null}
                Create listing
              </button>
              <button className="btn btn-tertiary" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
