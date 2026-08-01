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
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Kicker, Spinner } from "./ui";
import { CopyIconButton } from "./CopyIconButton";
import { apiJson } from "@/lib/api";
import { BUCKETS, TAG_COUNT, TAG_MAX_CHARS, TARGET_MIX, type Bucket } from "@/config/keywords";

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
  /** lowercased keyword name → bucket + metrics, across the whole bank —
   *  one lookup for the tally, the suggestion chips, and the rail tooltips */
  bank: Record<
    string,
    { bucket: string; searches: number | null; competition: number | null; momentum: string | null }
  >;
  /** keyword ids ✕'d off the shortlist — persisted, excluded from recommendations */
  dismissed: string[];
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

/**
 * Tier-1 shortlist sizes — top-N per bucket, ranked within each bucket
 * separately so low-competition Visibility keywords can't crowd out the
 * Reach and Best Seller candidates. Fixed sizes, NOT reduced by what's
 * already selected: a word ✕'d out of the selection returns here.
 */
const SHORTLIST_PER_BUCKET: Record<string, number> = { Visibility: 12, Reach: 10, "Best Seller": 4 };

/**
 * Tier 2 — the selected working set (up to 13 going onto this listing).
 * Lives in context because two siblings render it: the center panel adds
 * to it (shortlist taps, AI suggestions), the right rail displays it,
 * removes from it, and saves it. One state, one tally.
 */
const TagSelection = createContext<{
  tags: string[];
  setTags: React.Dispatch<React.SetStateAction<string[]>>;
  dirty: boolean;
  setDirty: (d: boolean) => void;
} | null>(null);

export function TagSelectionProvider({ initial, children }: { initial: string; children: ReactNode }) {
  const [tags, setTags] = useState<string[]>(
    initial.split(",").map((t) => t.trim()).filter(Boolean)
  );
  const [dirty, setDirty] = useState(false);
  return (
    <TagSelection.Provider value={{ tags, setTags, dirty, setDirty }}>
      {children}
    </TagSelection.Provider>
  );
}

