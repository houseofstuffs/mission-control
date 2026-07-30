"use client";

/**
 * L2 SEO panel — attached keywords grouped by bucket, a tag composer capped
 * at Etsy's 13 tags, and manual keyword entry (the Phase 2 CSV importer
 * writes through the same API).
 *
 * Rules enforced here: tag-eligible (≤20 chars) keywords toggle in and out
 * of the tag list; longer ones are marked title-only and can never become
 * tags. The bucket mix is guidance, shown live but never enforced — the only
 * hard rule is the publish gate (no visibility keyword = blocked).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker } from "./ui";
import { CopyIconButton } from "./CopyIconButton";
import { apiJson } from "@/lib/api";
import { BUCKETS, TAG_COUNT, TARGET_MIX, type Bucket } from "@/config/keywords";

export interface KeywordRow {
  id: string;
  name: string;
  bucket: string;
  avgSearches: number | null;
  avgClicks: number | null;
  competition: number | null;
  tagEligible: boolean;
  stale: boolean;
}

export interface SeoData {
  listingId: string;
  attached: KeywordRow[];
  /** unattached keywords, for the attach picker */
  available: Array<{ id: string; name: string; bucket: string }>;
  tags: string;
}

const BUCKET_CHIP: Record<string, string> = {
  Visibility: "done",
  Reach: "count",
  "Best Seller": "neutral",
  Unknown: "neutral",
  Dead: "blocked",
};

