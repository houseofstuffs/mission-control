"use client";

/**
 * L7 — push to Etsy as a complete draft. One screen, three states:
 *
 *  A. Gates failing — the failing gates render HERE as the same
 *     click-to-fix / attest buttons the L6 panel uses (no bouncing back a
 *     step to learn why you're stuck), and the push is locked with the
 *     unlock condition named.
 *  B. All green — a FULL read-only preview of the exact bundle: gallery in
 *     slot order, title, price with the max-discount margin check inline,
 *     colourways, the complete description, all 13 tags. Nothing editable
 *     by design: every section names its owning step and links there. L7
 *     shows truth; edits happen at the source.
 *  C. Pushed — the record (timestamp, Etsy draft ID, snapshot), a re-push
 *     that warns instead of duplicating, and the Shop Manager finish
 *     checklist for what the app deliberately can't do.
 *
 * Division of labour (spec §2.2): Printify creates the listing and pushes
 * it to Etsy AS DRAFT, by hand, in Printify's UI. This screen applies the
 * copy bundle to that draft via the Etsy API — the app's one write.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker, Spinner, Tag } from "./ui";
import { apiJson } from "@/lib/api";
import { computeMargin, SALE_TIERS, offsiteAds } from "@/config/fees";

export interface PushData {
  listingId: string;
  etsyReady: boolean;
  etsyListingId: string;
  pushedAt: string | null;
  /** filled slots, in push order */
  gallery: Array<{ position: number; label: string; isGraphic: boolean }>;
  title: string;
  price: number | null;
  cost: number | null;
  shippingCharged: number | null;
  shippingCost: number | null;
  shippingConfirmed: boolean;
  colours: string[];
  coloursAllAvailable: boolean;
  hook: string;
  bodyCopy: string;
  tags: string[];
}

export interface PushGateView {
  label: string;
  ok: boolean;
  fixStep?: string;
  attest?: string;
}

const SHOP_MANAGER_URL = "https://www.etsy.com/your/shops/me/tools/listings";
/** straight to the DRAFT's editor — the listings index shows active
 *  listings, the one place a draft isn't */
const listingEditorUrl = (etsyListingId: string) =>
  /^\d+$/.test(etsyListingId)
    ? `https://www.etsy.com/your/shops/me/listing-editor/edit/${etsyListingId}`
    : SHOP_MANAGER_URL;

/** The ownership tag IS the edit control: "(L5 ✎)" in the header jumps
 *  to the owning step — no separate right-aligned button. */
function Owner({ label, step, onJump }: { label: string; step: string; onJump: (s: string) => void }) {
  return (
    <div className="kicker" style={{ fontSize: 11 }}>
      {label}{" "}
      <button type="button" className="owner-jump" title={`Edit at ${step}`} onClick={() => onJump(step)}>
        ({step} ✎)
      </button>
    </div>
  );
}

