/**
 * Maps cached SimpleRecords into the shapes the views consume. Server-side
 * only — pages read the cache here and hand plain props to client components.
 */
import { cachedRecords } from "@/server/notion/store";
import { parseStepState, unmetRequirement } from "@/server/steps";
import { publishGates } from "@/server/publishGates";
import { estimateFor, variantCostsFor } from "@/server/productCost";
import { usDomesticCharge } from "@/server/etsy/profileCost";
import { asCategory } from "@/config/product-categories";
import { KANBAN_STAGES, WORKFLOWS } from "@/lib/workflows";
import type { SimpleRecord } from "@/server/notion/props";
import type { KanbanCardData } from "@/components/Kanban";
import type { ListingRow } from "@/components/ListingsTable";
import type { IdeaCardData, NicheOption } from "@/components/InboxGrid";
import type { ProductCardData, ShippingProfileOption } from "@/components/ProductsView";
import type { NicheCardData } from "@/components/NichesPanel";
import type { RunnerRecord } from "@/components/StepRunner";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const rel = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

function titleOf(records: SimpleRecord[], id: string | undefined): string {
  if (!id) return "";
  return records.find((r) => r.id === id)?.title ?? "";
}

/** The Etsy Shipping Profile a product points at, if any. */
const etsyProfileId = (p: SimpleRecord): string | null =>
  rel(p.props["Etsy Shipping Profile"])[0] ?? null;

