"use client";

/**
 * L2 SEO panel — the listing-writing workbench.
 *
 * Four ways keywords arrive, one selection they land in:
 *   1. inherited from the Design (attached during the C-series — shown
 *      pre-populated, toggle to attach, never retyped)
 *   2. eRank/Everbee CSV import (same bucket computation, conflicts
 *      surfaced for review, never silently overwritten)
 *   3. AI tag suggestions (drafts — accepted/rejected per chip)
 *   4. manual one-off entry (the original path, still here)
 *
 * The bucket tally and the 13-tag counter read the ONE selection state, so
 * they update live no matter which door a tag came through. AI output is
 * always a draft: title, hook, tags and attributes render editable and
 * nothing persists until its own explicit save.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Kicker, Spinner } from "./ui";
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
  /** market momentum from listing-research imports — beside the bucket, never in it */
  momentum: string | null;
  momentumTitle: string | null;
}

export interface SeoData {
  listingId: string;
  attached: KeywordRow[];
  /** keywords related to this listing's Design but not attached here yet */
  inherited: KeywordRow[];
  /** unattached keywords, for the attach picker */
  available: Array<{ id: string; name: string; bucket: string }>;
  tags: string;
  /** lowercased keyword name → bucket, across the whole bank — the tally's lookup */
  bankBuckets: Record<string, string>;
  /** saved copy fields, editable here */
  title: string;
  hook: string;
  /** the saved Body Copy text — previewable in place, stitched under the hook */
  bodyCopy: string;
  attributes: Array<{ name: string; value: string }>;
  /** the product whose boilerplate gets stitched under the hook */
  product: { id: string; name: string; hasVoice: boolean; voiceText: string } | null;
  hasDesign: boolean;
  aiReady: boolean;
}

const BUCKET_CHIP: Record<string, string> = {
  Visibility: "done",
  Reach: "count",
  "Best Seller": "neutral",
  Unknown: "neutral",
  Dead: "blocked",
};

/** momentum chip styling — selling now reads good, legacy reads caution */
const MOMENTUM_CHIP: Record<string, string> = {
  "Selling now": "done",
  Steady: "count",
  Legacy: "stale",
};

/** per-bucket tag targets, the numeric side of TARGET_MIX (~6-7 · ~4-5 · ~1-2) */
const TAG_TARGETS: Record<string, number> = { Visibility: 7, Reach: 5, "Best Seller": 2 };

/** ranking inside a bucket: markets selling NOW first, then raw volume.
 *  No momentum data ranks between Steady and Legacy — unknown isn't bad. */
const MOMENTUM_RANK: Record<string, number> = { "Selling now": 0, Steady: 1, Legacy: 3 };
function keywordRank(a: KeywordRow, b: KeywordRow): number {
  const ma = MOMENTUM_RANK[a.momentum ?? ""] ?? 2;
  const mb = MOMENTUM_RANK[b.momentum ?? ""] ?? 2;
  if (ma !== mb) return ma - mb;
  return (b.avgSearches ?? -1) - (a.avgSearches ?? -1);
}

