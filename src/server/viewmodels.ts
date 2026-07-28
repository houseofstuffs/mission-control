/**
 * Maps cached SimpleRecords into the shapes the views consume. Server-side
 * only — pages read the cache here and hand plain props to client components.
 */
import { cachedRecords } from "@/server/notion/store";
import { parseStepState } from "@/server/steps";
import { KANBAN_STAGES } from "@/lib/workflows";
import type { SimpleRecord } from "@/server/notion/props";
import type { KanbanCardData } from "@/components/Kanban";
import type { ListingRow } from "@/components/ListingsTable";
import type { IdeaCardData, NicheOption } from "@/components/InboxGrid";
import type { ProductCardData } from "@/components/ProductsView";
import type { NicheCardData } from "@/components/NichesPanel";
import type { RunnerRecord } from "@/components/StepRunner";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const rel = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

function titleOf(records: SimpleRecord[], id: string | undefined): string {
  if (!id) return "";
  return records.find((r) => r.id === id)?.title ?? "";
}

/* ---------- designs / kanban ---------- */

export function designKanbanCards(): KanbanCardData[] {
  const designs = cachedRecords("designs");
  const niches = cachedRecords("niches");
  const listings = cachedRecords("etsy_listings");

  return designs.map((d) => {
    const current = str(d.props["Current Step"]) || "C1";
    const stage =
      KANBAN_STAGES.find((s) => s.steps.includes(current)) ??
      (current === "Done" ? KANBAN_STAGES[KANBAN_STAGES.length - 1] : KANBAN_STAGES[0]);
    const nicheId = rel(d.props["Niche"])[0];
    const niche = niches.find((n) => n.id === nicheId);
    const inListings = listings.filter((l) => rel(l.props["Designs"]).includes(d.id)).length;
    const files = d.props["Artwork Link"];
    return {
      id: d.id,
      title: d.title || "Untitled design",
      currentStep: current,
      stageKey: stage.key,
      nicheName: niche?.title ?? null,
      gate: niche ? str(niche.props["Gate"]) : null,
      hasStale: Boolean(d.props["Has Stale"]),
      hasBlocked: Boolean(d.props["Has Blocked"]),
      listingCount: inListings,
      artworkUrl: typeof files === "string" && files ? files : null,
      meta: [niche?.title, str(d.props["Occasion"]) || null].filter(Boolean).join(" · ") || "no niche yet",
    };
  });
}

/* ---------- listings table ---------- */

export function listingRows(): ListingRow[] {
  const listings = cachedRecords("etsy_listings");
  const products = cachedRecords("products");
  const sections = cachedRecords("shop_sections");
  return listings.map((l) => ({
    id: l.id,
    title: l.title || "Untitled listing",
    currentStep: str(l.props["Current Step"]) || "L1",
    etsyState: str(l.props["Etsy State"]) || "Not pushed",
    originType: str(l.props["Origin Type"]) || "—",
    productName: titleOf(products, rel(l.props["Product"])[0]) || "—",
    sectionName: titleOf(sections, rel(l.props["Shop Section"])[0]) || "—",
    price: num(l.props["Price"]),
    costAtCreation: num(l.props["Cost At Creation"]),
    hasStale: Boolean(l.props["Has Stale"]),
    hasBlocked: Boolean(l.props["Has Blocked"]),
  }));
}

/* ---------- inbox ---------- */

export function ideaCards(): { ideas: IdeaCardData[]; niches: NicheOption[] } {
  const ideas = cachedRecords("ideas");
  const nichesAll = cachedRecords("niches");
  const niches: NicheOption[] = nichesAll.map((n) => ({
    id: n.id,
    name: n.title,
    gate: str(n.props["Gate"]) || "Unevaluated",
  }));
  const cards = ideas.map((i) => {
      const imgs = i.props["Image"];
      const first = Array.isArray(imgs) && imgs.length > 0 ? (imgs[0] as { url?: string }) : null;
      return {
        id: i.id,
        title: i.title || "Untitled idea",
        status: str(i.props["Status"]) || "Inbox",
        captureType: str(i.props["Capture Type"]) || "Copy",
        sourceUrl: str(i.props["Source URL"]) || null,
        note: str(i.props["Note"]),
        occasion: str(i.props["Occasion"]) || null,
        occasionDate: str(i.props["Occasion Date"]) || null,
        leadTimeDays: num(i.props["Lead Time Days"]),
        enterCreativeBy: str(i.props["Enter Creative By"]) || null,
        nicheName: titleOf(nichesAll, rel(i.props["Niche"])[0]) || null,
        imageUrl: first?.url || null,
      };
    });
  // inbox first, then triaged/promoted, discarded last
  const order = ["Inbox", "Triaged", "Promoted", "Discarded"];
  cards.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return { ideas: cards, niches };
}

/* ---------- niches ---------- */