function useTagSelection() {
  const ctx = useContext(TagSelection);
  if (!ctx) throw new Error("TagSelectionProvider missing — StepRunner wraps L2 with it.");
  return ctx;
}

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
  // tier 2 is shared with the SelectedTagsRail on the right — one state
  const { tags, setTags, dirty, setDirty } = useTagSelection();
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
  // one generation of history — a regenerate must never eat an unsaved
  // draft silently. Swap flips between the current and previous versions.
  const [prevDraft, setPrevDraft] = useState<{
    title: string;
    hook: string;
    attrs: Array<{ name: string; value: string }>;
    suggested: string[];
  } | null>(null);

  function swapDrafts() {
    if (!prevDraft) return;
    const current = { title, hook, attrs, suggested: suggestedTags };
    setTitle(prevDraft.title);
    setHook(prevDraft.hook);
    setAttrs(prevDraft.attrs);
    setSuggestedTags(prevDraft.suggested);
    setPrevDraft(current);
    setNotice("Swapped drafts — swap again to flip back. Save the one you're keeping.");
  }

  // Unsaved drafts survive reloads and deploys: every keystroke snapshots
  // to this browser's storage, and a fresh mount restores anything newer
  // than what's saved on the record. Losing a good hook to a page refresh
  // happened once too often to stay possible.
  const draftKey = `stuffs-l2-draft-${seo.listingId}`;
  const restoredDraft = useRef(false);
  useEffect(() => {
    if (restoredDraft.current) return;
    restoredDraft.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      let restored = false;
      if (typeof d.title === "string" && d.title && d.title !== seo.title) {
        setTitle(d.title);
        restored = true;
      }
      if (typeof d.hook === "string" && d.hook && d.hook !== seo.hook) {
        setHook(d.hook);
        restored = true;
      }
      if (
        Array.isArray(d.attrs) &&
        d.attrs.length > 0 &&
        JSON.stringify(d.attrs) !== JSON.stringify(seo.attributes)
      ) {
        setAttrs(d.attrs);
        restored = true;
      }
      if (Array.isArray(d.suggested) && d.suggested.length > 0) setSuggestedTags(d.suggested);
      if (d.prevDraft) setPrevDraft(d.prevDraft);
      if (restored) setNotice("Restored your unsaved draft from this browser — save what you're keeping.");
    } catch {
      /* corrupt snapshot — start clean */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ title, hook, attrs, suggested: suggestedTags, prevDraft })
      );
    } catch {
      /* storage blocked — drafts just aren't persisted */
    }
  }, [draftKey, title, hook, attrs, suggestedTags, prevDraft]);

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
    seo.bank[tag.trim().toLowerCase()]?.bucket ?? null;

  const inTagList = (name: string) => tags.some((t) => t.toLowerCase() === name.toLowerCase());

  // ✕'d off the shortlist — persisted on the listing, optimistic locally.
  // Dismissal is "not for this listing": the word stays in the bank and
  // the full pool, and picking it from Show-all un-dismisses it.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set(seo.dismissed));
  async function persistDismissed(next: Set<string>) {
    setDismissed(new Set(next));
    const res = await apiJson(`/api/listings/${seo.listingId}`, "PATCH", {
      dismissedKeywords: [...next],
    });
    if (!res.ok) setError(res.error);
  }

  // Tier 3 — the full candidate pool: everything researched for this
  // Design (imports land here) plus any legacy attachments not yet tagged.
  const pool: Array<KeywordRow & { attached: boolean }> = [
    ...seo.inherited.map((k) => ({ ...k, attached: false })),
    ...seo.attached.filter((k) => !inTagList(k.name)).map((k) => ({ ...k, attached: true })),
  ];
  // Tier 1 — the bucket-balanced shortlist: top N PER BUCKET, ranked within
  // each bucket (momentum, then volume) so Visibility's natural size can't
  // crowd out Reach/Best Seller. Fixed sizes; a ✕'d word requalifies and
  // returns here — removal is "not this one", never "forget this word".
  const recommendedInherited: Array<KeywordRow & { attached: boolean }> = [];
  for (const bucket of ["Visibility", "Reach", "Best Seller"]) {
    recommendedInherited.push(
      ...pool
        .filter(
          (k) => k.bucket === bucket && k.tagEligible && !inTagList(k.name) && !dismissed.has(k.id)
        )
        .sort(keywordRank)
        .slice(0, SHORTLIST_PER_BUCKET[bucket])
    );
  }
  const inheritedShown = showAllInherited
    ? BUCKETS.flatMap((b) => pool.filter((k) => (k.bucket || "Unknown") === b).sort(keywordRank))
    : recommendedInherited;

  // The AI-built starting point: a listing with NO saved tags opens with
  // the best 13 already selected toward the target mix (7 vis · 4 reach ·
  // 2 best, backfilled best-first when a bucket runs thin). Client-side
  // and UNSAVED — the operator course-corrects and then commits; review
  // is the editability plus the save button, not an empty panel.
  const didPrefill = useRef(false);
  useEffect(() => {
    if (didPrefill.current) return;
    didPrefill.current = true;
    if (seo.tags.trim() || tags.length > 0 || pool.length === 0) return;
    const targets: Array<[string, number]> = [
      ["Visibility", 7],
      ["Reach", 4],
      ["Best Seller", 2],
    ];
    const ranked = (b: string) =>
      pool.filter((k) => k.bucket === b && k.tagEligible).sort(keywordRank);
    const chosen: string[] = [];
    const used = new Set<string>();
    for (const [b, n] of targets) {
      for (const k of ranked(b).slice(0, n)) {
        chosen.push(k.name);
        used.add(k.id);
      }
    }
    for (const k of targets.flatMap(([b]) => ranked(b)).filter((k) => !used.has(k.id))) {
      if (chosen.length >= TAG_COUNT) break;
      chosen.push(k.name);
      used.add(k.id);
    }
    if (chosen.length > 0) {
      setTags(chosen.slice(0, TAG_COUNT));
      setDirty(true);
      setNotice(
        `Pre-selected the best ${Math.min(chosen.length, TAG_COUNT)} toward the target mix — swap any out on the right, then save.`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No hard stop at 13 — over-filling while sifting is normal; the rail
  // warns and the publish gate still requires exactly 13 at L6.
  function addTag(name: string) {
    if (inTagList(name)) return;
    setDirty(true);
    setTags((cur) => [...cur, name]);
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

  /** pick a candidate into the Selected panel. No relation write here —
   *  saving the selection syncs attachments server-side. Picking a
   *  dismissed word (from Show-all) un-dismisses it: choosing it IS the
   *  reversal. */
  function pickKeyword(k: KeywordRow) {
    if (dismissed.has(k.id)) {
      const next = new Set(dismissed);
      next.delete(k.id);
      void persistDismissed(next);
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
    // the server reads the SAVED tags off the record — the locked-in
    // keyword decision, not the mid-edit selection
    const res = await apiJson<{ draft: CopyDraft }>(
      `/api/listings/${seo.listingId}/generate-copy`,
      "POST",
      {}
    );
    if (!res.ok) setError(res.error);
    else {
      const d = res.data.draft;
      // stash what's on screen BEFORE overwriting — regenerating for one
      // field must never silently cost an unsaved version of another
      setPrevDraft({ title, hook, attrs, suggested: suggestedTags });
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
  const attrsDirty = JSON.stringify(attrs) !== JSON.stringify(seo.attributes);
  // why Generate is locked, when it is — shown inline, not just on hover
  const generateBlocker = !seo.hasDesign
    ? "Attach a Design first — the draft needs its phrase and niche."
    : tags.length === 0
      ? "Pick your keywords first — the title is built from them."
      : dirty
        ? "Save the Selected tags first — the draft builds on your locked-in decision."
        : null;

  return (
    <div className="card supporting">
      <Kicker>SEO — KEYWORDS &amp; TAGS</Kicker>

      {error ? <div className="callout blocked">{error}</div> : null}
      {notice ? <div className="hint">{notice}</div> : null}

      {/* tier 1 — the bucket-balanced shortlist; the selected set lives in
          the rail on the right. Always rendered: an empty pool SAYS so
          instead of silently vanishing (a listing whose design holds no
          research yet would otherwise show nothing at all). */}
      <div className="field">
        <span className="kicker">
          {showAllInherited
            ? `FULL KEYWORD POOL · ${pool.length}`
            : `SHORTLIST · ${recommendedInherited.length}`}
        </span>
        {/* the pool's shape, always visible — when a bucket is thin, the
            shortlist is thin for a data reason, not a rendering one */}
        <span className="hint">
          pool {pool.length}: {pool.filter((k) => k.bucket === "Visibility").length} visibility ·{" "}
          {pool.filter((k) => k.bucket === "Reach").length} reach ·{" "}
          {pool.filter((k) => k.bucket === "Best Seller").length} best seller ·{" "}
          {pool.filter((k) => k.bucket === "Dead" || k.bucket === "Unknown" || !k.bucket).length} dead/unmeasured
        </span>
        {pool.length === 0 ? (
          <div className="callout stale">
            No keyword candidates reachable from this listing. The pool is keywords linked to this
            listing&apos;s Design (CSV imports land there) plus this listing&apos;s own shortlist.{" "}
            {seo.hasDesign
              ? "Drop a CSV below, or run the cleanup on the sibling listing holding the research — design-pool keywords appear on every listing of the design."
              : "This listing has no Design attached — set that first; research has nowhere to land without it."}
          </div>
        ) : null}
        {pool.length > 0 ? (
          <>
          <span className="hint">
            {showAllInherited
              ? "Everything from this Design and your imports, best first — dead and unmeasured included down here."
              : "Bucket-balanced: the top visibility, reach and best-seller candidates, each ranked within its own bucket (momentum, then volume). Tap + to move one into Selected tags on the right; a ✕'d word returns here."}
          </span>
          {!showAllInherited && recommendedInherited.length === 0 ? (
            <span className="hint">Nothing left to recommend — browse the full pool below.</span>
          ) : null}
          {/* sectioned by bucket — visibility first so the backbone gets
              locked in before the stretches; the bucket lives in the header
              now, not on every pill */}
          {BUCKETS.map((b) => {
            const items = inheritedShown.filter((k) => (k.bucket || "Unknown") === b);
            if (items.length === 0) return null;
            return (
              <div key={b} className="stack-12" style={{ gap: 6, marginTop: 4 }}>
                <span className="kicker">{b.toUpperCase()} · {items.length}</span>
                {/* two columns — the candidate names are short enough to pair up */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, justifyItems: "start" }}>
                  {items.map((k) => {
                    const out = dismissed.has(k.id);
                    return (
                      <span key={k.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <button
                          type="button"
                          className="chip neutral"
                          style={{ cursor: "pointer", textAlign: "left", opacity: out ? 0.45 : 1 }}
                          disabled={busy !== null}
                          title={`${b} · ${fmt(k.avgSearches)} searches · ${fmt(k.competition)} comp${k.momentum && k.momentum !== "Unknown" ? ` · ${k.momentum.toLowerCase()}` : ""}${k.tagEligible ? "" : " · over 20 chars, title-only"}${out ? " · dismissed — picking it brings it back" : ""}`}
                          onClick={() => pickKeyword(k)}
                        >
                          + {k.name}
                          {k.momentum === "Selling now" ? " 🔥" : ""}
                        </button>
                        {!out ? (
                          <button
                            type="button"
                            aria-label={`Dismiss ${k.name}`}
                            title="Remove from consideration — the next-best candidate takes its place"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 11, padding: "2px 3px" }}
                            onClick={() => {
                              const next = new Set(dismissed);
                              next.add(k.id);
                              void persistDismissed(next);
                            }}
                          >
                            ✕
                          </button>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {pool.length > recommendedInherited.length ? (
            <button
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "4px 10px", alignSelf: "flex-start" }}
              onClick={() => setShowAllInherited((v) => !v)}
            >
              {showAllInherited ? "Show recommended only" : `Show all ${pool.length}`}
            </button>
          ) : null}
          </>
        ) : null}
      </div>

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
            // the title front-loads the LOCKED-IN keywords — generation
            // waits for a saved, non-empty selection, never a mid-edit one
            <button
              className="btn btn-secondary"
              disabled={busy !== null || generateBlocker !== null}
              title={generateBlocker ?? undefined}
              onClick={generate}
            >
              <Spinner active={busy === "generate"} />
              Generate draft copy
            </button>
          ) : (
            <span className="hint">Set ANTHROPIC_API_KEY to generate drafts.</span>
          )}
          <span className="hint">
            {generateBlocker
              ? `Locked: ${generateBlocker}`
              : "Drafts only — nothing saves without its button."}
          </span>
        </div>
        {prevDraft ? (
          <div className="row-gap-12" style={{ alignItems: "center", marginTop: 6 }}>
            <button
              className="btn btn-tertiary"
              style={{ fontSize: 12, padding: "4px 10px" }}
              disabled={busy !== null}
              onClick={swapDrafts}
            >
              ⇄ Swap back to previous draft
            </button>
            <span className="hint">Nothing is lost on regenerate anymore — flip between the last two versions.</span>
          </div>
        ) : null}
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
              Accepted suggestions join Selected tags on the right — the tally and the {TAG_COUNT}-tag
              counter track your edited selection, not the draft.
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
            {/* an empty save over saved attributes is a CLEAR — named and
                confirmed, never the default behavior of the same button */}
            <button
              className="btn btn-secondary"
              disabled={busy !== null || !attrsDirty}
              onClick={() => {
                const clearing = attrs.filter((a) => a.name.trim() && a.value.trim()).length === 0 && seo.attributes.length > 0;
                if (clearing && !window.confirm("This clears the attributes saved on the listing. Clear them?")) return;
                call("attrs", `/api/listings/${seo.listingId}`, "PATCH", { attributes: attrs });
              }}
            >
              {busy === "attrs" ? <span className="spinner" /> : null}
              {attrs.filter((a) => a.name.trim() && a.value.trim()).length === 0 && seo.attributes.length > 0
                ? "Clear saved attributes"
                : "Save attributes"}
            </button>
            {attrsDirty ? <span className="hint">Unsaved</span> : null}
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

    </div>
  );
}

/**
 * Tier 2 — the Selected tags rail, under the publish gates. The up-to-13
 * working set the operator is actually building: added from the shortlist
 * (or AI suggestions) in the center panel, removed here with the minimal ✕.
 * A ✕'d word requalifies for the shortlist — removal is "not this one",
 * never "forget this word exists". Save commits the set to the listing;
 * the server syncs keyword attachments to match.
 */
export function SelectedTagsRail({ seo }: { seo: SeoData }) {
  const router = useRouter();
  const { tags, setTags, dirty, setDirty } = useTagSelection();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleanupProgress, setCleanupProgress] = useState<string | null>(null);

  const bucketOf = (tag: string): string | null =>
    seo.bank[tag.trim().toLowerCase()]?.bucket ?? null;

  /** same story the shortlist pills tell on hover — bucket, metrics, momentum */
  const tagTooltip = (tag: string): string => {
    const info = seo.bank[tag.trim().toLowerCase()];
    if (!info) return `${tag} — not in the keyword bank, no metrics`;
    return `${info.bucket} · ${fmt(info.searches)} searches · ${fmt(info.competition)} comp${
      info.momentum && info.momentum !== "Unknown" ? ` · ${info.momentum.toLowerCase()}` : ""
    }`;
  };

  // display AND save in bucket order — visibility block on top, additions
  // slot into their section instead of appending to the bottom
  const bucketPos = (tag: string) => {
    const b = bucketOf(tag);
    const i = b ? BUCKETS.indexOf(b as Bucket) : -1;
    return i === -1 ? 2.5 : i; // bankless "new" words sit after Best Seller
  };
  const sortedTags = tags.slice().sort((a, b) => bucketPos(a) - bucketPos(b));

  function remove(tag: string) {
    setDirty(true);
    setTags((cur) => cur.filter((t) => t.toLowerCase() !== tag.toLowerCase()));
  }

  // inline edit — the tag TEXT changes; metrics belong to the phrase, so
  // the edited word re-resolves against the bank by name: match a bank
  // keyword and its bucket/numbers apply, match nothing and it's honestly
  // "new". The original bank record keeps its own numbers untouched.
  const [editing, setEditing] = useState<{ orig: string; value: string } | null>(null);
  const editOverCap = editing != null && editing.value.trim().length > TAG_MAX_CHARS;
  function commitEdit() {
    if (!editing) return;
    const next = editing.value.trim();
    if (!next || next.toLowerCase() === editing.orig.toLowerCase()) {
      setEditing(null);
      return;
    }
    if (next.length > TAG_MAX_CHARS) return; // hint shows; Escape cancels
    setDirty(true);
    setTags((cur) => {
      const without = cur.filter((t) => t.toLowerCase() !== editing.orig.toLowerCase());
      // editing into a word already selected just collapses the duplicate
      return without.some((t) => t.toLowerCase() === next.toLowerCase())
        ? without
        : [...without, next];
    });
    setEditing(null);
  }

  async function save() {
    setBusy("save");
    setError(null);
    const res = await apiJson(`/api/listings/${seo.listingId}`, "PATCH", { tags: sortedTags.join(", ") });
    if (!res.ok) setError(res.error);
    else {
      setDirty(false);
      router.refresh();
    }
    setBusy(null);
  }

  // residue from the old attach-everything imports — offer the move-out
  // until the attachment list matches the picks
  const tagNames = new Set(tags.map((t) => t.trim().toLowerCase()));
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

  // The target bands, as sections. min is when the ✓ lights; the range in
  // the label is the whole guidance. Bankless/unmeasured words gather
  // under OTHER (only rendered when occupied).
  const BANDS: Array<{ bucket: string | null; label: string; min: number | null; max: number | null }> = [
    { bucket: "Visibility", label: "VISIBILITY (6–7)", min: 6, max: 7 },
    { bucket: "Reach", label: "REACH (4–5)", min: 4, max: 5 },
    { bucket: "Best Seller", label: "BEST SELLER (1–2)", min: 1, max: 2 },
    { bucket: null, label: "OTHER", min: null, max: null },
  ];
  const bandItems = (band: (typeof BANDS)[number]) =>
    band.bucket
      ? sortedTags.filter((t) => bucketOf(t) === band.bucket)
      : sortedTags.filter((t) => {
          const b = bucketOf(t);
          return !b || b === "Unknown" || b === "Dead";
        });

  return (
    <div className="gate-panel tags-panel">
      <div className="panel-title">
        Selected tags · {tags.length}/{TAG_COUNT}
      </div>
      {tags.length > TAG_COUNT ? (
        <span className="chip stale" style={{ alignSelf: "flex-start" }}>
          {tags.length - TAG_COUNT} over the limit — trim before publish
        </span>
      ) : null}
      {error ? <div className="field-error">{error}</div> : null}
      {tags.length === 0 ? (
        <div className="hint">Nothing selected yet — tap + on the shortlist.</div>
      ) : null}
      {BANDS.map((band) => {
        const items = bandItems(band);
        if (items.length === 0 && band.min == null) return null;
        // ✓ once the band's minimum is met; a count toward it until then;
        // over the top of the range flips to the caution treatment
        const status =
          band.min == null ? null : items.length >= band.min ? (
            band.max != null && items.length > band.max ? (
              <span className="chip stale" title={`Over the ${band.label.toLowerCase()} range`}>
                {items.length} — over
              </span>
            ) : (
              <span className="chip done" title="Target met">✓ {items.length}</span>
            )
          ) : (
            <span className="hint">{items.length} of {band.min}</span>
          );
        return (
          <div key={band.label} className="stack-12" style={{ gap: 4, marginTop: 6 }}>
            <div className="row-gap-8" style={{ alignItems: "center" }}>
              <span className="kicker" style={{ flex: 1 }}>{band.label}</span>
              {status}
            </div>
            {items.map((t) => (
              <div key={t} className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
                {editing?.orig === t ? (
                  <>
                    <input
                      autoFocus
                      className="input"
                      style={{ flex: 1, minWidth: 0, fontSize: 12, padding: "3px 6px" }}
                      value={editing.value}
                      onChange={(e) => setEditing({ orig: t, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      onBlur={commitEdit}
                    />
                    {editOverCap ? (
                      <span className="hint" style={{ flexBasis: "100%", color: "var(--status-blocked, #b3423a)" }}>
                        {editing.value.trim().length}/{TAG_MAX_CHARS} — over Etsy&apos;s tag cap
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span
                    className="body-sm"
                    style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}
                    title={`${tagTooltip(t)} — click to edit`}
                    onClick={() => setEditing({ orig: t, value: t })}
                  >
                    {t}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${t}`}
                  title="Remove — it returns to the shortlist"
                  disabled={busy !== null}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, padding: "2px 4px", flex: "0 0 auto" }}
                  onClick={() => remove(t)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        );
      })}
      <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <button className="btn btn-secondary" onClick={save} disabled={busy !== null || !dirty}>
          {busy === "save" ? <span className="spinner" /> : null}
          Save tags to listing
        </button>
        {dirty ? <span className="hint">Unsaved</span> : null}
        {tags.length > 0 ? <CopyIconButton text={sortedTags.join(", ")} label="tags" /> : null}
      </div>
      {excess > 5 ? (
        <div className="stack-12" style={{ gap: 6, marginTop: 10 }}>
          <button
            className="btn btn-tertiary"
            style={{ fontSize: 12, padding: "4px 10px", alignSelf: "flex-start" }}
            disabled={busy !== null}
            onClick={cleanUp}
          >
            {busy === "cleanup" ? <span className="spinner" /> : null}
            Move {excess} old attachments to the design pool
          </button>
          <span className="hint">
            {cleanupProgress ??
              "Residue from earlier imports that attached every row. Moves them to the Design's pool — still recommendable, off this record."}
          </span>
        </div>
      ) : null}
    </div>
  );
}