export function PushDraftPanel({
  data,
  gates,
  busyOutside,
  onJump,
  onAttest,
}: {
  data: PushData;
  gates: PushGateView[];
  /** the runner's busy state — attest runs through it */
  busyOutside: string | null;
  onJump: (step: string) => void;
  onAttest: (field: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idDraft, setIdDraft] = useState(data.etsyListingId);
  const [pushedNow, setPushedNow] = useState(false);
  // the deliberately-human finish list — local ticks, never persisted
  const [ticks, setTicks] = useState<Set<number>>(new Set());

  // ---- image push: slots → Etsy ranks, resumable, per-slot receipts ----
  interface ImgResult { slot: number; label: string; action: string; format?: string; kb?: number; rank?: number; ok: boolean }
  const [imgResults, setImgResults] = useState<ImgResult[] | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [otherIds, setOtherIds] = useState<number[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function pushImages() {
    setBusy("images");
    setImgError(null);
    setConfirmRemove(false);
    const res = await apiJson<{
      results?: ImgResult[]; uploaded?: number; skipped?: number; otherImageIds?: number[]; error?: string;
    }>(`/api/listings/${data.listingId}/push-images`, "POST", {}, 300_000);
    setImgResults(res.data.results ?? null);
    setOtherIds(res.data.otherImageIds ?? []);
    if (!res.ok || res.data.error) setImgError(res.error ?? res.data.error ?? null);
    else void verifyOnEtsy(); // fresh truth right after the write
    setBusy(null);
  }

  async function removeOthers() {
    setBusy("remove");
    const res = await apiJson<{ removed?: number }>(`/api/listings/${data.listingId}/push-images`, "POST", {
      removeImageIds: otherIds,
    });
    if (!res.ok) setImgError(res.error);
    else {
      setOtherIds([]);
      setConfirmRemove(false);
      void verifyOnEtsy();
    }
    setBusy(null);
  }

  // ---- verify on Etsy: read the draft back, compare against what we sent ----
  interface VerifyRow { label: string; ok: boolean; expected: string; actual: string }
  const [verify, setVerify] = useState<{ rows: VerifyRow[]; at: string; allOk: boolean } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const verifyRan = useRef(false);

  async function verifyOnEtsy() {
    setVerifyError(null);
    const res = await apiJson<{ ok?: boolean; rows?: VerifyRow[]; verifiedAt?: string }>(
      `/api/listings/${data.listingId}/verify-etsy`, "POST", {}, 60_000);
    if (!res.ok) setVerifyError(res.error);
    else setVerify({ rows: res.data.rows ?? [], at: res.data.verifiedAt ?? new Date().toISOString(), allOk: res.data.ok ?? false });
  }

  // automatic after every push (and on arriving at the pushed state) — the
  // read is one call and confirmation from Etsy is the whole point
  useEffect(() => {
    if ((data.pushedAt || pushedNow) && !verifyRan.current) {
      verifyRan.current = true;
      void verifyOnEtsy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.pushedAt, pushedNow]);

  const failing = gates.filter((g) => !g.ok);
  const anyBusy = busy !== null || busyOutside !== null;

  async function saveListingId() {
    setBusy("id");
    setError(null);
    const res = await apiJson(`/api/listings/${data.listingId}`, "PATCH", { etsyListingId: idDraft });
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(null);
  }

  async function push(confirmRepush: boolean) {
    if (confirmRepush) {
      const when = data.pushedAt ? new Date(data.pushedAt).toLocaleString() : "earlier";
      if (!window.confirm(`Already pushed ${when}. Re-push overwrites the draft's title, tags and description on Etsy. Continue?`)) {
        return;
      }
    }
    setBusy("push");
    setError(null);
    const res = await apiJson(`/api/listings/${data.listingId}/push`, "POST", { confirmRepush }, 60_000);
    if (!res.ok) setError(res.error);
    else {
      setPushedNow(true);
      router.refresh();
    }
    setBusy(null);
  }

  /* ---------- state A: gates failing ---------- */
  if (failing.length > 0 && !data.pushedAt) {
    return (
      <div className="card supporting">
        <Kicker>NOT READY TO PUSH</Kicker>
        <div className="callout blocked">
          ⛔ <strong>{failing.length} gate{failing.length === 1 ? "" : "s"} failing.</strong> Push
          unlocks when all {gates.length} are green — fix them from here, no need to visit L6.
        </div>
        <div className="stack-12" style={{ gap: 6 }}>
          {failing.map((g) =>
            g.attest ? (
              <div key={g.label} className="gate-item" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 140px" }}>✕ {g.label}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: "3px 10px" }}
                  disabled={anyBusy}
                  onClick={() => onAttest(g.attest!)}
                >
                  Confirm — screened outside
                </button>
              </div>
            ) : g.fixStep ? (
              <button key={g.label} type="button" className="gate-item gate-jump" onClick={() => onJump(g.fixStep!)}>
                <span style={{ flex: 1, textAlign: "left" }}>✕ {g.label}</span>
                <span className="gate-fix">Fix → {g.fixStep}</span>
              </button>
            ) : (
              <div key={g.label} className="gate-item">✕ {g.label}</div>
            )
          )}
        </div>
        <div className="row-gap-12" style={{ alignItems: "center" }}>
          <button className="btn btn-primary" disabled>Push draft to Etsy</button>
          <span className="hint">Unlocks at {gates.length} / {gates.length} gates</span>
        </div>
        {error ? <div className="callout blocked">{error}</div> : null}
      </div>
    );
  }

  /* ---------- state C: pushed ---------- */
  if (data.pushedAt || pushedNow) {
    const finishItems = [
      "Confirm images imported in slot order (Etsy occasionally reorders)",
      "Set the attributes recorded at L2 (Etsy models them per-category — the app doesn't push them)",
      "Attach video if you have one (not pushed by the app)",
      "Final eyes on price + shipping as rendered by Etsy",
      "Press Publish when ready — that moment is yours, not the app's",
    ];
    return (
      <div className="card supporting">
        <Kicker>DRAFT IS ON ETSY ✓</Kicker>
        <div className="callout">
          ✓ <strong>Pushed as draft</strong> — record kept on this listing, so re-pushing warns
          instead of duplicating.
        </div>
        <span className="body-sm">
          <strong>What the push writes:</strong> title, description and tags — the copy bundle.
          <strong> Images push separately below</strong>, slot order = Etsy order (slot 1 is the
          thumbnail). Printify&apos;s own mockups sit alongside until you remove them. Price,
          attributes and video stay Shop Manager&apos;s.
        </span>

        {/* ---- the image push: slots → ranks, resumable ---- */}
        <div className="well stack-12" style={{ gap: 8 }}>
          <Kicker>SLOT IMAGES → ETSY</Kicker>
          <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={anyBusy} onClick={pushImages}>
              <Spinner active={busy === "images"} />
              Push {data.gallery.length} slot image{data.gallery.length === 1 ? "" : "s"} to the draft
            </button>
            <span className="hint">
              Uploads in slot order; unchanged slots are skipped, changed ones replaced. A failed run
              resumes where it stopped.
            </span>
          </div>
          {imgResults ? (
            <div className="stack-12" style={{ gap: 2 }}>
              {imgResults.map((r) => (
                <span key={`${r.slot}-${r.label}`} className="hint" style={{ color: r.ok ? undefined : "var(--status-blocked, #b3423a)" }}>
                  {r.ok ? "✓" : "✕"} slot {r.slot} ({r.label}) — {r.action}
                  {r.format ? ` · ${r.format} · ${r.kb} KB · rank ${r.rank}` : ""}
                </span>
              ))}
            </div>
          ) : null}
          {imgError ? <div className="callout blocked">{imgError}</div> : null}
          {otherIds.length > 0 ? (
            <div className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <span className="hint" style={{ color: "var(--status-stale, #b8792a)" }}>
                {otherIds.length} image{otherIds.length === 1 ? "" : "s"} on the draft {otherIds.length === 1 ? "isn't" : "aren't"} from your slots (Printify&apos;s mockups).
              </span>
              {confirmRemove ? (
                <>
                  <button className="btn btn-primary" style={{ fontSize: 11, padding: "3px 10px" }} disabled={anyBusy} onClick={removeOthers}>
                    <Spinner active={busy === "remove"} />
                    Really remove {otherIds.length} — can&apos;t be undone
                  </button>
                  <button className="btn btn-tertiary" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setConfirmRemove(false)}>
                    Keep them
                  </button>
                </>
              ) : (
                <button className="btn btn-tertiary" style={{ fontSize: 11, padding: "3px 10px" }} disabled={anyBusy} onClick={() => setConfirmRemove(true)}>
                  Remove them…
                </button>
              )}
            </div>
          ) : null}
        </div>

        {/* ---- verified on Etsy: what's ACTUALLY on the draft ---- */}
        <div className="well stack-12" style={{ gap: 8 }}>
          <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
            <Kicker>VERIFIED ON ETSY</Kicker>
            <span className="row-gap-8" style={{ alignItems: "center" }}>
              {verify ? (
                <span className="hint">last verified {new Date(verify.at).toLocaleTimeString()}</span>
              ) : null}
              <button className="btn btn-tertiary" style={{ fontSize: 11, padding: "3px 10px" }} disabled={anyBusy} onClick={() => void verifyOnEtsy()}>
                Verify on Etsy
              </button>
            </span>
          </div>
          {verifyError ? <div className="callout blocked">{verifyError}</div> : null}
          {verify ? (
            <div className="stack-12" style={{ gap: 4 }}>
              {verify.rows.map((r) => (
                <span key={r.label} className="body-sm" style={{ color: r.ok ? "var(--status-done, #3e7a4e)" : "var(--status-blocked, #b3423a)" }}>
                  {r.ok ? "✓" : "✕"} <strong>{r.label}</strong>
                  {r.ok ? ` — matches (${r.actual})` : ` — sent: ${r.expected} · Etsy has: ${r.actual}`}
                </span>
              ))}
            </div>
          ) : !verifyError ? (
            <span className="hint"><Spinner active /> reading the draft back from Etsy…</span>
          ) : null}
        </div>
        <span className="body-sm">
          Pushed <strong>{data.pushedAt ? new Date(data.pushedAt).toLocaleString() : "just now"}</strong>
          {data.etsyListingId ? <> · Etsy draft ID <strong>#{data.etsyListingId}</strong></> : null} · bundle
          snapshot saved
        </span>
        <div className="well stack-12" style={{ gap: 6 }}>
          <Kicker>FINISH IN ETSY SHOP MANAGER — THE APP CAN&apos;T DO THESE</Kicker>
          {finishItems.map((item, i) => (
            <label key={item} className="row-gap-8" style={{ alignItems: "flex-start", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={ticks.has(i)}
                onChange={(e) =>
                  setTicks((cur) => {
                    const next = new Set(cur);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    return next;
                  })
                }
              />
              <span className="body-sm">{item}</span>
            </label>
          ))}
        </div>
        <div className="row-gap-12" style={{ flexWrap: "wrap" }}>
          <a className="btn btn-secondary" href={listingEditorUrl(data.etsyListingId)} target="_blank" rel="noreferrer">
            {/^\d+$/.test(data.etsyListingId) ? "Open this draft in Etsy ↗" : "Open in Etsy Shop Manager ↗"}
          </a>
          <button className="btn btn-tertiary" disabled={anyBusy} onClick={() => push(true)}>
            <Spinner active={busy === "push"} />
            Re-push copy bundle
          </button>
          <span className="hint">Mark step done above when Shop Manager is finished — listing complete 🎉</span>
        </div>
        {error ? <div className="callout blocked">{error}</div> : null}
      </div>
    );
  }

  /* ---------- state B: ready — full read-only preview ---------- */
  const titleWords = data.title.trim() ? data.title.trim().split(/\s+/).length : 0;
  const maxTier = SALE_TIERS[SALE_TIERS.length - 1];
  const margin = computeMargin(data.price, data.cost, {
    discountPct: maxTier,
    shippingCharged: data.shippingCharged ?? 0,
    shippingCost: data.shippingCost ?? 0,
    adMode: "percent",
    adValue: offsiteAds.pct,
  });
  const idSet = /^\d+$/.test(data.etsyListingId);

  return (
    <div className="card supporting">
      <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
        <Kicker>LISTING PREVIEW — EXACTLY WHAT GETS PUSHED</Kicker>
      </div>
      <span className="hint">
        The complete listing, read-only. Every section names its owning step; jump there to change
        it, come back, the preview refreshes. This is the last check before Etsy reads it.
      </span>

      <div className="well stack-12" style={{ gap: 8 }}>
        <Owner label={`IMAGES · ${data.gallery.length} SLOTS FILLED, PUSHED IN THIS ORDER`} step="L5" onJump={onJump} />
        <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
          {data.gallery.map((s, i) => (
            <Tag key={s.position} gold={s.isGraphic} title={s.label}>
              {i === 0 ? "★ " : ""}
              {s.position} · {s.label}
              {i === 0 ? " · THUMBNAIL" : ""}
            </Tag>
          ))}
          {data.gallery.length === 0 ? <span className="hint">no filled slots</span> : null}
        </div>
        <span className="hint">gold = graphic cards · images themselves travel via Printify, order is set in Shop Manager</span>
      </div>

      <div className="well stack-12" style={{ gap: 6 }}>
        <Owner label="TITLE" step="L2" onJump={onJump} />
        <span className="body-sm" style={{ fontWeight: 700, fontSize: 15 }}>{data.title || "(no title)"}</span>
        <span className="hint">{titleWords} words · under the 15-word gate</span>
      </div>

      <div className="well stack-12" style={{ gap: 6 }}>
        <Owner label="PRICE & SHIPPING" step="L3" onJump={onJump} />
        <span className="body-sm" style={{ fontWeight: 700, fontSize: 17 }}>
          {data.price != null ? `$${data.price.toFixed(2)}` : "(no price)"}{" "}
          {margin ? (
            <span className="hint" style={{ fontWeight: 600 }}>
              · at max discount ({maxTier}% → ${margin.salePrice.toFixed(2)}) net is{" "}
              <span style={{ color: margin.net >= 0 ? "var(--status-done, #3e7a4e)" : "var(--status-blocked, #b3423a)" }}>
                {margin.net < 0 ? "−" : ""}${Math.abs(margin.net).toFixed(2)}
              </span>{" "}
              · shipping {data.shippingConfirmed ? "confirmed" : "not confirmed"} · cost snapshot recorded
            </span>
          ) : null}
        </span>
      </div>

      <div className="well stack-12" style={{ gap: 6 }}>
        <Owner label="COLOURWAYS" step="L1" onJump={onJump} />
        <div className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
          {data.colours.map((c) => (
            <span key={c} className="chip neutral" style={{ fontSize: 12, fontWeight: 700 }}>{c}</span>
          ))}
          <span className="hint">
            {data.coloursAllAvailable ? "matches Printify variants" : "⚠ some colourways have no available Printify variant"}
          </span>
        </div>
      </div>

      <div className="well stack-12" style={{ gap: 6 }}>
        <Owner label="DESCRIPTION — COMPLETE, NOTHING TRUNCATED" step="L2" onJump={onJump} />
        <div className="body-sm" style={{ whiteSpace: "pre-wrap" }}>
          {[data.hook, data.bodyCopy].filter(Boolean).join("\n\n") || "(no description)"}
        </div>
      </div>

      <div className="well stack-12" style={{ gap: 6 }}>
        <Owner label={`TAGS · ${data.tags.length}/13`} step="L2" onJump={onJump} />
        <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
          {data.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      </div>

      <div className="callout">
        <strong>Draft means draft:</strong> the copy lands on the unpublished draft Printify
        created. Nothing goes live until you press Publish inside Etsy Shop Manager.
      </div>

      {!idSet ? (
        <div className="well stack-12" style={{ gap: 6 }}>
          <Kicker>ETSY DRAFT — FROM PRINTIFY</Kicker>
          <span className="hint">
            Publish the product in Printify (set to draft) first, then paste the Etsy draft&apos;s
            listing ID or URL — that&apos;s the draft this bundle lands on.
          </span>
          <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
            <input
              className="input input-compact"
              style={{ flex: "1 1 220px" }}
              placeholder="e.g. 4300012187 or the listing URL"
              value={idDraft}
              onChange={(e) => setIdDraft(e.target.value)}
            />
            <button className="btn btn-secondary" disabled={anyBusy || !idDraft.trim()} onClick={saveListingId}>
              <Spinner active={busy === "id"} />
              Save listing ID
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="callout blocked">{error}</div> : null}
      <div className="row-gap-12" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="btn btn-primary"
          disabled={anyBusy || !idSet || !data.etsyReady}
          title={
            !data.etsyReady
              ? "Connect Etsy on the Today page first"
              : !idSet
                ? "Paste the Etsy draft's listing ID above first"
                : undefined
          }
          onClick={() => push(false)}
        >
          <Spinner active={busy === "push"} />
          Push draft to Etsy
        </button>
        {!data.etsyReady ? <span className="hint">Etsy isn&apos;t connected — Today page.</span> : null}
        {data.etsyReady && !idSet ? <span className="hint">Waiting on the Etsy draft ID from Printify.</span> : null}
      </div>
    </div>
  );
}