function fmt(n: number | null): string {
  return n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

export function KeywordSeoPanel({ seo }: { seo: SeoData }) {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(
    seo.tags.split(",").map((t) => t.trim()).filter(Boolean)
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // quick add form
  const [kw, setKw] = useState("");
  const [searches, setSearches] = useState("");
  const [clicks, setClicks] = useState("");
  const [competition, setCompetition] = useState("");
  const [seasonality, setSeasonality] = useState("Unknown");
  const [source, setSource] = useState("Manual");

  const groups = BUCKETS.map((b: Bucket) => ({
    bucket: b,
    items: seo.attached.filter((k) => (k.bucket || "Unknown") === b),
  })).filter((g) => g.items.length > 0);

  // live mix: which selected tags correspond to attached keywords, by bucket
  const tagBucket = (tag: string): string | null =>
    seo.attached.find((k) => k.name.toLowerCase() === tag.toLowerCase())?.bucket ?? null;
  const mixCount = (bucket: string) => tags.filter((t) => tagBucket(t) === bucket).length;

  function toggleTag(k: KeywordRow) {
    if (!k.tagEligible) return; // Etsy hard cap — never a tag
    setDirty(true);
    setTags((cur) => {
      const has = cur.some((t) => t.toLowerCase() === k.name.toLowerCase());
      if (has) return cur.filter((t) => t.toLowerCase() !== k.name.toLowerCase());
      if (cur.length >= TAG_COUNT) return cur;
      return [...cur, k.name];
    });
  }

  async function call(label: string, url: string, method: string, body: unknown) {
    setBusy(label);
    setError(null);
    const res = await apiJson(url, method, body);
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(null);
    return res.ok;
  }

  async function saveTags() {
    const ok = await call("tags", `/api/listings/${seo.listingId}`, "PATCH", { tags: tags.join(", ") });
    if (ok) setDirty(false);
  }

  async function addKeyword() {
    if (!kw.trim()) return;
    const ok = await call("add", "/api/keywords", "POST", {
      keyword: kw.trim(),
      avgSearches: searches,
      avgClicks: clicks,
      etsyCompetition: competition,
      seasonality,
      source,
      listingId: seo.listingId,
    });
    if (ok) {
      setKw("");
      setSearches("");
      setClicks("");
      setCompetition("");
    }
  }

  return (
    <div className="card supporting">
      <Kicker>SEO — KEYWORDS &amp; TAGS</Kicker>

      {error ? <div className="callout blocked">{error}</div> : null}

      {/* tag composer */}
      <div className="well">
        <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <Kicker>TAGS · {tags.length}/{TAG_COUNT}</Kicker>
          <span className="hint">target {TARGET_MIX} — guidance, not a rule</span>
          <span className="hint" style={{ marginLeft: "auto" }}>
            now: {mixCount("Visibility")} vis · {mixCount("Reach")} reach · {mixCount("Best Seller")} best
          </span>
        </div>
        <div className="row-gap-8" style={{ flexWrap: "wrap", marginTop: 8 }}>
          {tags.length === 0 ? <span className="hint">No tags yet — toggle eligible keywords below.</span> : null}
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              className="chip done"
              style={{ cursor: "pointer", border: "none" }}
              title="Remove tag"
              onClick={() => {
                setDirty(true);
                setTags((cur) => cur.filter((x) => x !== t));
              }}
            >
              {t} ✕
            </button>
          ))}
          {tags.length > 0 ? <CopyIconButton text={tags.join(", ")} label="tags" /> : null}
        </div>
        <div className="row-gap-12" style={{ marginTop: 10 }}>
          <button className="btn btn-secondary" onClick={saveTags} disabled={busy !== null || !dirty}>
            {busy === "tags" ? <span className="spinner" /> : null}
            Save tags to listing
          </button>
          {dirty ? <span className="hint">Unsaved tag changes</span> : null}
        </div>
      </div>

      {/* attached keywords, grouped by bucket */}
      {seo.attached.length === 0 ? (
        <div className="hint">No keywords attached yet — add one below or attach an existing one.</div>
      ) : (
        groups.map((g) => (
          <div key={g.bucket} className="field">
            <span className="kicker">{g.bucket.toUpperCase()} · {g.items.length}</span>
            <div className="stack-12">
              {g.items.map((k) => {
                const inTags = tags.some((t) => t.toLowerCase() === k.name.toLowerCase());
                return (
                  <div key={k.id} className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
                    {k.tagEligible ? (
                      <button
                        type="button"
                        className={`btn ${inTags ? "btn-secondary" : "btn-tertiary"}`}
                        style={{ fontSize: 12, padding: "5px 11px" }}
                        onClick={() => toggleTag(k)}
                        disabled={busy !== null}
                        title={inTags ? "Remove from tags" : "Add to tags"}
                      >
                        {inTags ? "✓ " : ""}{k.name}
                      </button>
                    ) : (
                      <>
                        <span className="body-sm" style={{ fontWeight: 700 }}>{k.name}</span>
                        {/* over Etsy's 20-char tag cap — usable in the title only */}
                        <span className="chip neutral">title-only</span>
                      </>
                    )}
                    <span className="hint">
                      {fmt(k.avgSearches)} searches · {fmt(k.competition)} comp
                    </span>
                    {k.stale ? <span className="chip stale">stale numbers</span> : null}
                    <button
                      type="button"
                      className="btn btn-tertiary"
                      style={{ fontSize: 11, padding: "3px 8px" }}
                      disabled={busy !== null}
                      onClick={() =>
                        call("detach", `/api/keywords/${k.id}`, "PATCH", { detachListingId: seo.listingId })
                      }
                    >
                      detach
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* attach an existing keyword */}
      {seo.available.length > 0 ? (
        <div className="field">
          <label className="kicker" htmlFor="kw-attach">ATTACH AN EXISTING KEYWORD</label>
          <select
            id="kw-attach"
            className="select"
            style={{ maxWidth: 340 }}
            value=""
            disabled={busy !== null}
            onChange={(e) => {
              if (e.target.value) {
                call("attach", `/api/keywords/${e.target.value}`, "PATCH", { attachListingId: seo.listingId });
              }
            }}
          >
            <option value="" disabled>Keyword…</option>
            {seo.available.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} · {(k.bucket || "unknown").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* manual entry — the Phase 2 CSV importer writes through this same API */}
      <div className="field">
        <span className="kicker">ADD A KEYWORD (MANUAL — CSV IMPORT ARRIVES IN PHASE 2)</span>
        <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label className="kicker" htmlFor="kw-new">KEYWORD</label>
            <input id="kw-new" className="input" value={kw} onChange={(e) => setKw(e.target.value)} />
          </div>
          <div className="field" style={{ width: 110 }}>
            <label className="kicker" htmlFor="kw-s">AVG SEARCHES</label>
            <input id="kw-s" type="number" className="input" value={searches} onChange={(e) => setSearches(e.target.value)} />
          </div>
          <div className="field" style={{ width: 100 }}>
            <label className="kicker" htmlFor="kw-c">AVG CLICKS</label>
            <input id="kw-c" type="number" className="input" value={clicks} onChange={(e) => setClicks(e.target.value)} />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label className="kicker" htmlFor="kw-comp">COMPETITION</label>
            <input id="kw-comp" type="number" className="input" value={competition} onChange={(e) => setCompetition(e.target.value)} />
          </div>
          <div className="field">
            <label className="kicker" htmlFor="kw-season">SEASONALITY</label>
            <select id="kw-season" className="select" value={seasonality} onChange={(e) => setSeasonality(e.target.value)}>
              <option>Evergreen</option>
              <option>Seasonal</option>
              <option>Unknown</option>
            </select>
          </div>
          <div className="field">
            <label className="kicker" htmlFor="kw-src">SOURCE</label>
            <select id="kw-src" className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              <option>Manual</option>
              <option>eRank</option>
              <option>Everbee</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={addKeyword} disabled={busy !== null || !kw.trim()}>
            {busy === "add" ? <span className="spinner" /> : null}
            Add + attach
          </button>
        </div>
        <span className="hint">
          Bucket is computed from searches × competition. Leave numbers empty if you don&apos;t have
          them — the keyword lands in Unknown, never a guessed bucket.
        </span>
      </div>
    </div>
  );
}