/** The synced Etsy profiles, as the Products picker's options. */
export function shippingProfileOptions(): ShippingProfileOption[] {
  return cachedRecords("shipping_profiles")
    .map((s) => ({
      id: s.id,
      name: s.title || "Untitled profile",
      usCharge: usDomesticCharge(s),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
    // snapshot first (a real image, uploaded at C2), served through the
    // thumb proxy: card-sized, and a STABLE url the browser can cache —
    // Notion's signed links rotate every sync and cache as misses. Master
    // PNG Link is the fallback and may not be directly renderable.
    const snap = d.props["Artwork Snapshot"];
    const snapUrl =
      Array.isArray(snap) && snap.length > 0 ? (snap[0] as { url?: string }).url || null : null;
    const files = snapUrl
      ? `/api/designs/${d.id}/thumb?v=${encodeURIComponent(d.lastEdited)}`
      : d.props["Master PNG Link"];
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
  const designs = cachedRecords("designs");

  const entries = listings.map((l) => {
    const designId = rel(l.props["Designs"])[0];
    const design = designs.find((d) => d.id === designId);
    const productId = rel(l.props["Product"])[0];
    const isPrimaryProduct = Boolean(
      design && productId && rel(design.props["Primary Product"])[0] === productId
    );
    return {
      group: design?.title || l.title || "",
      lastEdited: l.lastEdited,
      isPrimaryProduct,
      row: {
        id: l.id,
        title: l.title || "Untitled listing",
        currentStep: str(l.props["Current Step"]) || "L1",
        etsyState: str(l.props["Etsy State"]) || "Not pushed",
        originType: str(l.props["Origin Type"]) || "—",
        productName: titleOf(products, productId) || "—",
        sectionName: titleOf(sections, rel(l.props["Shop Section"])[0]) || "—",
        price: num(l.props["Price"]),
        costAtCreation: num(l.props["Cost At Creation"]),
        hasStale: Boolean(l.props["Has Stale"]),
        hasBlocked: Boolean(l.props["Has Blocked"]),
        isPrimaryProduct,
      } satisfies ListingRow,
    };
  });

  // Fan-out siblings stay TOGETHER, grouped by their design; the group
  // you've touched most recently floats to the top (big-list friendly);
  // within a group the primary product's listing leads, then the rest
  // alphabetically. Raw last-edited order made the twins swap places on
  // every save.
  const groupAt = new Map<string, string>();
  for (const e of entries) {
    const cur = groupAt.get(e.group);
    if (!cur || e.lastEdited > cur) groupAt.set(e.group, e.lastEdited);
  }
  entries.sort(
    (a, b) =>
      (groupAt.get(b.group) ?? "").localeCompare(groupAt.get(a.group) ?? "") ||
      a.group.localeCompare(b.group) ||
      Number(b.isPrimaryProduct) - Number(a.isPrimaryProduct) ||
      a.row.title.localeCompare(b.row.title)
  );
  return entries.map((e) => e.row);
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
  // Newest captured first — the cache's default is last-EDITED, which lets a
  // touched old idea jump the queue and makes the grid feel shuffled.
  const cards = ideas
    .slice()
    .sort((a, b) => str(b.props["Captured At"]).localeCompare(str(a.props["Captured At"])))
    .map((i) => {
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
        trademarkRisk: str(i.props["Trademark Risk"]) || null,
        riskReason: str(i.props["Risk Reason"]),
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
      screeningStatus: str(n.props["Screening Status"]),
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

/** The house name for a product, one line: "Comfort Colors® SWEATSHIRT 1466".
 * Same derivation as the product cards' two-line title. */
export function productLabel(p: SimpleRecord): string {
  const brand = cleanBrand(str(p.props["Blueprint Brand"])) || "Generic";
  const line =
    str(p.props["Short Name"]).trim() ||
    [shortProductWord(str(p.props["Blueprint Title"]) || p.title), str(p.props["Blueprint Model"])]
      .filter(Boolean)
      .join(" ");
  return `${brand} ${line}`.trim();
}

export function productCards(): ProductCardData[] {
  const products = cachedRecords("products");
  const variants = cachedRecords("product_variants");
  return products.map((p) => {
  // Computed live from the cached variants rather than stored: the answer
  // changes the moment the category does, and a stale number on a card is
  // worse than no number.
  const category = asCategory(str(p.props["Category"]));
  const repId = rel(p.props["Representative Variant"])[0] ?? null;
  const probed = variantCostsFor(p);
  const own = variants.filter((v) => rel(v.props["Product"]).includes(p.id));
  const needsRepresentative = category === "wall_art" && !repId;
  // brand on line one, the specific product on line two — a hand-typed
  // Short Name goes whole onto line two under the blueprint's brand
  const brandLine = cleanBrand(str(p.props["Blueprint Brand"])) || "Generic";
  const productLine =
    str(p.props["Short Name"]).trim() ||
    [shortProductWord(str(p.props["Blueprint Title"]) || p.title), str(p.props["Blueprint Model"])]
      .filter(Boolean)
      .join(" ");
  return {
    id: p.id,
    name: p.title || "Untitled product",
    brandLine,
    productLine,
    blueprintTitle: str(p.props["Blueprint Title"]),
    technique: str(p.props["Print Technique"]) || null,
    blueprintId: num(p.props["Printify Blueprint ID"]),
    providerId: num(p.props["Printify Print Provider ID"]),
    providerName: str(p.props["Print Provider Name"]),
    maxW: num(p.props["Max Print Width px"]),
    maxH: num(p.props["Max Print Height px"]),
    printDpi: num(p.props["Print DPI"]),
    ratios: str(p.props["Aspect Ratios"]),
    recompose: Boolean(p.props["Recomposition Flag"]),
    costMin: num(p.props["Base Cost Min"]),
    costMax: num(p.props["Base Cost Max"]),
    variantCount: num(p.props["Variant Count"]),
    // Colours is the number actually used for work — the Library, L4 and
    // L5 all think in colours, never in colour × size rows. Computed from
    // the cached variants so it can't drift from what those screens see.
    colourCount: new Set(own.map((v) => str(v.props["Color"]).trim().toLowerCase()).filter(Boolean)).size,
    sizeCount: new Set(own.map((v) => str(v.props["Size"]).trim().toLowerCase()).filter(Boolean)).size,
    syncedAt: str(p.props["Synced At"]) || null,
    hasVoiceText: str(p.props["Shop Voice Text"]).trim().length > 0,
    voiceText: str(p.props["Shop Voice Text"]),
    imageUrl: str(p.props["Blueprint Image"]) || null,
    category,
    // stored, not recomputed at render — Notion carries the estimate and the
    // method that produced it; estimateFor() only runs when inputs change
    estimatedCost: num(p.props["Estimated Cost"]),
    costMethod: str(p.props["Cost Calc Method"]) || null,
    costVariantCount: num(p.props["Estimated Cost Variant Count"]),
    costPulledAt: str(p.props["Cost Pulled At"]) || null,
    costReason: num(p.props["Estimated Cost"]) != null ? null : estimateFor(p).reason,
    estimatedShippingCost: num(p.props["Estimated Shipping Cost"]),
    shippingPulledAt: str(p.props["Shipping Pulled At"]) || null,
    // what the BUYER pays, from the Etsy profile this product is pointed at
    // — the other side of the shipping coin from the Printify cost above
    etsyShippingProfileId: etsyProfileId(p),
    etsyShippingCharged: (() => {
      const linked = etsyProfileId(p);
      const rec = linked ? cachedRecords("shipping_profiles").find((s) => s.id === linked) : null;
      return rec ? usDomesticCharge(rec) : null;
    })(),
    highlightsSizingGraphicLink: str(p.props["Highlights & Sizing Graphic Link"]),
    carePoliciesGraphicLink: str(p.props["Care & Policies Graphic Link"]),
    colorwaysGraphicLink: str(p.props["Colorways Graphic Link"]),
    needsRepresentative,
    representativeVariantId: repId,
    hasCosts: probed.size > 0 || own.some((v) => num(v.props["Base Cost"]) != null),
    // the picker's options — only wall_art cards render it
    variantOptions:
      category === "wall_art"
        ? own
            .map((v) => ({
              id: v.id,
              label: [
                str(v.props["Size"]) || v.title,
                (() => {
                  const cost =
                    num(v.props["Base Cost"]) ??
                    probed.get(String(v.props["Printify Variant ID"] ?? "")) ??
                    null;
                  return cost != null ? `$${cost.toFixed(2)}` : null;
                })(),
              ]
                .filter(Boolean)
                .join(" — "),
            }))
            .filter((v, i, arr) => arr.findIndex((x) => x.label === v.label) === i)
        : [],
  };
  });
}

/* ---------- step runner ---------- */

/**
 * Largest print area on the design's primary product — the bar the exported
 * master has to clear. Artwork bigger than this scales down losslessly;
 * smaller gets upscaled by Printify and prints soft.
 */
function requiredEdge(rec: SimpleRecord): number | null {
  const raw = str(rec.props["Master Canvas (JSON)"]);
  if (!raw.trim()) return null;
  try {
    const areas = JSON.parse(raw) as Array<{ maxWidth?: number; maxHeight?: number }>;
    const edges = areas.flatMap((a) => [a.maxWidth ?? 0, a.maxHeight ?? 0]);
    const max = Math.max(0, ...edges);
    return max > 0 ? max : null;
  } catch {
    return null;
  }
}

function masterResolutionOk(rec: SimpleRecord): boolean {
  const w = num(rec.props["Master Width"]);
  const h = num(rec.props["Master Height"]);
  const need = requiredEdge(rec);
  if (!w || !h) return false; // not recorded yet
  if (!need) return true; // no canvas to check against
  return Math.max(w, h) >= need;
}

function masterResolutionLabel(rec: SimpleRecord): string {
  const w = num(rec.props["Master Width"]);
  const h = num(rec.props["Master Height"]);
  const need = requiredEdge(rec);
  if (!w || !h) return "Master dimensions recorded";
  if (need && Math.max(w, h) < need) {
    return `Master ${w}×${h} is under the ${need}px print area — will upscale`;
  }
  return `Master resolution clears the print area (${w}×${h})`;
}

export function runnerRecord(rec: SimpleRecord): RunnerRecord {
  const state = parseStepState(rec);
  const steps: RunnerRecord["steps"] = {};
  for (const [id, entry] of Object.entries(state.steps)) steps[id] = entry;

  const gates: Array<{ label: string; ok: boolean; fixStep?: string }> = [];
  if (rec.dbKey === "etsy_listings") {
    // L6 publish gates (spec §6.1) — computed in publishGates.ts, the ONE
    // place the panel and the step engine both read, so they can't drift
    gates.push(...publishGates(rec));
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
        label: masterResolutionLabel(rec),
        ok: masterResolutionOk(rec),
      },
      {
        label: "Trademark screening confirmed",
        ok: niche ? str(niche.props["Screening Status"]) === "Screened clear" : false,
      },
      // set at C8 — the listing can't publish without it
      {
        label:
          str(rec.props["Garment Compatibility"]) && str(rec.props["Garment Compatibility"]) !== "Unset"
            ? `Garment compatibility: ${str(rec.props["Garment Compatibility"])}`
            : "Garment compatibility not set.",
        ok:
          Boolean(str(rec.props["Garment Compatibility"])) &&
          str(rec.props["Garment Compatibility"]) !== "Unset",
      }
    );
  }

  // per-step hard blockers, so the button can explain itself before you click
  const blockedDone: Record<string, string> = {};
  for (const step of WORKFLOWS[rec.dbKey === "designs" ? "creative" : "listing"].steps) {
    const reason = unmetRequirement(rec, step.id);
    if (reason) blockedDone[step.id] = reason;
  }

  return {
    id: rec.id,
    title: rec.title || "Untitled",
    blockedDone,
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
  nextUp: Array<{ label: string; why: string; href: string }>;
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

  // Step ids are unique across workflows (C*/L*) — resolve to runner titles.
  const titleOfStep = (id: string): string => {
    for (const wf of [WORKFLOWS.creative, WORKFLOWS.listing]) {
      const s = wf.steps.find((x) => x.id === id);
      if (s) return s.title;
    }
    return id;
  };
  const recentMoves = logs
    .slice()
    .sort((a, b) => str(b.props["At"]).localeCompare(str(a.props["At"])))
    .slice(0, 8)
    .map((l) => {
      const rawEvent = str(l.props["Event"]) === "Created" ? "Created new" : str(l.props["Event"]);
      const from = str(l.props["From Step"]);
      const to = str(l.props["To Step"]);
      // speak in step names, as the runner does — "Input branch done",
      // not "Step done (C1 → C2)"
      // step id kept alongside the title — "✓ C1 Input branch done" reads
      // as the rail does, and the ✓ matches the greenlit/done chip glyph
      const label = (id: string) => (id ? `${id} ${titleOfStep(id)}` : "");
      let event = rawEvent;
      switch (rawEvent) {
        case "Step done":
          event = from ? `✓ ${label(from)} done` : "✓ Step done";
          break;
        case "Backtrack":
          event = to ? `Backtracked to ${label(to)}` : "Backtrack";
          break;
        case "Still valid":
          event = to ? `✓ ${label(to)} still valid` : "✓ Still valid";
          break;
        case "Blocked":
          event = to ? `Blocked at ${label(to)}` : "Blocked";
          break;
        case "Unblocked":
          event = to ? `Unblocked at ${label(to)}` : "Unblocked";
          break;
        case "Moved":
          event = to ? `Moved to ${label(to)}` : "Moved";
          break;
        case "Created new":
          event = to ? `Created new at ${label(to)}` : "Created new";
          break;
      }
      // page titles carry an " — event" suffix; show the record name alone
      const cut = l.title.lastIndexOf(" — ");
      const name = cut > 0 ? l.title.slice(0, cut) : l.title;
      return { id: l.id, name, event, detail: "", at: str(l.props["At"]) };
    });

  // ---- Next up: what to work on, in priority order, three items max ----
  // Rule-based on workflow state — no model call, no guessing. Order:
  // blocked (dead until touched) → stale (invalidated work) → occasion
  // deadlines → the active record's current step → greenlit niches without
  // a design → inbox triage when it piles up.
  const nextUp: TodaySummary["nextUp"] = [];
  const recordHref = (r: SimpleRecord) =>
    r.dbKey === "designs" ? `/designs/${r.id}` : `/listings/${r.id}`;
  const stepTitle = (r: SimpleRecord) => {
    const wf = WORKFLOWS[r.dbKey === "designs" ? "creative" : "listing"];
    const cur = str(r.props["Current Step"]);
    return wf.steps.find((s) => s.id === cur)?.title ?? cur;
  };

  for (const r of [...designs, ...listings]) {
    if (r.props["Has Blocked"]) {
      nextUp.push({
        label: `Unblock ${r.title || "Untitled"}`,
        why: "blocked — nothing moves until the named condition clears",
        href: recordHref(r),
      });
    }
  }
  for (const r of [...designs, ...listings]) {
    if (r.props["Has Stale"] && !r.props["Has Blocked"]) {
      nextUp.push({
        label: `Redo or confirm stale steps on ${r.title || "Untitled"}`,
        why: "a backtrack invalidated downstream work — redo it or mark it still valid",
        href: recordHref(r),
      });
    }
  }
  for (const i of ideas) {
    const by = str(i.props["Enter Creative By"]);
    if (str(i.props["Status"]) === "Inbox" && by && new Date(by).getTime() - Date.now() < 7 * 86400_000) {
      nextUp.push({
        label: `Promote "${i.title}" now`,
        why: `must enter creative by ${by} to make its occasion`,
        href: "/inbox",
      });
    }
  }
  for (const r of [...designs, ...listings]) {
    const cur = str(r.props["Current Step"]);
    if (r.props["Has Blocked"] || r.props["Has Stale"]) continue;
    if (!cur || cur === "Done" || cur === "Pushed") continue;
    nextUp.push({
      label: `${r.title || "Untitled"}: do ${cur} — ${stepTitle(r)}`,
      why: "the active record's next step",
      href: recordHref(r),
    });
  }
  for (const name of greenlitWaiting) {
    nextUp.push({
      label: `Start a design for ${name}`,
      why: "greenlit but nothing in creative yet",
      href: "/inbox",
    });
  }
  const inboxCount = ideas.filter((i) => str(i.props["Status"]) === "Inbox").length;
  if (inboxCount >= 5) {
    nextUp.push({
      label: `Triage the inbox — ${inboxCount} ideas waiting`,
      why: "capture is one action; triage weekly",
      href: "/inbox",
    });
  }

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
    inboxCount,
    urgentIdeas: urgent,
    recentMoves,
    greenlitWaiting,
    nextUp: nextUp.slice(0, 3),
  };
}