function fmt(n: number | null): string {
  return n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

/**
 * The live bucket tally — one selection in, three counts out. Reusable on
 * purpose: every flow that edits the tag selection shows the same counter.
 */
export function TagMixTally({
  tags,
  bucketOf,
}: {
  tags: string[];
  bucketOf: (tag: string) => string | null;
}) {
  const count = (bucket: string) => tags.filter((t) => bucketOf(t) === bucket).length;
  return (
    <span className="hint">
      now: {count("Visibility")} vis · {count("Reach")} reach · {count("Best Seller")} best
    </span>
  );
}

interface ImportSummary {
  source: string;
  total: number;
  created: number;
  /** rows linked to the Design's recommendation pool (never auto-attached) */
  linked: number;
  unchanged: number;
  skipped: number;
  noDesign?: boolean;
}
interface ImportConflict {
  id: string;
  keyword: string;
  existing: { avgSearches: number | null; avgClicks: number | null; competition: number | null; bucket: string };
  incoming: { avgSearches: number | null; avgClicks: number | null; competition: number | null; bucket: string };
}
interface CopyDraft {
  title: string;
  tags: string[];
  hook: string;
  attributes: Array<{ name: string; value: string }>;
  notes: string;
}

export function KeywordSeoPanel({ seo }: { seo: SeoData }) {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(
    seo.tags.split(",").map((t) => t.trim()).filter(Boolean)
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // copy drafts — initialised from saved values so this doubles as the
  // editor; Generate overwrites the drafts, saves persist field by field
  const [title, setTitle] = useState(seo.title);
  const [hook, setHook] = useState(seo.hook);
  const [attrs, setAttrs] = useState<Array<{ name: string; value: string }>>(seo.attributes);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [draftNotes, setDraftNotes] = useState("");

  // CSV import
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [conflicts, setConflicts] = useState<ImportConflict[]>([]);
  // listing-research files waiting to be told which keyword they describe
  const [pendingMarkets, setPendingMarkets] = useState<
    Array<{ fileName: string; csv: string; source: string; listingCount: number }>
  >([]);

  const [showAllInherited, setShowAllInherited] = useState(false);
  const [showBody, setShowBody] = useState(false);
  // per-listing body edits — this listing's Body Copy only, the product's
  // boilerplate is never touched from here
  const [bodyDraft, setBodyDraft] = useState(seo.bodyCopy);
  const bodyCopySet = seo.bodyCopy.trim().length > 0;
  const bodyDirty = bodyDraft !== seo.bodyCopy;

  // ONE bucket lookup for the whole panel — attached, inherited, imported
  // and AI-suggested tags all resolve through the same bank map, so the
  // tally can never disagree with the chips.
  const bucketOf = (tag: string): string | null =>
    seo.bankBuckets[tag.trim().toLowerCase()] ?? null;

  const inTagList = (name: string) => tags.some((t) => t.toLowerCase() === name.toLowerCase());
  const mixCount = (bucket: string) => tags.filter((t) => bucketOf(t) === bucket).length;

  // The candidate pool: Design-inherited keywords AND attached-but-untagged
  // ones (imports land attached — this is their path into the tag list).
  const pool: Array<KeywordRow & { attached: boolean }> = [
    ...seo.inherited.map((k) => ({ ...k, attached: false })),
    ...seo.attached.filter((k) => !inTagList(k.name)).map((k) => ({ ...k, attached: true })),
  ];
  // The recommendation cut: only buckets worth tagging, ranked (momentum,
  // then volume), capped at the ROOM LEFT toward each bucket's target given
  // what's already in the tag list — so the shortlist shrinks live as picks
  // land. Dead/unmeasured never recommend; "show all" still has everything.
  const recommendedInherited: Array<KeywordRow & { attached: boolean }> = [];
  for (const bucket of ["Visibility", "Reach", "Best Seller"]) {
    const room = Math.max(0, (TAG_TARGETS[bucket] ?? 0) - mixCount(bucket));
    if (room === 0) continue;
    recommendedInherited.push(
      ...pool.filter((k) => k.bucket === bucket && k.tagEligible).sort(keywordRank).slice(0, room)
    );
  }
  const inheritedShown = showAllInherited
    ? BUCKETS.flatMap((b) => pool.filter((k) => (k.bucket || "Unknown") === b).sort(keywordRank))
    : recommendedInherited;

  // No hard stop at 13 — over-filling while sifting is normal; the counter
  // warns and the publish gate still requires exactly 13 at L6.
  function addTag(name: string) {
    if (inTagList(name)) return;
    setDirty(true);
    setTags((cur) => [...cur, name]);
  }
  function removeTag(name: string) {
    setDirty(true);
    setTags((cur) => cur.filter((t) => t.toLowerCase() !== name.toLowerCase()));
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

  /** pick a candidate: attach the relation if it isn't yet, into the tag list if eligible */
  async function pickKeyword(k: KeywordRow & { attached: boolean }) {
    if (!k.attached) {
      const ok = await call("attach", `/api/keywords/${k.id}`, "PATCH", { attachListingId: seo.listingId });
      if (!ok) return;
    }
    if (k.tagEligible) addTag(k.name);
  }

  /** several files at once is normal — 3 searches × 2 platforms = 6 CSVs.
   *  Processed sequentially through one endpoint; keyword files accumulate
   *  into one summary, listing-research files queue up to be assigned a
   *  keyword. Order matters across platforms: the first file to bring a
   *  keyword sets its numbers, later disagreements surface as conflicts. */
  async function importFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy("import");
    setError(null);
    setImportSummary(null);
    const totals: ImportSummary = { source: "", total: 0, created: 0, linked: 0, unchanged: 0, skipped: 0 };
    const newConflicts: ImportConflict[] = [];
    const sources = new Set<string>();
    const failures: string[] = [];
    let sawKeywordFile = false;
    for (const file of files) {
      const text = await file.text();
      const res = await apiJson<{
        kind: string;
        needsKeyword?: boolean;
        source: string;
        listingCount?: number;
        total?: number;
        created?: number;
        linked?: number;
        unchanged?: number;
        skipped?: number;
        conflicts?: ImportConflict[];
        noDesign?: boolean;
      }>("/api/keywords/import", "POST", { csv: text, listingId: seo.listingId });
      if (!res.ok) {
        failures.push(`${file.name}: ${res.error}`);
        continue;
      }
      if (res.data.kind === "listing") {
        setPendingMarkets((cur) => [
          ...cur,
          { fileName: file.name, csv: text, source: res.data.source, listingCount: res.data.listingCount ?? 0 },
        ]);
        continue;
      }
      sawKeywordFile = true;
      sources.add(res.data.source);
      totals.total += res.data.total ?? 0;
      totals.created += res.data.created ?? 0;
      totals.linked += res.data.linked ?? 0;
      totals.unchanged += res.data.unchanged ?? 0;
      totals.skipped += res.data.skipped ?? 0;
      if (res.data.noDesign) totals.noDesign = true;
      // dedupe by keyword id — the same disagreement from two files is one review
      for (const c of res.data.conflicts ?? []) {
        if (!newConflicts.some((x) => x.id === c.id)) newConflicts.push(c);
      }
    }
    if (sawKeywordFile) {
      totals.source = [...sources].join(" + ");
      setImportSummary(totals);
      setConflicts((cur) => {
        const merged = [...cur];
        for (const c of newConflicts) if (!merged.some((x) => x.id === c.id)) merged.push(c);
        return merged;
      });
    }
    if (failures.length > 0) setError(failures.join("\n"));
    router.refresh();
    setBusy(null);
  }

  /** a listing-research file, assigned: compute + store momentum on that keyword */
  async function assignMarket(
    pending: { fileName: string; csv: string },
    keywordId: string
  ) {
    setBusy("market");
    setError(null);
    const res = await apiJson<{ keyword: string; momentum: string; listingCount: number }>(
      "/api/keywords/import",
      "POST",
      { csv: pending.csv, keywordId, listingId: seo.listingId }
    );
    if (!res.ok) setError(res.error);
    else {
      setPendingMarkets((cur) => cur.filter((p) => p !== pending));
      setNotice(
        `Momentum for "${res.data.keyword}": ${res.data.momentum.toLowerCase()} — from ${res.data.listingCount} listings.`
      );
      router.refresh();
    }
    setBusy(null);
  }

  /** conflict resolution — "use imported" writes through the normal keyword PATCH */
  async function resolveConflict(c: ImportConflict, useImported: boolean) {
    if (useImported) {
      const ok = await call("conflict", `/api/keywords/${c.id}`, "PATCH", {
        avgSearches: c.incoming.avgSearches,
        avgClicks: c.incoming.avgClicks,
        etsyCompetition: c.incoming.competition,
        pulledAt: new Date().toISOString().slice(0, 10),
      });
      if (!ok) return;
    }
    setConflicts((cur) => cur.filter((x) => x.id !== c.id));
  }

  async function generate() {
    setBusy("generate");
    setError(null);
    // the toggled selection drives generation: current tags, plus attached
    // title-only keywords (they can't be tags but should shape the title)
    const toggled = [
      ...tags,
      ...seo.attached.filter((k) => !k.tagEligible).map((k) => k.name),
    ];
    const res = await apiJson<{ draft: CopyDraft }>(
      `/api/listings/${seo.listingId}/generate-copy`,
      "POST",
      { keywords: [...new Set(toggled.map((t) => t.trim()))] }
    );
    if (!res.ok) setError(res.error);
    else {
      const d = res.data.draft;
      setTitle(d.title);
      setHook(d.hook);
      if (d.attributes.length > 0) setAttrs(d.attributes);
      setSuggestedTags(d.tags.filter((t) => !inTagList(t)));
      setDraftNotes(d.notes);
      setNotice("Draft ready — everything below is editable, nothing is saved yet.");
    }
    setBusy(null);
  }

  const titleWords = title.trim() ? title.trim().split(/\s+/).length : 0;
  const pendingSuggestions = suggestedTags.filter((t) => !inTagList(t));

  return (
    <div className="card supporting">
      <Kicker>SEO — KEYWORDS &amp; TAGS</Kicker>

      {error ? <div className="callout blocked">{error}</div> : null}
      {notice ? <div className="hint">{notice}</div> : null}

      {/* tag composer — the one selection everything feeds */}
      <div className="well">
        <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <Kicker>TAGS · {tags.length}/{TAG_COUNT}</Kicker>
          {tags.length > TAG_COUNT ? (
            <span className="chip stale">
              {tags.length - TAG_COUNT} over the {TAG_COUNT}-tag limit — trim before publish
            </span>
          ) : null}
          <span className="hint">target {TARGET_MIX} — guidance, not a rule</span>
          <span style={{ marginLeft: "auto" }}>
            <TagMixTally tags={tags} bucketOf={bucketOf} />
          </span>
        </div>
        <div className="row-gap-8" style={{ flexWrap: "wrap", marginTop: 8 }}>
          {tags.length === 0 ? <span className="hint">No tags yet — toggle keywords below, import a CSV, or generate a draft.</span> : null}
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              className="chip done"
              style={{ cursor: "pointer", border: "none" }}
              title={`${bucketOf(t) ?? "not in keyword bank"} — remove tag`}
              onClick={() => removeTag(t)}
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

      {/* inherited from the Design — keyword work already done upstream,
          pre-populated here instead of retyped */}
      {pool.length > 0 ? (
        <div className="field">
          <span className="kicker">
            {showAllInherited
              ? `KEYWORD CANDIDATES — ALL · ${pool.length}`
              : `RECOMMENDED TAGS · ${recommendedInherited.length}`}
          </span>
          <span className="hint">
            {showAllInherited
              ? "Everything from this Design and your imports, best first — dead and unmeasured included down here."
              : "Best picks toward the target mix from this Design and your imports — ranked by momentum, then volume. The shortlist shrinks as your tag list fills. Tap to add."}
          </span>
          {!showAllInherited && recommendedInherited.length === 0 ? (
            <span className="hint">Tag targets covered for every bucket — nothing more to recommend.</span>
          ) : null}
          {/* two columns — the candidate names are short enough to pair up */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, justifyItems: "start" }}>
            {inheritedShown.map((k) => (
              <button
                key={k.id}
                type="button"
                className="chip neutral"
                style={{ cursor: "pointer", textAlign: "left" }}
                disabled={busy !== null}
                title={`${fmt(k.avgSearches)} searches · ${fmt(k.competition)} comp${k.momentum && k.momentum !== "Unknown" ? ` · ${k.momentum.toLowerCase()}` : ""}${k.tagEligible ? "" : " · over 20 chars, title-only"}`}
                onClick={() => pickKeyword(k)}
              >
                + {k.name} · {(k.bucket || "unknown").toLowerCase()}
                {k.momentum === "Selling now" ? " 🔥" : ""}
              </button>
            ))}
          </div>
          {pool.length > recommendedInherited.length ? (
            <button
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "4px 10px", alignSelf: "flex-start" }}
              onClick={() => setShowAllInherited((v) => !v)}
            >
              {showAllInherited ? "Show recommended only" : `Show all ${pool.length}`}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* CSV import — eRank/Everbee exports through the same bucket math */}
      <div className="field">
        <span className="kicker">IMPORT FROM ERANK / EVERBEE</span>
        <div
          className="well"
          style={{
            textAlign: "center",
            cursor: "pointer",
            borderStyle: "dashed",
            borderWidth: 1,
            borderColor: dragOver ? "var(--status-done)" : "var(--border, #ddd6c2)",
          }}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            importFiles(Array.from(e.dataTransfer.files ?? []));
          }}
        >
          <span className="hint">
            {busy === "import"
              ? "Importing…"
              : "Drop CSV exports here — several at once is fine. Keyword files land in the bank (matched by text, never duplicated); listing-research files (Everbee Product Analytics / eRank listings) become a momentum read on the keyword you pick."}
          </span>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              importFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
        {/* listing-research files don't say which search they came from — ask */}
        {pendingMarkets.map((p) => (
          <div key={p.fileName + p.listingCount} className="well" style={{ marginTop: 8 }}>
            <div className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <span className="body-sm" style={{ fontWeight: 700 }}>{p.fileName}</span>
              <span className="chip count">{p.source} · {p.listingCount} listings</span>
            </div>
            <div className="field" style={{ marginTop: 8, maxWidth: 380 }}>
              <label className="kicker" htmlFor={`mk-${p.fileName}`}>WHICH KEYWORD WAS THIS SEARCH FOR?</label>
              <select
                id={`mk-${p.fileName}`}
                className="select"
                value=""
                disabled={busy !== null}
                onChange={(e) => e.target.value && assignMarket(p, e.target.value)}
              >
                <option value="" disabled>Keyword…</option>
                {[...seo.attached, ...seo.inherited].map((k) => (
                  <option key={k.id} value={k.id}>{k.name} · {(k.bucket || "unknown").toLowerCase()}</option>
                ))}
                {seo.available.map((k) => (
                  <option key={k.id} value={k.id}>{k.name} · {(k.bucket || "unknown").toLowerCase()}</option>
                ))}
              </select>
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 11, padding: "3px 8px", alignSelf: "flex-start" }}
                onClick={() => setPendingMarkets((cur) => cur.filter((x) => x !== p))}
              >
                Discard file
              </button>
            </div>
          </div>
        ))}
        {importSummary ? (
          <span className="hint">
            {importSummary.source} format · {importSummary.created} new · {importSummary.linked} linked to the design pool
            {importSummary.unchanged > 0 ? ` · ${importSummary.unchanged} already current` : ""}
            {importSummary.skipped > 0 ? ` · ${importSummary.skipped} blank rows skipped` : ""}
            {conflicts.length > 0 ? ` · ${conflicts.length} need review below` : ""}
            {importSummary.noDesign ? " · no Design on this listing — rows are in the bank only" : ""}
            {" — nothing auto-attaches; pick from the recommendations."}
          </span>
        ) : null}
        {conflicts.map((c) => (
          <div key={c.id} className="well" style={{ marginTop: 8 }}>
            <div className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <span className="body-sm" style={{ fontWeight: 700 }}>{c.keyword}</span>
              <span className="chip stale">numbers disagree</span>
            </div>
            <div className="body-sm" style={{ marginTop: 6 }}>
              on record: {fmt(c.existing.avgSearches)} searches · {fmt(c.existing.competition)} comp · {c.existing.bucket}
              <br />
              imported: {fmt(c.incoming.avgSearches)} searches · {fmt(c.incoming.competition)} comp · {c.incoming.bucket}
            </div>
            <div className="row-gap-8" style={{ marginTop: 8 }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: "5px 10px" }}
                disabled={busy !== null}
                onClick={() => resolveConflict(c, true)}
              >
                Use imported numbers
              </button>
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 12, padding: "5px 10px" }}
                disabled={busy !== null}
                onClick={() => resolveConflict(c, false)}
              >
                Keep existing
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* the copy workbench — title, hook, attributes. Generate fills the
          drafts; each save is its own deliberate action. */}
      <div className="well">
        <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <Kicker>LISTING COPY</Kicker>
          {seo.aiReady ? (
            <button
              className="btn btn-secondary"
              disabled={busy !== null || !seo.hasDesign}
              title={seo.hasDesign ? undefined : "Attach a Design first — the draft needs its phrase and niche."}
              onClick={generate}
            >
              <Spinner active={busy === "generate"} />
              Generate draft copy
            </button>
          ) : (
            <span className="hint">Set ANTHROPIC_API_KEY to generate drafts.</span>
          )}
          <span className="hint">Drafts only — nothing saves without its button.</span>
        </div>
        {draftNotes ? <div className="hint" style={{ marginTop: 6 }}>{draftNotes}</div> : null}

        <div className="field" style={{ marginTop: 10 }}>
          <label className="kicker" htmlFor="l2-title">TITLE · {titleWords}/15 WORDS</label>
          <input id="l2-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          {titleWords >= 15 ? <span className="hint" style={{ color: "var(--status-blocked, #b3423a)" }}>Over the 15-word gate — trim it.</span> : null}
          <div className="row-gap-12" style={{ marginTop: 6 }}>
            <button
              className="btn btn-secondary"
              disabled={busy !== null || !title.trim() || title === seo.title}
              onClick={() => call("title", `/api/listings/${seo.listingId}`, "PATCH", { title: title.trim() })}
            >
              {busy === "title" ? <span className="spinner" /> : null}
              Save title
            </button>
            {title !== seo.title ? <span className="hint">Unsaved</span> : null}
          </div>
        </div>

        {pendingSuggestions.length > 0 ? (
          <div className="field">
            <span className="kicker">SUGGESTED TAGS — TAP TO ACCEPT, ✕ TO DISMISS</span>
            <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
              {pendingSuggestions.map((t) => {
                const bucket = bucketOf(t);
                return (
                  <span key={t} className="row-gap-8" style={{ alignItems: "center", gap: 4, display: "inline-flex" }}>
                    <button
                      type="button"
                      className={`chip ${BUCKET_CHIP[bucket ?? ""] ?? "neutral"}`}
                      style={{ cursor: "pointer" }}
                      disabled={busy !== null}
                      title={bucket ? `${bucket} — from the keyword bank` : "new phrase — not in the keyword bank, no metrics yet"}
                      onClick={() => addTag(t)}
                    >
                      + {t} · {(bucket ?? "new").toLowerCase()}
                    </button>
                    <button
                      type="button"
                      className="btn btn-tertiary"
                      style={{ fontSize: 11, padding: "2px 6px" }}
                      title="Dismiss suggestion"
                      onClick={() => setSuggestedTags((cur) => cur.filter((x) => x !== t))}
                    >
                      ✕
                    </button>
                  </span>
                );
              })}
            </div>
            <span className="hint">
              Accepted suggestions join the tag list above — the tally and the {TAG_COUNT}-tag counter
              track your edited selection, not the draft.
            </span>
          </div>
        ) : null}

        <div className="field">
          <label className="kicker" htmlFor="l2-hook">DESCRIPTION HOOK — THE OPENER, IN SHOP VOICE</label>
          <textarea
            id="l2-hook"
            className="input"
            rows={3}
            value={hook}
            onChange={(e) => setHook(e.target.value)}
          />
          <div className="row-gap-12" style={{ marginTop: 6 }}>
            <button
              className="btn btn-secondary"
              disabled={busy !== null || !hook.trim() || hook === seo.hook}
              onClick={() => call("hook", `/api/listings/${seo.listingId}`, "PATCH", { descriptionHook: hook.trim() })}
            >
              {busy === "hook" ? <span className="spinner" /> : null}
              Save hook
            </button>
            {hook !== seo.hook ? <span className="hint">Unsaved</span> : null}
          </div>
        </div>

        <div className="field">
          <span className="kicker">ATTRIBUTES</span>
          {attrs.length === 0 ? <span className="hint">None yet — generate a draft or add one.</span> : null}
          {attrs.map((a, i) => (
            <div key={i} className="row-gap-8" style={{ alignItems: "center" }}>
              <input
                className="input"
                style={{ flex: "0 1 160px" }}
                value={a.name}
                placeholder="Occasion"
                aria-label="Attribute name"
                onChange={(e) =>
                  setAttrs((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
              />
              <input
                className="input"
                style={{ flex: "1 1 180px" }}
                value={a.value}
                placeholder="Halloween"
                aria-label="Attribute value"
                onChange={(e) =>
                  setAttrs((cur) => cur.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                }
              />
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 11, padding: "3px 8px" }}
                onClick={() => setAttrs((cur) => cur.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="row-gap-12">
            <button
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "5px 10px" }}
              onClick={() => setAttrs((cur) => [...cur, { name: "", value: "" }])}
            >
              + Add attribute
            </button>
            <button
              className="btn btn-secondary"
              disabled={busy !== null}
              onClick={() => call("attrs", `/api/listings/${seo.listingId}`, "PATCH", { attributes: attrs })}
            >
              {busy === "attrs" ? <span className="spinner" /> : null}
              Save attributes
            </button>
          </div>
        </div>
      </div>

      {/* description body = hook + the Product's boilerplate. The boilerplate
          is generated ONCE on the product, never inline here — an empty one
          points back to the Products page instead of papering over it. */}
      <div className="field">
        <span className="kicker">DESCRIPTION BODY — HOOK + PRODUCT BOILERPLATE</span>
        {!seo.product ? (
          <span className="hint">No product set on this listing yet.</span>
        ) : seo.product.hasVoice ? (
          <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="btn btn-secondary"
              disabled={busy !== null}
              onClick={() =>
                call("body", `/api/listings/${seo.listingId}`, "PATCH", { bodyCopy: seo.product!.voiceText })
              }
            >
              {busy === "body" ? <span className="spinner" /> : null}
              {bodyCopySet ? "Refresh body copy from product" : "Use product boilerplate as body copy"}
            </button>
            {bodyCopySet ? <span className="chip done">body copy set</span> : null}
            {bodyCopySet ? (
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 12, padding: "4px 10px" }}
                onClick={() => {
                  setBodyDraft(seo.bodyCopy); // fresh from the record on open
                  setShowBody((v) => !v);
                }}
              >
                {showBody ? "Collapse" : "Read / edit"}
              </button>
            ) : null}
            <span className="hint">
              Stitches {seo.product.name}&apos;s fit/fabric/care copy under the hook — same text on
              every listing that sells this garment.
            </span>
            {/* the description as a buyer reads it: hook (edited in its own
                field above), then the body — editable HERE, for THIS listing
                only. The product boilerplate is never written from L2. */}
            {showBody ? (
              <div className="well" style={{ flexBasis: "100%" }}>
                <div style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>
                  {seo.hook.trim() ? (
                    seo.hook.trim()
                  ) : (
                    <span className="hint">(no hook saved yet — it opens the description)</span>
                  )}
                </div>
                <textarea
                  className="input"
                  value={bodyDraft}
                  rows={Math.min(24, bodyDraft.split("\n").length + 4)}
                  style={{ resize: "vertical", width: "100%" }}
                  onChange={(e) => setBodyDraft(e.target.value)}
                />
                <div className="row-gap-12" style={{ marginTop: 8, alignItems: "center" }}>
                  <button
                    className="btn btn-secondary"
                    disabled={busy !== null || !bodyDirty || !bodyDraft.trim()}
                    onClick={() => call("body-edit", `/api/listings/${seo.listingId}`, "PATCH", { bodyCopy: bodyDraft })}
                  >
                    {busy === "body-edit" ? <span className="spinner" /> : null}
                    Save body copy — this listing only
                  </button>
                  {bodyDirty ? <span className="hint">Unsaved</span> : null}
                  <span className="hint">
                    The product boilerplate is untouched; &quot;Refresh from product&quot; replaces these edits.
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="callout stale">
            {seo.product.name} has no shop-voice boilerplate yet — generate it once on the{" "}
            <Link href="/products">Products page</Link>, then stitch it here. It&apos;s written per
            product, not per listing, so every future listing on this garment reuses it.
          </div>
        )}
      </div>

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

    </div>
  );
}

/**
 * The attached-keywords registry — a thin rail box under the publish gates.
 * Reading and pruning only: the working surface (recommendations, tags,
 * imports) lives in the main panel; this answers "what's on the record"
 * with a minimal ✕ to detach. Dead/unmeasured stay collapsed behind their
 * count — CSV imports attach everything, and nobody sifts 900 dead rows.
 */
export function AttachedKeywordsRail({ seo }: { seo: SeoData }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showParked, setShowParked] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState<string | null>(null);
  const PARKED_RENDER_CAP = 100;

  // attachment = the hand-picked shortlist. Anything attached beyond the
  // tag list is residue from the old attach-everything imports.
  const tagNames = new Set(
    seo.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
  );
  const excess = seo.attached.filter((k) => !tagNames.has(k.name.trim().toLowerCase())).length;

  /** chunked: ~1000 relation moves can't fit one request — loop until clear */
  async function cleanUp() {
    setBusy("cleanup");
    setError(null);
    let moved = 0;
    let remaining = 1;
    while (remaining > 0) {
      const res = await apiJson<{ moved: number; remaining: number }>(
        `/api/listings/${seo.listingId}/rehome-keywords`,
        "POST",
        {}
      );
      if (!res.ok) {
        setError(res.error);
        break;
      }
      moved += res.data.moved;
      remaining = res.data.remaining;
      setCleanupProgress(`Moving to the design pool… ${moved} done${remaining > 0 ? `, ${remaining} left` : ""}`);
      if (res.data.moved === 0) break;
    }
    setCleanupProgress(null);
    router.refresh();
    setBusy(null);
  }

  const main = seo.attached
    .filter((k) => k.bucket !== "Dead" && k.bucket !== "Unknown")
    .slice()
    .sort(
      (a, b) =>
        BUCKETS.indexOf((a.bucket || "Unknown") as Bucket) -
          BUCKETS.indexOf((b.bucket || "Unknown") as Bucket) || keywordRank(a, b)
    );
  const parked = seo.attached
    .filter((k) => k.bucket === "Dead" || k.bucket === "Unknown")
    .slice()
    .sort(keywordRank);

  async function detach(k: KeywordRow) {
    setBusy(k.id);
    setError(null);
    const res = await apiJson(`/api/keywords/${k.id}`, "PATCH", { detachListingId: seo.listingId });
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(null);
  }

  const SHORT_BUCKET: Record<string, string> = {
    Visibility: "vis",
    Reach: "reach",
    "Best Seller": "best",
    Unknown: "?",
    Dead: "dead",
  };

  const row = (k: KeywordRow) => (
    <div key={k.id} className="row-gap-8" style={{ alignItems: "center" }}>
      <span
        className={`chip ${BUCKET_CHIP[k.bucket] ?? "neutral"}`}
        style={{ flex: "0 0 auto" }}
        title={`${k.bucket || "Unknown"} · ${fmt(k.avgSearches)} searches · ${fmt(k.competition)} comp${k.momentumTitle ? ` · ${k.momentumTitle}` : ""}`}
      >
        {SHORT_BUCKET[k.bucket] ?? "?"}
      </span>
      <span className="body-sm" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k.name}>
        {k.name}
        {k.momentum === "Selling now" ? " 🔥" : ""}
      </span>
      <button
        type="button"
        aria-label={`Detach ${k.name}`}
        title="Detach from this listing"
        disabled={busy !== null}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, padding: "2px 4px", flex: "0 0 auto" }}
        onClick={() => detach(k)}
      >
        {busy === k.id ? <span className="spinner" /> : "✕"}
      </button>
    </div>
  );

  return (
    <div className="gate-panel">
      <div className="panel-title">Attached keywords · {seo.attached.length}</div>
      {error ? <div className="field-error">{error}</div> : null}
      {excess > 5 ? (
        <div className="stack-12" style={{ gap: 6, marginBottom: 8 }}>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: "5px 10px", alignSelf: "flex-start" }}
            disabled={busy !== null}
            onClick={cleanUp}
          >
            {busy === "cleanup" ? <span className="spinner" /> : null}
            Keep my tags — move {excess} to the design pool
          </button>
          <span className="hint">
            {cleanupProgress ??
              "Attached should be your shortlist. This moves everything not in your tag list to the Design's pool — still recommendable, off this record."}
          </span>
        </div>
      ) : null}
      {main.length === 0 ? (
        <div className="hint">Nothing measured attached yet — pick from the recommendations.</div>
      ) : (
        <div className="stack-12" style={{ gap: 6 }}>{main.map(row)}</div>
      )}
      {parked.length > 0 ? (
        <>
          <button
            className="btn btn-tertiary"
            style={{ fontSize: 11, padding: "3px 8px", alignSelf: "flex-start", marginTop: 8 }}
            onClick={() => setShowParked((v) => !v)}
          >
            {showParked ? "Hide" : "Show"} {parked.length} dead / unmeasured
          </button>
          {showParked ? (
            <div className="stack-12" style={{ gap: 6, marginTop: 6 }}>
              {parked.slice(0, PARKED_RENDER_CAP).map(row)}
              {parked.length > PARKED_RENDER_CAP ? (
                <span className="hint">…and {parked.length - PARKED_RENDER_CAP} more — detach in Notion if you need a bulk prune.</span>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
