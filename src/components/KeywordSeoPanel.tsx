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
  bodyCopySet: boolean;
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
  attached: number;
  unchanged: number;
  skipped: number;
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

  // ONE bucket lookup for the whole panel — attached, inherited, imported
  // and AI-suggested tags all resolve through the same bank map, so the
  // tally can never disagree with the chips.
  const bucketOf = (tag: string): string | null =>
    seo.bankBuckets[tag.trim().toLowerCase()] ?? null;

  const inTagList = (name: string) => tags.some((t) => t.toLowerCase() === name.toLowerCase());

  function addTag(name: string) {
    if (inTagList(name) || tags.length >= TAG_COUNT) return;
    setDirty(true);
    setTags((cur) => [...cur, name]);
  }
  function removeTag(name: string) {
    setDirty(true);
    setTags((cur) => cur.filter((t) => t.toLowerCase() !== name.toLowerCase()));
  }
  function toggleTag(k: KeywordRow) {
    if (!k.tagEligible) return; // Etsy hard cap — never a tag
    if (inTagList(k.name)) removeTag(k.name);
    else addTag(k.name);
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

  /** attach a Design-inherited keyword: relation now, into the tag list if it fits */
  async function attachInherited(k: KeywordRow) {
    const ok = await call("attach", `/api/keywords/${k.id}`, "PATCH", { attachListingId: seo.listingId });
    if (ok && k.tagEligible) addTag(k.name);
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
    const totals: ImportSummary = { source: "", total: 0, created: 0, attached: 0, unchanged: 0, skipped: 0 };
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
        attached?: number;
        unchanged?: number;
        skipped?: number;
        conflicts?: ImportConflict[];
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
      totals.attached += res.data.attached ?? 0;
      totals.unchanged += res.data.unchanged ?? 0;
      totals.skipped += res.data.skipped ?? 0;
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
      {seo.inherited.length > 0 ? (
        <div className="field">
          <span className="kicker">FROM THIS DESIGN · {seo.inherited.length}</span>
          <span className="hint">
            Keywords attached to the Design during the creative workflow. Toggle to attach here
            {" "}— eligible ones join the tag list.
          </span>
          <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
            {seo.inherited.map((k) => (
              <button
                key={k.id}
                type="button"
                className="chip neutral"
                style={{ cursor: "pointer" }}
                disabled={busy !== null}
                title={`${fmt(k.avgSearches)} searches · ${fmt(k.competition)} comp${k.tagEligible ? "" : " · over 20 chars, title-only"}`}
                onClick={() => attachInherited(k)}
              >
                + {k.name} · {(k.bucket || "unknown").toLowerCase()}
              </button>
            ))}
          </div>
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
            {importSummary.source} format · {importSummary.created} new · {importSummary.attached} attached
            {importSummary.unchanged > 0 ? ` · ${importSummary.unchanged} already current` : ""}
            {importSummary.skipped > 0 ? ` · ${importSummary.skipped} blank rows skipped` : ""}
            {conflicts.length > 0 ? ` · ${conflicts.length} need review below` : ""}
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
                      style={{ cursor: tags.length >= TAG_COUNT ? "not-allowed" : "pointer" }}
                      disabled={busy !== null || tags.length >= TAG_COUNT}
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
              {seo.bodyCopySet ? "Refresh body copy from product" : "Use product boilerplate as body copy"}
            </button>
            {seo.bodyCopySet ? <span className="chip done">body copy set</span> : null}
            <span className="hint">
              Stitches {seo.product.name}&apos;s fit/fabric/care copy under the hook — same text on
              every listing that sells this garment.
            </span>
          </div>
        ) : (
          <div className="callout stale">
            {seo.product.name} has no shop-voice boilerplate yet — generate it once on the{" "}
            <Link href="/products">Products page</Link>, then stitch it here. It&apos;s written per
            product, not per listing, so every future listing on this garment reuses it.
          </div>
        )}
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
                const inTags = inTagList(k.name);
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
                    {/* market momentum — context beside the bucket, not part of it */}
                    {k.momentum && MOMENTUM_CHIP[k.momentum] ? (
                      <span className={`chip ${MOMENTUM_CHIP[k.momentum]}`} title={k.momentumTitle ?? undefined}>
                        {k.momentum.toLowerCase()}
                      </span>
                    ) : null}
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

      {/* manual entry — the one-off path, same API the importer writes through */}
      <div className="field">
        <span className="kicker">ADD A KEYWORD (MANUAL)</span>
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
          <button
            className="btn btn-primary"
            disabled={busy !== null || !kw.trim()}
            onClick={async () => {
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
            }}
          >
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
