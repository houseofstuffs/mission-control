"use client";

/**
 * L4 — generate mockups. The automated pipeline plus its review gate.
 *
 * Generate runs the server-side job (src/server/mockup/generateJob.ts):
 * the SAME renderMockup module the Test render button always used, looped
 * over the shared plan (src/server/mockup/plan.ts), surviving navigation
 * like the Drive import does. Tiles join their generated_mockups record —
 * image through the stable file route, verdict persisted on the record.
 *
 * Approve-by-default is deliberate: the operator flags the misses, rather
 * than clicking through a dozen good ones to bless each.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Kicker, Spinner } from "./ui";
import { apiCall, apiJson } from "@/lib/api";
import { CropAdjustModal } from "./CropAdjustModal";
import { PlacementModal } from "./PlacementModal";
import { CARD_DEFAULTS, CARD_MAX_CELLS, CARD_ROWS, type PlacementMap, type Quad } from "@/config/mockups";

export interface MockupTile {
  /** the variant behind this tile — the unique key; templateId is the GROUP */
  variantId: string;
  /** the SHOT the variant belongs to — tiles group under it in the review grid */
  templateId: string;
  templateName: string;
  shotType: string;
  colour: string;
  /** the variant's print region — the placement preview draws inside it */
  quad: Quad | null;
  /** the render, through the stable file route. Null = not generated yet. */
  url: string | null;
  /** the generated_mockups record behind the url */
  generatedId: string | null;
  /** persisted verdict; null until a render exists */
  verdict: "Approved" | "Flagged" | null;
  /** the slot position currently holding this render; null = not placed */
  placedInSlot: number | null;
}

export interface GenerateJobView {
  status: "running" | "complete" | "interrupted";
  total: number;
  done: number;
  rendered: number;
  results: Array<{ name: string; detail: string; ok: boolean }>;
}

export interface MockupsData {
  listingId: string;
  ready: {
    printifyProduct: boolean;
    psdMaster: boolean;
    /** distinct TEMPLATES contributing to the plan — house terminology:
     *  template = the shot, variant = template×colour. Counting variants
     *  under a "templates" label printed "6 templates" with 2 assigned. */
    templatesInPlay: number;
    /** colour variants usable for this listing (the L5 filter, reused) */
    variantCount: number;
    colours: string[];
  };
  tiles: MockupTile[];
  /** compatible templates, with what each contributes to THIS listing */
  allTemplates: Array<{
    id: string;
    name: string;
    shotType: string;
    thumbUrl: string | null;
    printRegionQuad: Array<{ x: number; y: number }> | null;
    /** the listing colours this template can produce, display-cased */
    coverage: string[];
    /** mockups it yields for this listing (one variant per colour) */
    yield: number;
    /** exists in exactly one colour — the amber lock */
    colourLocked: boolean;
    hasGeometry: boolean;
  }>;
  /** templates for OTHER products, hidden from the picker */
  hidden: { count: number; example: string | null };
  /** the compositor's last known run for this listing */
  generateJob: GenerateJobView | null;
  productName: string | null;
  /** template ids assigned to THIS listing — drives the plan and L5's offers */
  shortlist: string[];
  /** the Product's reusable graphics — built once per blueprint, not per
   *  listing. url null = expected by the slot plan but not built yet; that
   *  absence renders as a "needed" pill, never silence. */
  infoGraphics: Array<{ label: string; url: string | null }>;
  /** per-colour design masters, NORMALIZED colour → link. Colours absent
   *  here render from the design's Master PNG Link. */
  artOverrides: Record<string, string>;
  /** the design behind this listing — the master link edits IN PLACE at
   *  L4, because the review grid is where art × garment judgments happen */
  designId: string | null;
  masterLink: string;
  /** how the design sits in the print region — default + per-variant */
  placement: PlacementMap;
  /** the REAL print area: px from Printify, inches derived as px / DPI */
  printArea: {
    wPx: number | null;
    hPx: number | null;
    wIn: number | null;
    hIn: number | null;
    dpi: number;
    /** 300 was assumed because the product sets no Print DPI — readouts say so */
    dpiAssumed: boolean;
  };
}

type Verdict = "approved" | "flagged";

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

const READY_LABEL: Array<[keyof MockupsData["ready"], string]> = [
  ["printifyProduct", "Printify product"],
  ["psdMaster", "Design master"],
  ["colours", "Mockup colours"],
];

/** the sketch's thumbnail: sample image with the print-region quad's
 *  bounding box drawn as a dashed overlay */
