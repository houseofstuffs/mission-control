"use client";

/**
 * L5 — the image-slot plan. Up to MAX_IMAGES ordered slots; position 1 is
 * the search thumbnail and does most of the click-through work. Bucket is
 * the slot's JOB, shot type is HOW it renders — orthogonal axes, and the
 * coverage hint shows both so "twelve flat lays and nothing on a model" is
 * visible at a glance. Advisory throughout; only the publish gates block.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";
import {
  BUCKETS,
  SHOT_TYPES,
  SLOT_STATUSES,
  MAX_IMAGES,
  MIN_RECOMMENDED_IMAGES,
} from "@/config/images";

export interface SlotRow {
  id: string;
  position: number;
  label: string;
  bucket: string;
  shotType: string;
  status: string;
  assetRef: string;
  templateId: string | null;
}

export interface SlotsData {
  listingId: string;
  isMultiVariant: boolean;
  slots: SlotRow[];
  templates: Array<{ id: string; name: string; shotType: string }>;
}

export function ImageSlotsPanel({ data }: { data: SlotsData }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(label: string, url: string, method: string, body?: unknown) {
    setBusy(label);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setError((json as { error?: string }).error ?? "Request failed");
    else router.refresh();
    setBusy(null);
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    call(id, `/api/image-slots/${id}`, "PATCH", body);

  const filled = data.slots.filter((s) => s.status === "Made" || s.status === "Placed");

  // coverage on both axes — filled/planned per bucket, spread per shot type
  const bucketLine = BUCKETS.map(
    (b) =>
      `${b.replace("Sell ", "").toLowerCase()} ${
        filled.filter((s) => s.bucket === b).length
      }/${data.slots.filter((s) => s.bucket === b).length}`
  ).join(" · ");
  const shotCounts = new Map<string, number>();
  for (const s of data.slots) {
    if (s.shotType) shotCounts.set(s.shotType, (shotCounts.get(s.shotType) ?? 0) + 1);
  }
  const shotLine = [...shotCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${n}× ${t.toLowerCase()}`)
    .join(" · ");

  return (
    <div className="card supporting">
      <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <Kicker>IMAGE SLOTS · {filled.length} FILLED / {data.slots.length} PLANNED (CAP {MAX_IMAGES})</Kicker>
        <label className="row-gap-8" style={{ alignItems: "center", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={data.isMultiVariant}
            disabled={busy !== null}
            onChange={(e) =>
              call("multi", `/api/listings/${data.listingId}`, "PATCH", { isMultiVariant: e.target.checked })
            }
          />
          <span className="body-sm">Multi-variant listing</span>
        </label>
      </div>

      {error ? <div className="callout blocked">{error}</div> : null}

      {data.isMultiVariant ? (
        <div className="hint">
          Multi-variant rule: show the SYSTEM plus 2-3 examples — never spend slots on repeated
          name variations. The hero sells the concept, not one name.
        </div>
      ) : null}

      {data.slots.length === 0 ? (
        <div className="stack-12">
          <div className="body-sm muted">
            No slot plan yet. Seeding lays out the default allocation for a
            {data.isMultiVariant ? " multi-variant" : " single-variant"} listing — every slot stays
            editable, and slots 18-20 stay empty as buffer.
          </div>
          <div className="row-gap-12">
            <button
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() => call("seed", "/api/image-slots", "POST", { listingId: data.listingId, seed: true })}
            >
              {busy === "seed" ? <span className="spinner" /> : null}
              Seed the slot plan
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* coverage hint — advisory, both axes */}
          <div className="well">
            <Kicker>COVERAGE</Kicker>
            <div className="body-sm" style={{ marginTop: 6 }}>{bucketLine}</div>
            {shotLine ? <div className="hint" style={{ marginTop: 4 }}>{shotLine}</div> : null}
            {filled.length < MIN_RECOMMENDED_IMAGES ? (
              <div className="hint" style={{ marginTop: 4 }}>
                Aim for at least {MIN_RECOMMENDED_IMAGES} filled — {MAX_IMAGES} is a ceiling, not a quota.
              </div>
            ) : null}
          </div>

          <div className="stack-12">
            {data.slots.map((s, i) => (
              <div
                key={s.id}
                className="row-gap-8"
                style={{ flexWrap: "wrap", alignItems: "center", paddingBottom: 8, borderBottom: "1px solid #f0e8cf" }}
              >
                <span className="kicker" style={{ width: 26 }}>{s.position}</span>
                <input
                  className="input input-compact"
                  style={{ flex: "1 1 150px" }}
                  defaultValue={s.label}
                  onBlur={(e) => {
                    if (e.target.value !== s.label) patch(s.id, { label: e.target.value });
                  }}
                />
                <select
                  className="select input-compact"
                  style={{ width: 130 }}
                  value={s.bucket}
                  disabled={busy !== null}
                  onChange={(e) => patch(s.id, { bucket: e.target.value })}
                >
                  {BUCKETS.map((b) => <option key={b}>{b}</option>)}
                </select>
                <select
                  className="select input-compact"
                  style={{ width: 150 }}
                  value={s.shotType}
                  disabled={busy !== null}
                  onChange={(e) => patch(s.id, { shotType: e.target.value })}
                >
                  <option value="">Shot type…</option>
                  {SHOT_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <select
                  className="select input-compact"
                  style={{ width: 150 }}
                  value={s.templateId ?? ""}
                  disabled={busy !== null}
                  onChange={(e) => patch(s.id, { mockupTemplateId: e.target.value || null })}
                >
                  <option value="">Template…</option>
                  {data.templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <select
                  className="select input-compact"
                  style={{ width: 105 }}
                  value={s.status}
                  disabled={busy !== null}
                  onChange={(e) => patch(s.id, { status: e.target.value })}
                >
                  {SLOT_STATUSES.map((st) => <option key={st}>{st}</option>)}
                </select>
                <input
                  className="input input-compact"
                  style={{ flex: "1 1 130px" }}
                  placeholder="asset link…"
                  defaultValue={s.assetRef}
                  onBlur={(e) => {
                    if (e.target.value !== s.assetRef) patch(s.id, { assetRef: e.target.value });
                  }}
                />
                <span className="row-gap-8">
                  <button className="btn btn-tertiary" style={{ fontSize: 11, padding: "3px 7px" }} disabled={busy !== null || i === 0}
                    onClick={() => patch(s.id, { move: "up" })}>↑</button>
                  <button className="btn btn-tertiary" style={{ fontSize: 11, padding: "3px 7px" }} disabled={busy !== null || i === data.slots.length - 1}
                    onClick={() => patch(s.id, { move: "down" })}>↓</button>
                  <button
                    className="btn btn-tertiary"
                    style={{ fontSize: 11, padding: "3px 7px" }}
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm(`Delete slot ${s.position} (${s.label})?`)) {
                        call(s.id, `/api/image-slots/${s.id}`, "DELETE");
                      }
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>

          {data.slots.length < MAX_IMAGES ? (
            <div className="row-gap-12">
              <button
                className="btn btn-tertiary"
                disabled={busy !== null}
                onClick={() => call("add", "/api/image-slots", "POST", { listingId: data.listingId })}
              >
                + Add a slot
              </button>
              <span className="hint">{MAX_IMAGES - data.slots.length} of the cap unplanned (buffer is fine)</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