export function nicheCards(): NicheCardData[] {
  const niches = cachedRecords("niches");
  const ideas = cachedRecords("ideas");
  const designs = cachedRecords("designs");
  const order = ["Greenlit", "Unevaluated", "Parked", "Killed"];
  return niches
    .map((n) => ({
      id: n.id,
      name: n.title || "Untitled niche",
      gate: str(n.props["Gate"]) || "Unevaluated",
      gateReason: str(n.props["Gate Reason"]),
      beatThesis: str(n.props["Beat Thesis"]),
      evaluatedAt: str(n.props["Evaluated At"]) || null,
      ideaCount: ideas.filter((i) => rel(i.props["Niche"]).includes(n.id)).length,
      designCount: designs.filter((d) => rel(d.props["Niche"]).includes(n.id)).length,
    }))
    .sort((a, b) => order.indexOf(a.gate) - order.indexOf(b.gate));
}

/* ---------- products ---------- */

/**
 * Material/style qualifiers kept in the headline so same-type products stay
 * distinguishable ("there will be other kinds of blankets"). Rendered in
 * title case before the uppercase product word: "Generic Woven BLANKET".
 */
const QUALIFIERS: Record<string, Array<[RegExp, string]>> = {
  BLANKET: [
    [/woven/, "Woven"],
    [/sherpa/, "Sherpa"],
    [/minky/, "Minky"],
    [/plush/, "Plush"],
    [/fleece/, "Fleece"],
  ],
  MUG: [
    [/color[- ]changing|magic/, "Color Changing"],
    [/enamel/, "Enamel"],
    [/travel/, "Travel"],
    [/glass/, "Glass"],
    [/ceramic/, "Ceramic"],
  ],
  TUMBLER: [
    [/stainless/, "Stainless"],
    [/insulated/, "Insulated"],
  ],
  TOTE: [
    [/canvas/, "Canvas"],
    [/cotton/, "Cotton"],
    [/jute/, "Jute"],
  ],
  PILLOW: [
    [/sequin/, "Sequin"],
    [/throw/, "Throw"],
  ],
  STICKER: [
    [/kiss[- ]cut/, "Kiss Cut"],
    [/die[- ]cut/, "Die Cut"],
    [/vinyl/, "Vinyl"],
  ],
  SHIRT: [
    [/garment[- ]dyed/, "Garment Dyed"],
    [/ringer/, "Ringer"],
  ],
};

/** Printify returns "Generic brand" for unbranded blueprints — the word
 * "brand" is noise in a headline wherever it appears. */
function cleanBrand(brand: string): string {
  return brand.replace(/\bbrands?\b/gi, "").replace(/\s+/g, " ").trim();
}

/** Short product label for the dashboard headline — order matters (hoodie
 * before sweatshirt before shirt; long sleeve before shirt), with any
 * material qualifier preserved. */
function shortProductWord(blueprintTitle: string): string {
  const t = blueprintTitle.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/hood/, "HOODIE"],
    [/sweatshirt|crewneck|crew neck/, "SWEATSHIRT"],
    [/long sleeve/, "LONG SLEEVE"],
    [/tank/, "TANK"],
    [/t-shirt|tee\b|shirt/, "SHIRT"],
    [/mug/, "MUG"],
    [/tumbler/, "TUMBLER"],
    [/blanket/, "BLANKET"],
    [/tote|bag/, "TOTE"],
    [/hat|cap\b|beanie/, "HAT"],
    [/sticker/, "STICKER"],
    [/poster|print\b/, "POSTER"],
    [/canvas/, "CANVAS"],
    [/pillow|cushion/, "PILLOW"],
    [/phone case|case/, "CASE"],
    [/sock/, "SOCKS"],
    [/apron/, "APRON"],
    [/ornament/, "ORNAMENT"],
  ];
  for (const [re, word] of rules) {
    if (!re.test(t)) continue;
    const qualifier = (QUALIFIERS[word] ?? []).find(([q]) => q.test(t))?.[1];
    return qualifier ? `${qualifier} ${word}` : word;
  }
  const last = blueprintTitle.trim().split(/\s+/).pop() ?? "";
  return last.toUpperCase();
}

export function productCards(): ProductCardData[] {
  const products = cachedRecords("products");
  return products.map((p) => ({
    id: p.id,
    name: p.title || "Untitled product",
    // A "Short Name" typed in Notion always wins over the derived label.
    shortName:
      str(p.props["Short Name"]).trim() ||
      [
        cleanBrand(str(p.props["Blueprint Brand"])),
        shortProductWord(str(p.props["Blueprint Title"]) || p.title),
        str(p.props["Blueprint Model"]),
      ]
        .filter(Boolean)
        .join(" "),
    blueprintTitle: str(p.props["Blueprint Title"]),
    technique: str(p.props["Print Technique"]) || null,
    blueprintId: num(p.props["Printify Blueprint ID"]),
    providerId: num(p.props["Printify Print Provider ID"]),
    providerName: str(p.props["Print Provider Name"]),
    maxW: num(p.props["Max Print Width px"]),
    maxH: num(p.props["Max Print Height px"]),
    ratios: str(p.props["Aspect Ratios"]),
    recompose: Boolean(p.props["Recomposition Flag"]),
    costMin: num(p.props["Base Cost Min"]),
    costMax: num(p.props["Base Cost Max"]),
    variantCount: num(p.props["Variant Count"]),
    syncedAt: str(p.props["Synced At"]) || null,
    hasVoiceText: str(p.props["Shop Voice Text"]).trim().length > 0,
  }));
}