function TemplateThumb({ t }: { t: MockupsData["allTemplates"][number] }) {
  const q = t.printRegionQuad;
  const box = q
    ? {
        left: `${Math.min(...q.map((p) => p.x)) * 100}%`,
        top: `${Math.min(...q.map((p) => p.y)) * 100}%`,
        width: `${(Math.max(...q.map((p) => p.x)) - Math.min(...q.map((p) => p.x))) * 100}%`,
        height: `${(Math.max(...q.map((p) => p.y)) - Math.min(...q.map((p) => p.y))) * 100}%`,
      }
    : null;
  return (
    <span
      style={{
        width: 44,
        height: 44,
        borderRadius: 8,
        background: "var(--surface-sunk, #f4efe2)",
        position: "relative",
        flex: "none",
        overflow: "hidden",
        display: "inline-block",
      }}
    >
      {t.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
      {box ? (
        <span
          style={{
            position: "absolute",
            ...box,
            border: "1.4px dashed rgba(255,255,255,0.75)",
            borderRadius: 3,
            mixBlendMode: "difference",
          }}
        />
      ) : null}
    </span>
  );
}

export function GenerateMockupsPanel({ data }: { data: MockupsData }) {
  const router = useRouter();
  // Selection lives HERE so the plan card recomputes live as templates are
  // ticked (the sketch's behaviour) — the saved shortlist stays the server
  // truth, and a dirty selection previews with an UNSAVED marker.
  const [picked, setPicked] = useState<Set<string>>(new Set(data.shortlist));
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const dirty = JSON.stringify([...picked].sort()) !== JSON.stringify(data.shortlist.slice().sort());

  async function saveAssignment() {
    setAssignBusy(true);
    setAssignError(null);
    const res = await apiJson(`/api/listings/${data.listingId}`, "PATCH", {
      templateShortlist: [...picked],
    });
    if (!res.ok) setAssignError(res.error);
    else router.refresh();
    setAssignBusy(false);
  }

  // the LIVE plan: sum of picked templates' yields. Matches the server's
  // tile derivation once saved (one variant per colour post-dedupe).
  const pickedTemplates = data.allTemplates.filter((t) => picked.has(t.id));
  const liveMockups = pickedTemplates.reduce((n, t) => n + t.yield, 0);

  // only built graphics count toward the plan — a missing one is a pill
  // below, not a phantom in the sum
  const builtGraphics = data.infoGraphics.filter((g) => g.url).length;

  // ---- the compositor run: start + poll, same shape as the Drive import ----
  const [job, setJob] = useState<GenerateJobView | null>(data.generateJob);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  useEffect(() => {
    if (job?.status !== "running") return;
    const timer = setInterval(async () => {
      const res = await apiCall<{ job?: GenerateJobView | null }>(`/api/listings/${data.listingId}/generate`);
      if (res.ok && res.data.job) {
        setJob(res.data.job);
        if (res.data.job.status !== "running") router.refresh();
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, data.listingId]);

  async function generate(opts: { regenerate?: boolean; onlyFlagged?: boolean }) {
    setGenBusy(true);
    setGenError(null);
    const res = await apiJson<{ job?: GenerateJobView }>(`/api/listings/${data.listingId}/generate`, "POST", opts);
    if (!res.ok) setGenError(res.error);
    else if (res.data.job) setJob(res.data.job);
    setGenBusy(false);
  }

  // ---- design artwork: the master edits HERE (the review grid is where
  // art × garment judgments happen), plus per-colour exceptions ----
  const normColour = (c: string) => c.trim().toLowerCase();
  const [artOpen, setArtOpen] = useState(Object.keys(data.artOverrides).length > 0);
  const [masterDraft, setMasterDraft] = useState(data.masterLink);
  const [artDraft, setArtDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const c of data.ready.colours) d[c] = data.artOverrides[normColour(c)] ?? "";
    return d;
  });
  const [artBusy, setArtBusy] = useState(false);
  const [artError, setArtError] = useState<string | null>(null);
  const [artSavedAt, setArtSavedAt] = useState<string | null>(null);
  const masterDirty = masterDraft.trim() !== data.masterLink;
  const artDirty =
    masterDirty ||
    data.ready.colours.some((c) => (artDraft[c] ?? "").trim() !== (data.artOverrides[normColour(c)] ?? ""));

  async function saveArtwork() {
    setArtBusy(true);
    setArtError(null);
    // the master lives on the DESIGN record — same field C7 saves, same
    // staleness ripple (derivatives flip stale on a master change)
    if (masterDirty && data.designId) {
      const res = await apiJson(`/api/designs/${data.designId}`, "PATCH", { artworkLink: masterDraft.trim() });
      if (!res.ok) {
        setArtError(res.error);
        setArtBusy(false);
        return;
      }
    }
    const overrides: Record<string, string> = {};
    for (const c of data.ready.colours) {
      const link = (artDraft[c] ?? "").trim();
      if (link) overrides[c] = link;
    }
    const res = await apiJson(`/api/listings/${data.listingId}`, "PATCH", { artOverrides: overrides });
    if (!res.ok) setArtError(res.error);
    else {
      const n = Object.keys(overrides).length;
      setArtSavedAt(
        [masterDirty ? "master updated" : null, `${n} ${n === 1 ? "override" : "overrides"}`].filter(Boolean).join(" · ")
      );
      router.refresh();
    }
    setArtBusy(false);
  }

  // Verdicts persist on the generated record; the local map is only an
  // optimistic overlay while a PATCH is in flight.
  const [verdictOverride, setVerdictOverride] = useState<Record<string, Verdict>>({});
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendReport, setSendReport] = useState<Array<{
    name: string;
    detail: string;
    ok: boolean;
    skipped?: boolean;
    suggestion?: { slotId: string; position: number; label: string; slotShotType: string };
    generatedId?: string;
  }> | null>(null);
  /** selective send — one template's renders instead of everything */
  const [sendTemplate, setSendTemplate] = useState<string>("");

  // ---- crop adjust: fix the frame where the miss is SEEN ----
  const [cropTile, setCropTile] = useState<MockupTile | null>(null);
  const [cropNote, setCropNote] = useState<string | null>(null);

  // ---- the branded colour card: pick tiles in order → build → SEE it →
  // then the slot. Supersedes the plain grid composite — every colour
  // grid the shop ships carries the title, labels and footer line.
  const [gridTemplate, setGridTemplate] = useState<string>("");
  const [gridPicked, setGridPicked] = useState<string[]>([]); // generatedIds, in cell order
  const [gridBusy, setGridBusy] = useState(false);
  const [gridNote, setGridNote] = useState<string | null>(null);
  // card failures surface HERE, in this block — a failed BUILD must
  // never read as a failed generate RUN
  const [gridError, setGridError] = useState<string | null>(null);
  const [cardLayout, setCardLayout] = useState<string>("auto");
  const [cardTitle, setCardTitle] = useState(CARD_DEFAULTS.title);
  const [cardFooter, setCardFooter] = useState(CARD_DEFAULTS.footer);
  const [cardEmail, setCardEmail] = useState(CARD_DEFAULTS.email);
  const [cardStaged, setCardStaged] = useState<{
    recordId: string; url: string; layout: string; cells: string[]; title: string; hasSlot: boolean; openSlots: number;
  } | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("stuffs.cardText") ?? "{}");
      if (typeof saved.title === "string" && saved.title) setCardTitle(saved.title);
      if (typeof saved.footer === "string") setCardFooter(saved.footer);
      if (typeof saved.email === "string") setCardEmail(saved.email);
    } catch { /* stale setting — defaults stand */ }
  }, []);

  const cardRowsLabel = (n: number) => (CARD_ROWS[n] ? CARD_ROWS[n].join("+") : "?");
  const cardNeed = cardLayout === "auto" ? gridPicked.length : Number(cardLayout);

  function toggleGridTile(generatedId: string) {
    setGridPicked((cur) =>
      cur.includes(generatedId) ? cur.filter((x) => x !== generatedId) : [...cur, generatedId]
    );
  }

  async function buildCard() {
    setGridBusy(true);
    setGridNote(null);
    setGridError(null);
    window.localStorage.setItem("stuffs.cardText", JSON.stringify({ title: cardTitle, footer: cardFooter, email: cardEmail }));
    // a rebuild replaces the staged record — archive the old one so a
    // series never accumulates orphaned staged cards
    if (cardStaged) {
      await apiJson(`/api/listings/${data.listingId}/colour-card`, "POST", { discardRecordId: cardStaged.recordId });
      setCardStaged(null);
    }
    const res = await apiJson<{
      recordId?: string; url?: string; layout?: string; cells?: string[]; title?: string; hasSlot?: boolean; openSlots?: number;
    }>(
      `/api/listings/${data.listingId}/colour-card`,
      "POST",
      {
        generatedIds: gridPicked,
        layout: cardLayout === "auto" ? undefined : Number(cardLayout),
        title: cardTitle,
        footer: cardFooter,
        email: cardEmail,
      },
      180_000
    );
    if (!res.ok) setGridError(res.error);
    else {
      setCardStaged({
        recordId: res.data.recordId!,
        url: res.data.url!,
        layout: res.data.layout ?? "",
        cells: res.data.cells ?? [],
        title: res.data.title ?? cardTitle,
        hasSlot: res.data.hasSlot ?? true,
        openSlots: res.data.openSlots ?? 0,
      });
    }
    setGridBusy(false);
  }

  async function assignCard() {
    if (!cardStaged) return;
    setGridBusy(true);
    const res = await apiJson<{ slot?: { position: number; label: string } }>(
      `/api/listings/${data.listingId}/colour-card`,
      "POST",
      { assignRecordId: cardStaged.recordId }
    );
    if (!res.ok) setGridError(res.error);
    else {
      setGridNote(
        `✓ colour card placed — ${cardStaged.cells.length} colours (${cardStaged.cells.join(" → ")}) · ${cardStaged.layout} · "${cardStaged.title}" · slot ${res.data.slot?.position ?? "?"} (${res.data.slot?.label ?? "grid"})`
      );
      setCardStaged(null);
      setGridPicked([]);
      router.refresh();
    }
    setGridBusy(false);
  }

  async function discardCard() {
    if (!cardStaged) return;
    setGridBusy(true);
    await apiJson(`/api/listings/${data.listingId}/colour-card`, "POST", { discardRecordId: cardStaged.recordId });
    setCardStaged(null);
    setGridBusy(false);
  }

  // ---- print close-up: zoom into a render's PRINT REGION ----
  interface CuPreset { key: string; label: string; outPx: number; ok: boolean; reason: string | null }
  const [cuPicked, setCuPicked] = useState<string | null>(null); // generatedId
  const [cuOpts, setCuOpts] = useState<{ sourcePx: number; presets: CuPreset[] } | null>(null);
  const [cuTightness, setCuTightness] = useState<string>("");
  const [cuBusy, setCuBusy] = useState(false);
  const [cuError, setCuError] = useState<string | null>(null);
  const [cuNote, setCuNote] = useState<string | null>(null);
  const [cuStaged, setCuStaged] = useState<{
    recordId: string; url: string; source: string; colour: string; tightness: string; outPx: number; hasSlot: boolean;
  } | null>(null);

  async function pickCloseupTile(generatedId: string) {
    if (cuPicked === generatedId) { setCuPicked(null); setCuOpts(null); return; }
    setCuPicked(generatedId);
    setCuOpts(null);
    setCuError(null);
    setCuBusy(true);
    const res = await apiJson<{ sourcePx?: number; presets?: CuPreset[] }>(
      `/api/listings/${data.listingId}/print-closeup`, "POST", { optionsFor: generatedId });
    if (!res.ok) setCuError(res.error);
    else {
      const presets = res.data.presets ?? [];
      setCuOpts({ sourcePx: res.data.sourcePx ?? 0, presets });
      // default to the middle setting when it's honest, else the widest honest one
      const pick = presets.find((p) => p.key === "mid" && p.ok) ?? presets.find((p) => p.ok);
      setCuTightness(pick?.key ?? "");
    }
    setCuBusy(false);
  }

  async function buildCloseup() {
    if (!cuPicked || !cuTightness) return;
    setCuBusy(true);
    setCuError(null);
    setCuNote(null);
    const res = await apiJson<{
      recordId?: string; url?: string; source?: string; colour?: string; tightness?: string; outPx?: number; hasSlot?: boolean;
    }>(`/api/listings/${data.listingId}/print-closeup`, "POST", { generatedId: cuPicked, tightness: cuTightness }, 240_000);
    if (!res.ok) setCuError(res.error);
    else setCuStaged({
      recordId: res.data.recordId!, url: res.data.url!, source: res.data.source ?? "render",
      colour: res.data.colour ?? "", tightness: res.data.tightness ?? cuTightness,
      outPx: res.data.outPx ?? 0, hasSlot: res.data.hasSlot ?? true,
    });
    setCuBusy(false);
  }

  async function assignCloseup() {
    if (!cuStaged) return;
    setCuBusy(true);
    const res = await apiJson<{ slot?: { position: number; label: string } }>(
      `/api/listings/${data.listingId}/print-closeup`, "POST", { assignRecordId: cuStaged.recordId });
    if (!res.ok) setCuError(res.error);
    else {
      setCuNote(
        `✓ print close-up placed — from ${cuStaged.source} (${cuStaged.colour}) · ${cuStaged.tightness} crop · ${cuStaged.outPx}px · slot ${res.data.slot?.position ?? "?"} (${res.data.slot?.label ?? "closeup"})`
      );
      setCuStaged(null);
      router.refresh();
    }
    setCuBusy(false);
  }

  async function discardCloseup() {
    if (!cuStaged) return;
    setCuBusy(true);
    await apiJson(`/api/listings/${data.listingId}/print-closeup`, "POST", { discardRecordId: cuStaged.recordId });
    setCuStaged(null);
    setCuBusy(false);
  }

  // ---- artwork detail: the design alone, from the MASTER, watermarked ----
  const [awWmOn, setAwWmOn] = useState(true);
  const [awWmOpacity, setAwWmOpacity] = useState(9); // percent
  const [awBusy, setAwBusy] = useState(false);
  const [awError, setAwError] = useState<string | null>(null);
  const [awNote, setAwNote] = useState<string | null>(null);
  const [awPreviews, setAwPreviews] = useState<{
    dark: string; light: string; outPx: number; floorOk: boolean; reason: string | null;
  } | null>(null);
  const [awLastBg, setAwLastBg] = useState<"dark" | "light">("dark");
  const [awStaged, setAwStaged] = useState<{
    recordId: string; url: string; outPx: number; background: string; hasSlot: boolean;
  } | null>(null);
  useEffect(() => {
    const saved = window.localStorage.getItem("stuffs.artworkBg");
    if (saved === "dark" || saved === "light") setAwLastBg(saved);
    const wm = window.localStorage.getItem("stuffs.artworkWm");
    if (wm) {
      try {
        const p = JSON.parse(wm);
        if (typeof p.on === "boolean") setAwWmOn(p.on);
        if (Number.isFinite(p.opacity)) setAwWmOpacity(p.opacity);
      } catch { /* stale setting — defaults stand */ }
    }
  }, []);
  const awWm = () => ({ on: awWmOn, opacity: awWmOpacity / 100 });

  async function previewArtwork() {
    setAwBusy(true);
    setAwError(null);
    setAwNote(null);
    setAwStaged(null);
    window.localStorage.setItem("stuffs.artworkWm", JSON.stringify({ on: awWmOn, opacity: awWmOpacity }));
    const res = await apiJson<{
      dark?: string; light?: string; outPx?: number; floorOk?: boolean; reason?: string | null;
    }>(`/api/listings/${data.listingId}/artwork-detail`, "POST", { previews: true, watermark: awWm() }, 240_000);
    if (!res.ok) setAwError(res.error);
    else setAwPreviews({
      dark: res.data.dark ?? "", light: res.data.light ?? "",
      outPx: res.data.outPx ?? 0, floorOk: res.data.floorOk ?? false, reason: res.data.reason ?? null,
    });
    setAwBusy(false);
  }

  async function buildArtwork(background: "dark" | "light") {
    setAwBusy(true);
    setAwError(null);
    setAwLastBg(background);
    window.localStorage.setItem("stuffs.artworkBg", background);
    const res = await apiJson<{
      recordId?: string; url?: string; outPx?: number; background?: string; hasSlot?: boolean;
    }>(`/api/listings/${data.listingId}/artwork-detail`, "POST", { background, watermark: awWm() }, 240_000);
    if (!res.ok) setAwError(res.error);
    else setAwStaged({
      recordId: res.data.recordId!, url: res.data.url!, outPx: res.data.outPx ?? 0,
      background: res.data.background ?? background, hasSlot: res.data.hasSlot ?? true,
    });
    setAwBusy(false);
  }

  async function assignArtwork() {
    if (!awStaged) return;
    setAwBusy(true);
    const res = await apiJson<{ slot?: { position: number; label: string } }>(
      `/api/listings/${data.listingId}/artwork-detail`, "POST", { assignRecordId: awStaged.recordId });
    if (!res.ok) setAwError(res.error);
    else {
      setAwNote(
        `✓ artwork detail placed — from the design master · ${awStaged.background} background · watermark ${awWmOn ? `on (${awWmOpacity}%)` : "off"} · ${awStaged.outPx}px · slot ${res.data.slot?.position ?? "?"} (${res.data.slot?.label ?? "artwork"})`
      );
      setAwStaged(null);
      setAwPreviews(null);
      router.refresh();
    }
    setAwBusy(false);
  }

  async function discardArtwork() {
    if (!awStaged) return;
    setAwBusy(true);
    await apiJson(`/api/listings/${data.listingId}/artwork-detail`, "POST", { discardRecordId: awStaged.recordId });
    setAwStaged(null);
    setAwBusy(false);
  }

  // ---- placement: how the design sits in the region ----
  const [placeTile, setPlaceTile] = useState<MockupTile | null>(null);

  async function onPlaceSaved(scope: "all" | "variant", variantId: string) {
    setPlaceTile(null);
    setCropNote(`✓ placement saved · regenerating ${scope === "all" ? "all tiles" : "the tile"}…`);
    const res = await apiJson<{ job?: GenerateJobView }>(
      `/api/listings/${data.listingId}/generate`,
      "POST",
      scope === "all" ? { regenerate: true } : { variantIds: [variantId] }
    );
    if (!res.ok) setGenError(res.error);
    else if (res.data.job) setJob(res.data.job);
    router.refresh();
  }

  async function onCropSaved(variantId: string, result: { size: number; quad: string }) {
    setCropTile(null);
    setCropNote(
      result.quad === "remapped"
        ? `✓ re-cropped → ${result.size}px · print region re-mapped · regenerating…`
        : result.quad === "remapped-clipped"
          ? `✓ re-cropped → ${result.size}px · ⚠ print region fell partly outside the new frame — check the render, corners may need a re-place`
          : `✓ re-cropped → ${result.size}px · ⚠ print region could NOT be re-mapped — re-place corners on this variant`
    );
    // regenerate exactly what was re-framed — this listing's tiles for
    // that variant (other listings regenerate on their own pages)
    const res = await apiJson<{ job?: GenerateJobView }>(`/api/listings/${data.listingId}/generate`, "POST", {
      variantIds: [variantId],
    });
    if (!res.ok) setGenError(res.error);
    else if (res.data.job) setJob(res.data.job);
    router.refresh();
  }

  const key = (t: MockupTile) => `${t.variantId}:${t.colour}`;
  const verdictOf = (t: MockupTile): Verdict | null => {
    if (t.url === null || !t.generatedId) return null;
    return (
      verdictOverride[t.generatedId] ??
      (t.verdict === "Flagged" ? "flagged" : "approved")
    );
  };

  async function setVerdict(t: MockupTile, v: Verdict) {
    if (!t.generatedId) return;
    setVerdictOverride((cur) => ({ ...cur, [t.generatedId!]: v }));
    const res = await apiJson(`/api/generated-mockups/${t.generatedId}`, "PATCH", {
      verdict: v === "approved" ? "Approved" : "Flagged",
    });
    if (!res.ok) {
      setGenError(res.error);
      setVerdictOverride((cur) => {
        const next = { ...cur };
        delete next[t.generatedId!];
        return next;
      });
    }
  }

  async function sendApproved() {
    setSendBusy(true);
    setGenError(null);
    setSendReport(null);
    const res = await apiJson<{ results?: NonNullable<typeof sendReport> }>(
      `/api/listings/${data.listingId}/send-mockups`,
      "POST",
      sendTemplate ? { templateId: sendTemplate } : {},
      120_000
    );
    if (!res.ok) setGenError(res.error);
    else {
      setSendReport(res.data.results ?? []);
      router.refresh();
    }
    setSendBusy(false);
  }

  // one template across N colours is the point — candidates are approved
  // tiles of the chosen template, toggled in and out in cell order.
  // These live BELOW verdictOf on purpose: computing them above it was a
  // temporal-dead-zone crash that only fired once a listing HAD renders
  // (generatedId short-circuits first) — the margaritas listing broke
  // while the render-less t-shirt sailed.
  const gridTemplates = [...new Map(
    data.tiles.filter((t) => t.generatedId && verdictOf(t) === "approved").map((t) => [t.templateId, t.templateName])
  ).entries()];
  const gridCandidates = data.tiles.filter(
    (t) => t.generatedId && verdictOf(t) === "approved" && (!gridTemplate || t.templateId === gridTemplate)
  );

  const generated = data.tiles.filter((t) => t.url !== null);
  const approved = generated.filter((t) => verdictOf(t) === "approved");

  // ---- send accounting: the button counts what ISN'T placed yet ----
  const approvedToSend = approved.filter((t) => !sendTemplate || t.templateId === sendTemplate);
  const unplacedToSend = approvedToSend.filter((t) => !t.placedInSlot);
  const sendableTemplates = [...new Map(approved.map((t) => [t.templateId, t.templateName])).entries()];

  async function assignSuggestion(
    generatedId: string,
    suggestion: { slotId: string; position: number; label: string }
  ) {
    setSendBusy(true);
    const res = await apiJson<{ results?: NonNullable<typeof sendReport> }>(
      `/api/listings/${data.listingId}/send-mockups`,
      "POST",
      { assign: { generatedId, slotId: suggestion.slotId } }
    );
    if (!res.ok) setGenError(res.error);
    else {
      // the retargeted line replaces its failed original in the report
      setSendReport((cur) =>
        (cur ?? []).map((r) => (r.generatedId === generatedId ? { ...(res.data.results?.[0] ?? r) } : r))
      );
      router.refresh();
    }
    setSendBusy(false);
  }
  const flagged = generated.filter((t) => verdictOf(t) === "flagged");
  const attention = data.tiles.filter((t) => t.url === null || verdictOf(t) === "flagged");

  const blockers = [
    !data.ready.printifyProduct ? "no Printify product" : null,
    !data.ready.psdMaster ? "no design master" : null,
    data.allTemplates.length > 0 && data.shortlist.length === 0
      ? "no templates assigned to this listing (assign above)"
      : null,
    data.ready.variantCount === 0 ? "no colour variants for these colours" : null,
    data.ready.colours.length === 0 ? "no mockup colours" : null,
  ].filter(Boolean) as string[];

  const groups = useMemo(() => {
    const byTemplate = new Map<string, MockupTile[]>();
    for (const t of data.tiles) {
      const list = byTemplate.get(t.templateId) ?? [];
      list.push(t);
      byTemplate.set(t.templateId, list);
    }
    return [...byTemplate.values()];
  }, [data.tiles]);

  const shown = (t: MockupTile) => !onlyAttention || t.url === null || verdictOf(t) === "flagged";

  return (
    <div className="stack-12">
      {/* ready card FIRST (sketch order) — its template chip and plan line
          recompute LIVE from the picked set; dirty shows unsaved */}
      <div className="card supporting">
        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
          <Kicker>READY TO GENERATE</Kicker>
          <span className="row-gap-8" style={{ flexWrap: "wrap" }}>
            {READY_LABEL.map(([field, label]) => {
              const v = data.ready[field];
              const ok = typeof v === "number" ? v > 0 : Array.isArray(v) ? v.length > 0 : Boolean(v);
              // the design-master chip IS the way into the artwork editor —
              // swapping the master is a decision made while looking at
              // this grid, so the control lives on the chip, not at C7
              const opensArt = field === "psdMaster";
              if (opensArt) {
                // an ACTION chip must not dress like its read-only
                // neighbours — white fill, blue stroke, and the word
                // "edit" instead of a glyph that renders unevenly
                return (
                  <button
                    key={label}
                    type="button"
                    className="chip chip-link"
                    style={{ fontSize: 11 }}
                    title="Edit the design master / per-colour artwork"
                    onClick={() => setArtOpen(true)}
                  >
                    {ok ? "✓ " : "⚠ "}
                    {label} · edit
                  </button>
                );
              }
              return (
                <span
                  key={label}
                  className={`chip ${ok ? "done" : "stale"}`}
                  style={{ fontSize: 11 }}
                  title={field === "colours" && ok ? data.ready.colours.join(", ") : undefined}
                >
                  {ok ? "✓ " : ""}
                  {label}
                  {field === "colours" ? ` · ${data.ready.colours.length}` : ""}
                </span>
              );
            })}
            <span className={`chip ${picked.size > 0 ? "done" : "stale"}`} style={{ fontSize: 11 }}>
              {picked.size > 0 ? "✓ " : "⚠ "}Mockup templates · {picked.size}
              {dirty ? " · unsaved" : ""}
            </span>
          </span>
        </div>

        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
          <span className="body-sm">
            {picked.size === 0 ? (
              <>Pick at least one template below to generate.</>
            ) : blockers.length > 0 && !dirty ? (
              <>Can&apos;t generate yet — {blockers.join(", ")}.</>
            ) : (
              // live sum of the picked templates' yields — never a
              // multiplication (colour-locked templates count their one)
              <>
                <strong>{picked.size} {plural(picked.size, "template")}</strong> across your{" "}
                <strong>{data.ready.colours.length}</strong> {plural(data.ready.colours.length, "colour")} →{" "}
                <strong>{liveMockups} {plural(liveMockups, "mockup")}</strong> to generate
                {builtGraphics > 0 ? <> + {builtGraphics} info {builtGraphics === 1 ? "graphic" : "graphics"}</> : null}
                {dirty ? <span className="hint"> · unsaved — save below to apply</span> : null}
              </>
            )}
          </span>
          <span className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
            {flagged.length > 0 && job?.status !== "running" ? (
              // the flag IS the redo list — re-render only the misses
              <button
                className="btn btn-secondary"
                style={{ fontSize: 12 }}
                disabled={genBusy}
                title="Re-render only the flagged mockups — approved ones are left alone"
                onClick={() => generate({ onlyFlagged: true })}
              >
                ⟳ Regenerate flagged · {flagged.length}
              </button>
            ) : null}
            {generated.length > 0 && generated.length === data.tiles.length && job?.status !== "running" ? (
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 12 }}
                disabled={genBusy}
                title="Re-render every tile — replaces the existing images"
                onClick={() => {
                  if (window.confirm("Re-render all mockups? Existing renders are replaced.")) generate({ regenerate: true });
                }}
              >
                Regenerate all
              </button>
            ) : null}
            <button
              className="btn btn-primary"
              disabled={genBusy || job?.status === "running" || blockers.length > 0 || dirty}
              title={dirty ? "Save the template assignment first" : blockers.length > 0 ? blockers.join(", ") : undefined}
              onClick={() => generate({})}
            >
              {genBusy || job?.status === "running" ? <span className="spinner" /> : "⟳ "}
              Generate mockups
            </button>
          </span>
        </div>
        {job ? (
          <div className="stack-12" style={{ gap: 4 }}>
            {job.status === "running" ? (
              <span className="body-sm">
                Rendering on the server — {job.done}/{job.total} done. Safe to navigate away; progress
                lands on this listing either way.
              </span>
            ) : job.status === "interrupted" ? (
              <div className="callout blocked">
                Run interrupted at {job.done}/{job.total} ({job.rendered} rendered) — Generate again
                picks up only what&apos;s missing.
                {job.results.filter((r) => !r.ok).slice(0, 1).map((r) => (
                  <span key={r.name} style={{ display: "block" }}>✕ {r.name} — {r.detail}</span>
                ))}
              </div>
            ) : (
              <span className="body-sm">
                ✓ Run complete — {job.rendered} of {job.total} rendered.
                {job.total < data.tiles.length ? (
                  // "3 of 3" with 6 tiles on screen reads like a loss — say
                  // what the run actually targeted
                  <span className="hint">
                    {" "}
                    (this run targeted {job.total} of the plan&apos;s {data.tiles.length} tiles — only
                    missing, flagged or selected ones re-render)
                  </span>
                ) : null}
                {job.results.some((r) => !r.ok) ? " Failures listed below by tile." : ""}
              </span>
            )}
            {job.results.filter((r) => !r.ok).length > 0 && job.status !== "interrupted" ? (
              <div className="stack-12" style={{ gap: 2 }}>
                {job.results.filter((r) => !r.ok).map((r) => (
                  <span key={r.name + r.detail} className="hint" style={{ color: "var(--status-blocked, #b3423a)" }}>
                    ✕ {r.name} — {r.detail}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {genError ? <div className="callout blocked">{genError}</div> : null}
      </div>

      {/* design artwork — right under the ready card because the review
          grid is where art × garment-colour judgments happen. One control:
          the listing-level master (the design's own link, edited in place)
          plus per-colour exceptions. Printify prints per-variant art, so a
          colour whose art differs (dark-version eyes on Espresso) is a
          correctness fix, not a nicety. */}
      <div className="card supporting">
        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
          <Kicker>
            DESIGN ARTWORK · MASTER + PER-COLOUR
            {Object.keys(data.artOverrides).length > 0 ? ` · ${Object.keys(data.artOverrides).length} OVERRIDE${Object.keys(data.artOverrides).length === 1 ? "" : "S"}` : ""}
          </Kicker>
          <button className="btn btn-tertiary" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setArtOpen((v) => !v)}>
            {artOpen ? "Hide" : "Edit artwork"}
          </button>
        </div>
        {artOpen ? (
          <>
            <span className="hint">
              The master is the default for every colour; a colour with its own link renders from
              THAT instead. Swap → save → Regenerate the affected tiles. A master change also marks
              derivatives stale, same as editing it at C7.
            </span>
            <div className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <span className="body-sm" style={{ fontWeight: 700, width: 110, flex: "none" }}>Master · all</span>
              <input
                className="input"
                style={{ flex: "1 1 240px", fontSize: 12 }}
                placeholder="the design's Master PNG Link"
                value={masterDraft}
                disabled={!data.designId}
                onChange={(e) => {
                  setArtSavedAt(null);
                  setMasterDraft(e.target.value);
                }}
              />
            </div>
            {data.ready.colours.map((c) => (
              <div key={c} className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
                <span className="body-sm" style={{ fontWeight: 600, width: 110, flex: "none", paddingLeft: 12 }}>{c}</span>
                <input
                  className="input"
                  style={{ flex: "1 1 240px", fontSize: 12 }}
                  placeholder="uses the master — paste a Drive link to override"
                  value={artDraft[c] ?? ""}
                  onChange={(e) => {
                    setArtSavedAt(null);
                    setArtDraft((cur) => ({ ...cur, [c]: e.target.value }));
                  }}
                />
              </div>
            ))}
            {artError ? <div className="callout blocked">{artError}</div> : null}
            <div className="row-gap-8" style={{ alignItems: "center" }}>
              {artDirty ? (
                <button className="btn btn-save" style={{ fontSize: 12 }} onClick={saveArtwork} disabled={artBusy}>
                  <Spinner active={artBusy} />
                  Save artwork links
                </button>
              ) : null}
              {artSavedAt && !artDirty ? (
                <span className="hint" style={{ color: "var(--status-done, #3e7a4e)" }}>
                  ✓ {artSavedAt} — Regenerate the affected colours to apply
                </span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {/* the picker — rows with thumbnail, coverage and per-listing yield */}
      <div className="card supporting">
        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "baseline" }}>
          <Kicker>TEMPLATES FOR THIS LISTING</Kicker>
          <span className="body-sm" style={{ fontWeight: 700, color: "var(--status-done, #3e7a4e)" }}>
            {picked.size} of {data.allTemplates.length} selected
          </span>
        </div>
        <span className="hint">
          Pick the templates this listing uses. Only these feed the <strong>L5 slot pickers</strong>{" "}
          and set what gets generated.
          {data.productName ? <> Showing templates compatible with <strong>{data.productName}</strong>.</> : null}
        </span>

        {data.allTemplates.map((t) => {
          const on = picked.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() =>
                setPicked((cur) => {
                  const next = new Set(cur);
                  if (next.has(t.id)) next.delete(t.id);
                  else next.add(t.id);
                  return next;
                })
              }
              className="row-gap-12"
              style={{
                alignItems: "center",
                width: "100%",
                textAlign: "left",
                fontFamily: "inherit",
                cursor: "pointer",
                border: `1.5px solid ${on ? "var(--status-done, #bee0d5)" : "var(--border-soft, #e7e0ce)"}`,
                borderRadius: 11,
                padding: "10px 14px",
                background: on ? "var(--surface-panel-accent, #e4f0e9)" : "#fff",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: `2px solid ${on ? "var(--status-done, #2e9e88)" : "#cbbe9b"}`,
                  background: on ? "var(--status-done, #2e9e88)" : "#fff",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  flex: "none",
                }}
              >
                {on ? "✓" : ""}
              </span>
              <TemplateThumb t={t} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap", fontWeight: 600, fontSize: 14 }}>
                  {t.name}
                  {t.shotType ? <span className="chip neutral" style={{ fontSize: 10 }}>{t.shotType.toUpperCase()}</span> : null}
                  {!t.hasGeometry ? <span className="chip stale" style={{ fontSize: 10 }}>no geometry</span> : null}
                </span>
                <span className="hint" style={{ display: "block", marginTop: 2 }}>
                  {t.coverage.length === 0 ? (
                    "no variants in this listing's colours yet"
                  ) : t.colourLocked ? (
                    <span style={{ color: "var(--status-stale, #b8792a)", fontWeight: 700 }}>
                      {t.coverage[0]} only · colour-locked
                    </span>
                  ) : (
                    <>{t.coverage.length} {plural(t.coverage.length, "colour")} · {t.coverage.join(", ")}</>
                  )}
                </span>
              </span>
              <span style={{ textAlign: "right", flex: "none", fontSize: 12, fontWeight: 700, color: "var(--status-done, #2e9e88)" }}>
                {t.yield} {plural(t.yield, "mockup")}
                <span className="hint" style={{ display: "block", fontWeight: 500, fontSize: 10 }}>for this listing</span>
              </span>
            </button>
          );
        })}
        {data.allTemplates.length === 0 ? (
          <span className="hint">No templates for this product yet — create one in the Library.</span>
        ) : null}

        {assignError ? <div className="callout blocked">{assignError}</div> : null}
        <div className="row-gap-12" style={{ alignItems: "center", flexWrap: "wrap" }}>
          {dirty ? (
            <>
              <button className="btn btn-save" onClick={saveAssignment} disabled={assignBusy}>
                <Spinner active={assignBusy} />
                Save template assignment
              </button>
              <button className="btn btn-tertiary" disabled={assignBusy} onClick={() => setPicked(new Set(data.shortlist))}>
                Revert
              </button>
            </>
          ) : null}
          <a className="btn btn-tertiary" href="/library" style={{ marginLeft: dirty ? "auto" : 0 }}>
            ＋ Create a new template in the Library →
          </a>
        </div>
        {data.hidden.count > 0 ? (
          <span className="hint" style={{ borderTop: "1px dashed var(--border-soft, #e7e0ce)", paddingTop: 8 }}>
            Hidden: {data.hidden.count} {plural(data.hidden.count, "template")} for other products
            {data.hidden.example ? <> (e.g. {data.hidden.example})</> : null} — not compatible with
            this listing&apos;s {data.productName ?? "product"}.
          </span>
        ) : null}
      </div>

      {data.tiles.length > 0 ? (
        <div className="card supporting">
          <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
            <Kicker>
              PRODUCT MOCKUPS · {approved.length} OF {data.tiles.length} APPROVED
            </Kicker>
            <span className="row-gap-8">
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 12, padding: "4px 10px" }}
                disabled={generated.length === 0}
                onClick={() => {
                  for (const t of generated) {
                    if (verdictOf(t) === "flagged") void setVerdict(t, "approved");
                  }
                }}
              >
                Approve all
              </button>
              <button
                className={`btn ${onlyAttention ? "btn-secondary" : "btn-tertiary"}`}
                style={{ fontSize: 12, padding: "4px 10px" }}
                onClick={() => setOnlyAttention((v) => !v)}
              >
                {onlyAttention ? "Show all" : `Needs attention · ${attention.length}`}
              </button>
            </span>
          </div>
          {cropNote ? (
            <span className="hint" style={{ color: cropNote.includes("⚠") ? "var(--status-stale, #b8792a)" : "var(--status-done, #3e7a4e)" }}>
              {cropNote}
            </span>
          ) : null}

          {groups.map((tiles) => {
            const visible = tiles.filter(shown);
            if (visible.length === 0) return null;
            return (
              <div key={tiles[0].templateId} className="stack-12" style={{ gap: 6 }}>
                <span className="row-gap-8" style={{ alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{tiles[0].templateName}</span>
                  {tiles[0].shotType ? (
                    <span className="chip neutral" style={{ fontSize: 10 }}>{tiles[0].shotType}</span>
                  ) : null}
                </span>
                {/* 3-across review grid at FULL panel width — the
                    thumbnail is the thing being judged, so the tiles take
                    every pixel the column gives (minmax(0,1fr), the
                    can't-widen-the-page track). Full render still loads
                    only when a tile is CLICKED (new tab, stable route). */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 12,
                  }}
                >
                  {visible.map((t) => {
                    const v = verdictOf(t);
                    return (
                      <div key={key(t)} className="card" style={{ padding: 0, overflow: "hidden", gap: 0 }}>
                        <a
                          href={t.url ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          title={t.url ? "Open full size in a new tab" : undefined}
                          style={{
                            position: "relative",
                            aspectRatio: "1 / 1",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "var(--surface-sunk, #f4efe2)",
                            cursor: t.url ? "zoom-in" : "default",
                          }}
                        >
                          {t.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={t.url}
                              alt={`${t.templateName} — ${t.colour}`}
                              loading="lazy"
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          ) : (
                            <span className="hint" style={{ fontSize: 10 }}>not generated</span>
                          )}
                          {t.generatedId ? (
                            // full-size original, named after the variant —
                            // for assembling composites outside the app
                            <span
                              role="button"
                              tabIndex={0}
                              title="Download the full-size render"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                window.location.href = `/api/generated-mockups/${t.generatedId}/file?download=1`;
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  window.location.href = `/api/generated-mockups/${t.generatedId}/file?download=1`;
                                }
                              }}
                              style={{
                                position: "absolute",
                                right: 5,
                                bottom: 5,
                                width: 24,
                                height: 24,
                                borderRadius: 7,
                                background: "rgba(255,255,255,0.88)",
                                border: "1px solid var(--border-soft, #e7e2d6)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 13,
                                cursor: "pointer",
                              }}
                            >
                              ↓
                            </span>
                          ) : null}
                        </a>
                        <div className="row-gap-8" style={{ padding: "4px 8px", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                          <span
                            className="body-sm"
                            style={{ fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                            title={t.colour}
                          >
                            {t.colour}
                          </span>
                          <span className={`chip ${v === "approved" ? "done" : v === "flagged" ? "stale" : "neutral"}`} style={{ fontSize: 9, flex: "none" }}>
                            {v === "approved" ? "approved" : v === "flagged" ? "flagged" : "pending"}
                          </span>
                        </div>
                        {/* edit tools left, verdict right — ONE verdict
                            button showing the action available now (the
                            chip above already states the current state) */}
                        <div style={{ display: "flex", borderTop: "1px solid var(--border-soft, #e7e2d6)" }}>
                          <button
                            className="btn btn-tertiary"
                            style={{ flex: 1, fontSize: 11, padding: "5px 2px", borderRadius: 0 }}
                            title="Re-frame this variant from its original photo — replaces the stored file"
                            onClick={() => {
                              setCropNote(null);
                              setCropTile(t);
                            }}
                          >
                            Crop
                          </button>
                          <button
                            className="btn btn-tertiary"
                            style={{ flex: 1, fontSize: 11, padding: "5px 2px", borderRadius: 0, borderLeft: "1px solid var(--border-soft, #e7e2d6)" }}
                            title="Scale / move / tilt the design inside the print region — saved on this listing"
                            onClick={() => {
                              setCropNote(null);
                              setPlaceTile(t);
                            }}
                          >
                            Place
                          </button>
                          <button
                            className="btn btn-tertiary"
                            style={{ flex: 1, fontSize: 11, padding: "5px 2px", borderRadius: 0, borderLeft: "1px solid var(--border-soft, #e7e2d6)", fontWeight: 700 }}
                            disabled={t.url === null}
                            onClick={() => setVerdict(t, v === "approved" ? "flagged" : "approved")}
                          >
                            {v === "approved" ? "Flag" : "Approve"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="card supporting">
        <Kicker>BRANDED INFO GRAPHICS · FROM THE PRODUCT RECORD</Kicker>
        <span className="hint">
          Reused by every listing on this blueprint — L5 pulls them into their named slots, so they
          aren&apos;t part of the approve/send flow here.
        </span>
        <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
          {data.infoGraphics.map((g) =>
            g.url ? (
              <span key={g.label} className="chip done" style={{ fontSize: 11 }} title={g.url}>
                ✓ {g.label}
              </span>
            ) : (
              <span
                key={g.label}
                className="chip stale"
                style={{ fontSize: 11 }}
                title="L5 has a Graphic Card slot waiting for this — add the link on the Product record"
              >
                {g.label} — needed
              </span>
            )
          )}
        </div>
      </div>

      <div className="card supporting">
        <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
          <span className="hint" style={{ flex: "1 1 260px" }}>
            Send fills <strong>empty matching slots only</strong> — it never overwrites an asset,
            never touches a slot you&apos;ve edited, and skips renders already placed. L5 stays yours.
          </span>
          <span className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
            {sendableTemplates.length > 1 ? (
              <select
                className="select input-compact"
                style={{ width: "auto", fontSize: 12 }}
                aria-label="Send only this template's renders"
                value={sendTemplate}
                onChange={(e) => setSendTemplate(e.target.value)}
              >
                <option value="">send: all templates</option>
                {sendableTemplates.map(([tid, tname]) => (
                  <option key={tid} value={tid}>send only: {tname}</option>
                ))}
              </select>
            ) : null}
            <button
              className="btn btn-save"
              disabled={unplacedToSend.length === 0 || sendBusy}
              title={
                unplacedToSend.length === 0
                  ? approvedToSend.length > 0
                    ? "Everything approved here is already assigned to a slot"
                    : "Nothing approved yet"
                  : undefined
              }
              onClick={sendApproved}
            >
              <Spinner active={sendBusy} />
              Send {unplacedToSend.length} unassigned → image slots
            </button>
          </span>
        </div>
        {sendReport ? (
          <div className="stack-12" style={{ gap: 2 }}>
            {sendReport.map((r) => (
              <span
                key={r.name + r.detail}
                className="hint"
                style={{
                  color: r.ok ? (r.skipped ? undefined : "var(--status-done, #3e7a4e)") : "var(--status-blocked, #b3423a)",
                  opacity: r.skipped ? 0.75 : 1,
                }}
              >
                {r.ok ? (r.skipped ? "·" : "✓") : "✕"} {r.name} — {r.detail}
                {r.suggestion && r.generatedId ? (
                  <button
                    className="btn btn-tertiary"
                    style={{ fontSize: 11, padding: "1px 8px", marginLeft: 8 }}
                    disabled={sendBusy}
                    title={`Fills slot ${r.suggestion.position} even though it's typed ${r.suggestion.slotShotType || "differently"} — the slot stays empty otherwise`}
                    onClick={() => assignSuggestion(r.generatedId!, r.suggestion!)}
                  >
                    place in slot {r.suggestion.position} anyway →
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        {/* the branded colour card, assembled here rather than in Canva:
            pick renders in cell order, build, LOOK at it, then send it to
            a Grid Composite slot — never sight-unseen. Max 6 cells; more
            colours = a series of cards. */}
        <div className="stack-12" style={{ borderTop: "1px dashed var(--border-soft, #e7e0ce)", paddingTop: 10, gap: 8 }}>
          <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
            <span className="hint" style={{ flex: "1 1 240px" }}>
              Build the branded <strong>colour card</strong> for the Grid Composite slot — title, colour
              labels and footer included. Tap tiles below in cell order; max {CARD_MAX_CELLS} per card,
              more colours = a series of cards.
            </span>
            <span className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <select
                className="select input-compact"
                style={{ width: "auto", fontSize: 12 }}
                aria-label="Card source template"
                value={gridTemplate}
                onChange={(e) => {
                  setGridTemplate(e.target.value);
                  setGridPicked([]);
                }}
              >
                <option value="">all templates…</option>
                {gridTemplates.map(([tid, tname]) => (
                  <option key={tid} value={tid}>{tname}</option>
                ))}
              </select>
              <select
                className="select input-compact"
                style={{ width: "auto", fontSize: 12 }}
                aria-label="Card layout"
                title="Chosen automatically by how many you tick — override here"
                value={cardLayout}
                onChange={(e) => setCardLayout(e.target.value)}
              >
                <option value="auto">
                  auto{gridPicked.length >= 2 && gridPicked.length <= CARD_MAX_CELLS ? ` (${cardRowsLabel(gridPicked.length)})` : ""}
                </option>
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={String(n)}>{n} cells · {cardRowsLabel(n)}</option>
                ))}
              </select>
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 12 }}
                disabled={
                  gridBusy ||
                  gridPicked.length < 2 ||
                  gridPicked.length > CARD_MAX_CELLS ||
                  (cardLayout !== "auto" && gridPicked.length !== cardNeed)
                }
                title={
                  gridPicked.length < 2
                    ? "Pick at least 2 renders"
                    : gridPicked.length > CARD_MAX_CELLS
                      ? `Max ${CARD_MAX_CELLS} cells per card — build a series`
                      : cardLayout !== "auto" && gridPicked.length !== cardNeed
                        ? `The ${cardRowsLabel(cardNeed)} layout needs ${cardNeed} renders — ${gridPicked.length} picked`
                        : "Build the card — nothing is placed until you confirm"
                }
                onClick={buildCard}
              >
                <Spinner active={gridBusy && !cardStaged} />
                Build card · {gridPicked.length}/{cardLayout === "auto" ? CARD_MAX_CELLS + " max" : cardNeed}
              </button>
            </span>
          </div>
          <div className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <label className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              title
              <input
                className="input input-compact"
                style={{ width: 170 }}
                value={cardTitle}
                onChange={(e) => setCardTitle(e.target.value)}
              />
            </label>
            <label className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              footer
              <input
                className="input input-compact"
                style={{ width: 280 }}
                value={cardFooter}
                onChange={(e) => setCardFooter(e.target.value)}
              />
            </label>
            <label className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              email
              <input
                className="input input-compact"
                style={{ width: 220 }}
                value={cardEmail}
                onChange={(e) => setCardEmail(e.target.value)}
              />
            </label>
          </div>
          {gridCandidates.length > 0 ? (
            <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
              {gridCandidates.map((t) => {
                const order = gridPicked.indexOf(t.generatedId!);
                return (
                  <button
                    key={t.generatedId}
                    type="button"
                    className={`chip ${order >= 0 ? "done" : "neutral"}`}
                    style={{ cursor: "pointer", fontSize: 11 }}
                    title={`${t.templateName} — tap to ${order >= 0 ? "remove" : "add"}`}
                    onClick={() => toggleGridTile(t.generatedId!)}
                  >
                    {order >= 0 ? `${order + 1} · ` : ""}
                    {t.colour}
                    {!gridTemplate ? ` (${t.templateName})` : ""}
                  </button>
                );
              })}
              {gridPicked.length > 0 ? (
                <span className="hint">
                  cells: {gridPicked.map((gid) => gridCandidates.find((t) => t.generatedId === gid)?.colour ?? "?").join(" → ")}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="hint">No approved renders yet — approve some tiles above first.</span>
          )}
          {cardStaged ? (
            <div className="row-gap-12" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <a href={cardStaged.url} target="_blank" rel="noreferrer" title="Open full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cardStaged.url}
                  alt="Built colour card"
                  style={{ width: 220, borderRadius: 10, border: "1px solid var(--border-soft, #e7e2d6)" }}
                />
              </a>
              <div className="stack-12" style={{ gap: 6, flex: "1 1 220px" }}>
                <span className="body-sm">
                  <strong>{cardStaged.layout}</strong> · &quot;{cardStaged.title}&quot; · {cardStaged.cells.join(" → ")}
                </span>
                {!cardStaged.hasSlot ? (
                  <span className="hint" style={{ color: "var(--status-stale, #b8792a)" }}>
                    ⚠ no Grid Composite slot on this listing — add one at L5 before placing
                  </span>
                ) : cardStaged.openSlots === 0 ? (
                  <span className="hint" style={{ color: "var(--status-stale, #b8792a)" }}>
                    ⚠ every Grid Composite slot is filled — sending will replace the first one (a series needs one slot per card at L5)
                  </span>
                ) : null}
                <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
                  <button className="btn btn-save" style={{ fontSize: 12 }} disabled={gridBusy || !cardStaged.hasSlot} onClick={assignCard}>
                    <Spinner active={gridBusy} />
                    Send to Grid Composite slot
                  </button>
                  <button className="btn btn-tertiary" style={{ fontSize: 12 }} disabled={gridBusy} onClick={buildCard}>
                    Rebuild
                  </button>
                  <button className="btn btn-tertiary" style={{ fontSize: 12 }} disabled={gridBusy} onClick={discardCard}>
                    Discard
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {gridError ? <div className="callout blocked">colour card — {gridError}</div> : null}
          {gridNote ? (
            <span className="hint" style={{ color: "var(--status-done, #3e7a4e)" }}>{gridNote}</span>
          ) : null}
        </div>

        {/* print close-up: re-rendered at native sharpness, cropped to the
            PRINT REGION — never a soft blow-up of the 2000px gallery render */}
        <div className="stack-12" style={{ borderTop: "1px dashed var(--border-soft, #e7e0ce)", paddingTop: 10, gap: 8 }}>
          <span className="hint">
            Build the <strong>print close-up</strong> for the Closeup Print slot — a zoom into one
            render&apos;s print region, design on fabric. Pick a source render:
          </span>
          <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
            {gridCandidates.length === 0 ? (
              <span className="hint">No approved renders yet — approve some tiles above first.</span>
            ) : (
              gridCandidates.map((t) => (
                <button
                  key={`cu-${t.generatedId}`}
                  type="button"
                  className={`chip ${cuPicked === t.generatedId ? "done" : "neutral"}`}
                  style={{ cursor: "pointer", fontSize: 11 }}
                  title={`${t.templateName} — zoom into this render's print region`}
                  onClick={() => pickCloseupTile(t.generatedId!)}
                >
                  {t.colour} ({t.templateName})
                </button>
              ))
            )}
          </div>
          {cuPicked && cuOpts ? (
            <div className="row-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <span className="hint">source {cuOpts.sourcePx}px · crop:</span>
              {cuOpts.presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`chip ${cuTightness === p.key ? "done" : "neutral"}`}
                  style={{ cursor: p.ok ? "pointer" : "not-allowed", fontSize: 11, opacity: p.ok ? 1 : 0.45 }}
                  disabled={!p.ok}
                  title={p.ok ? `${p.label} → ${p.outPx}px output` : p.reason ?? ""}
                  onClick={() => p.ok && setCuTightness(p.key)}
                >
                  {p.label} · {p.outPx}px
                </button>
              ))}
              {cuOpts.presets.filter((p) => !p.ok).map((p) => (
                <span key={`r-${p.key}`} className="hint" style={{ color: "var(--status-stale, #b8792a)" }}>
                  ⚠ {p.reason}
                </span>
              ))}
              <button
                className="btn btn-tertiary"
                style={{ fontSize: 12 }}
                disabled={cuBusy || !cuTightness}
                title="Build the close-up — nothing is placed until you confirm"
                onClick={buildCloseup}
              >
                <Spinner active={cuBusy && !cuStaged} />
                Build close-up
              </button>
            </div>
          ) : null}
          {cuStaged ? (
            <div className="row-gap-12" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <a href={cuStaged.url} target="_blank" rel="noreferrer" title="Open full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cuStaged.url}
                  alt="Built print close-up"
                  style={{ width: 220, borderRadius: 10, border: "1px solid var(--border-soft, #e7e2d6)" }}
                />
              </a>
              <div className="stack-12" style={{ gap: 6, flex: "1 1 220px" }}>
                <span className="body-sm">
                  from <strong>{cuStaged.source}</strong> ({cuStaged.colour}) · {cuStaged.tightness} crop · {cuStaged.outPx}px
                </span>
                {!cuStaged.hasSlot ? (
                  <span className="hint" style={{ color: "var(--status-stale, #b8792a)" }}>
                    ⚠ no Closeup Print slot on this listing — add one at L5 before placing
                  </span>
                ) : null}
                <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
                  <button className="btn btn-save" style={{ fontSize: 12 }} disabled={cuBusy || !cuStaged.hasSlot} onClick={assignCloseup}>
                    <Spinner active={cuBusy} />
                    Send to Closeup Print slot
                  </button>
                  <button className="btn btn-tertiary" style={{ fontSize: 12 }} disabled={cuBusy} onClick={buildCloseup}>
                    Rebuild
                  </button>
                  <button className="btn btn-tertiary" style={{ fontSize: 12 }} disabled={cuBusy} onClick={discardCloseup}>
                    Discard
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {cuError ? <div className="callout blocked">print close-up — {cuError}</div> : null}
          {cuNote ? <span className="hint" style={{ color: "var(--status-done, #3e7a4e)" }}>{cuNote}</span> : null}
        </div>

        {/* artwork detail: the design ALONE from the master — and the one
            output that carries the "stuffs" watermark */}
        <div className="stack-12" style={{ borderTop: "1px dashed var(--border-soft, #e7e0ce)", paddingTop: 10, gap: 8 }}>
          <div className="row-gap-12" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
            <span className="hint" style={{ flex: "1 1 240px" }}>
              Build the <strong>artwork detail</strong> for the Artwork Only slot — the design alone,
              from the design master. Watermarked; the close-up and mockups never are.
            </span>
            <span className="row-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <label className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <input type="checkbox" checked={awWmOn} onChange={(e) => setAwWmOn(e.target.checked)} />
                watermark
              </label>
              <label className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                opacity
                <input
                  className="input input-compact"
                  style={{ width: 52 }}
                  type="number"
                  min={2}
                  max={50}
                  value={awWmOpacity}
                  disabled={!awWmOn}
                  onChange={(e) => setAwWmOpacity(Math.min(50, Math.max(2, Number(e.target.value) || 9)))}
                />
                %
              </label>
              <button className="btn btn-tertiary" style={{ fontSize: 12 }} disabled={awBusy} onClick={previewArtwork}>
                <Spinner active={awBusy && !awPreviews && !awStaged} />
                Preview both backgrounds
              </button>
            </span>
          </div>
          {awPreviews && !awStaged ? (
            <div className="row-gap-12" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
              {(["dark", "light"] as const).map((bg) => (
                <div key={bg} className="stack-12" style={{ gap: 6 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={awPreviews[bg]}
                    alt={`Artwork detail — ${bg} background`}
                    style={{
                      width: 220,
                      borderRadius: 10,
                      border: awLastBg === bg ? "2px solid var(--blueberry, #1f4897)" : "1px solid var(--border-soft, #e7e2d6)",
                    }}
                  />
                  <button
                    className={`btn ${awLastBg === bg ? "btn-save" : "btn-secondary"}`}
                    style={{ fontSize: 12 }}
                    disabled={awBusy || !awPreviews.floorOk}
                    title={awPreviews.floorOk ? `Build full-res on the ${bg} background` : awPreviews.reason ?? ""}
                    onClick={() => buildArtwork(bg)}
                  >
                    <Spinner active={awBusy} />
                    Use {bg === "dark" ? "dark (black)" : "light (eggshell)"}
                  </button>
                </div>
              ))}
              <span className="hint" style={{ alignSelf: "center" }}>
                output {awPreviews.outPx}px
                {!awPreviews.floorOk ? (
                  <span style={{ color: "var(--status-blocked, #b3423a)" }}> · ⚠ {awPreviews.reason}</span>
                ) : null}
              </span>
            </div>
          ) : null}
          {awStaged ? (
            <div className="row-gap-12" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <a href={awStaged.url} target="_blank" rel="noreferrer" title="Open full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={awStaged.url}
                  alt="Built artwork detail"
                  style={{ width: 220, borderRadius: 10, border: "1px solid var(--border-soft, #e7e2d6)" }}
                />
              </a>
              <div className="stack-12" style={{ gap: 6, flex: "1 1 220px" }}>
                <span className="body-sm">
                  <strong>{awStaged.background}</strong> background · watermark {awWmOn ? `on (${awWmOpacity}%)` : "off"} · {awStaged.outPx}px
                </span>
                {!awStaged.hasSlot ? (
                  <span className="hint" style={{ color: "var(--status-stale, #b8792a)" }}>
                    ⚠ no Artwork Only slot on this listing — add one at L5 before placing
                  </span>
                ) : null}
                <div className="row-gap-8" style={{ flexWrap: "wrap" }}>
                  <button className="btn btn-save" style={{ fontSize: 12 }} disabled={awBusy || !awStaged.hasSlot} onClick={assignArtwork}>
                    <Spinner active={awBusy} />
                    Send to Artwork Only slot
                  </button>
                  <button className="btn btn-tertiary" style={{ fontSize: 12 }} disabled={awBusy} onClick={() => setAwStaged(null)}>
                    Back to previews
                  </button>
                  <button className="btn btn-tertiary" style={{ fontSize: 12 }} disabled={awBusy} onClick={discardArtwork}>
                    Discard
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {awError ? <div className="callout blocked">artwork detail — {awError}</div> : null}
          {awNote ? <span className="hint" style={{ color: "var(--status-done, #3e7a4e)" }}>{awNote}</span> : null}
        </div>
      </div>

      {cropTile ? (
        <CropAdjustModal
          variantId={cropTile.variantId}
          variantName={`${cropTile.templateName} — ${cropTile.colour}`}
          placement={data.placement.perVariant[cropTile.variantId] ?? data.placement.default}
          onClose={() => setCropTile(null)}
          onSaved={(result) => onCropSaved(cropTile.variantId, result)}
        />
      ) : null}
      {placeTile ? (
        <PlacementModal
          listingId={data.listingId}
          designId={data.designId}
          variantId={placeTile.variantId}
          variantName={placeTile.templateName}
          colour={placeTile.colour}
          quad={placeTile.quad}
          current={data.placement}
          printArea={data.printArea}
          onClose={() => setPlaceTile(null)}
          onSaved={(scope) => onPlaceSaved(scope, placeTile.variantId)}
        />
      ) : null}
    </div>
  );
}