/* ---------- step runner ---------- */

export function runnerRecord(rec: SimpleRecord): RunnerRecord {
  const state = parseStepState(rec);
  const steps: RunnerRecord["steps"] = {};
  for (const [id, entry] of Object.entries(state.steps)) steps[id] = entry;

  const gates: Array<{ label: string; ok: boolean }> = [];
  if (rec.dbKey === "etsy_listings") {
    // L6 publish gates (spec §6.1) — computed live from record fields
    const title = str(rec.props["Title"]);
    const tags = str(rec.props["Tags"]).split(",").map((t) => t.trim()).filter(Boolean);
    const attrs = str(rec.props["Attributes (JSON)"]);
    const hook = str(rec.props["Description Hook"]);
    const body = str(rec.props["Body Copy"]);
    gates.push(
      { label: "Title present (<15 words)", ok: title.length > 0 && title.split(/\s+/).length < 15 },
      { label: `13 tags (${tags.length}/13)`, ok: tags.length === 13 },
      { label: "Attributes recorded", ok: attrs.trim().length > 2 },
      { label: "Description hook + body", ok: hook.length > 0 && body.length > 0 },
      { label: "Trademark screening confirmed", ok: Boolean(rec.props["Trademark Screened"]) },
      { label: "Cost snapshot recorded", ok: num(rec.props["Cost At Creation"]) != null }
    );
  } else {
    // creative gate check — what's failing that blocks C10/C11
    const niches = cachedRecords("niches");
    const nicheId = rel(rec.props["Niche"])[0];
    const niche = niches.find((n) => n.id === nicheId);
    gates.push(
      { label: "Niche greenlit", ok: niche ? str(niche.props["Gate"]) === "Greenlit" : false },
      { label: "Primary product chosen", ok: rel(rec.props["Primary Product"]).length > 0 },
      { label: "PSD master saved + linked", ok: str(rec.props["PSD Master Link"]).length > 0 },
      {
        label: "Text re-screened if changed since R5",
        ok: niche ? ["Screened clear"].includes(str(niche.props["Screening Status"])) : false,
      }
    );
  }

  return {
    id: rec.id,
    title: rec.title || "Untitled",
    workflowKey: rec.dbKey === "designs" ? "creative" : "listing",
    current: state.current,
    steps,
    gates,
  };
}

/* ---------- today ---------- */

export interface TodaySummary {
  designs: { total: number; stale: number; blocked: number; byStep: Array<{ step: string; count: number }> };
  listings: { total: number; stale: number; blocked: number };
  inboxCount: number;
  urgentIdeas: number;
  recentMoves: Array<{ id: string; name: string; event: string; detail: string; at: string }>;
  greenlitWaiting: string[];
}

export function todaySummary(): TodaySummary {
  const designs = cachedRecords("designs");
  const listings = cachedRecords("etsy_listings");
  const ideas = cachedRecords("ideas");
  const logs = cachedRecords("workflow_log");
  const niches = cachedRecords("niches");

  const byStep = new Map<string, number>();
  for (const d of designs) {
    const step = str(d.props["Current Step"]) || "C1";
    byStep.set(step, (byStep.get(step) ?? 0) + 1);
  }

  const urgent = ideas.filter((i) => {
    const by = str(i.props["Enter Creative By"]);
    return (
      str(i.props["Status"]) === "Inbox" && by && new Date(by).getTime() - Date.now() < 7 * 86400_000
    );
  }).length;

  const usedNicheIds = new Set(designs.flatMap((d) => rel(d.props["Niche"])));
  const greenlitWaiting = niches
    .filter((n) => str(n.props["Gate"]) === "Greenlit" && !usedNicheIds.has(n.id))
    .map((n) => n.title);

  const recentMoves = logs
    .slice()
    .sort((a, b) => str(b.props["At"]).localeCompare(str(a.props["At"])))
    .slice(0, 8)
    .map((l) => ({
      id: l.id,
      name: l.title,
      event: str(l.props["Event"]),
      detail: [str(l.props["From Step"]), str(l.props["To Step"])].filter(Boolean).join(" → "),
      at: str(l.props["At"]),
    }));

  return {
    designs: {
      total: designs.length,
      stale: designs.filter((d) => d.props["Has Stale"]).length,
      blocked: designs.filter((d) => d.props["Has Blocked"]).length,
      byStep: [...byStep.entries()].map(([step, count]) => ({ step, count })),
    },
    listings: {
      total: listings.length,
      stale: listings.filter((l) => l.props["Has Stale"]).length,
      blocked: listings.filter((l) => l.props["Has Blocked"]).length,
    },
    inboxCount: ideas.filter((i) => str(i.props["Status"]) === "Inbox").length,
    urgentIdeas: urgent,
    recentMoves,
    greenlitWaiting,
  };
}
