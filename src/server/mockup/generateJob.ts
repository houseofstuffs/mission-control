/**
 * The compositor — L4's generate run as a server-side background job.
 *
 * Same shape as the Drive import job (src/server/drive/importJob.ts), for
 * the same reason: the loop must survive navigation, and progress must be
 * readable from any tab. Meta record per listing, heartbeat after every
 * tile, honest "interrupted" when the process died mid-run.
 *
 * Per tile: fetch the variant's layers (re-minting Notion's expiring URLs
 * once, like the test-render route) → renderMockup — the SAME module the
 * Test render button has exercised all along — → WebP under the Notion
 * budget → upload → one generated_mockups record per listing × variant,
 * replaced on regenerate, never duplicated. The design master is fetched
 * ONCE per run: Drive-linked masters go through the Drive integration,
 * public links through plain fetch.
 */
import sharp from "sharp";
import { getMeta, setMeta } from "@/server/cache/db";
import { cachedRecord, cachedRecords, createRecord, updateRecord, refreshRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { renderMockup } from "@/server/mockup/render";
import { listingMockupPlan, generatedFor, masterPngLink, type PlanTile } from "@/server/mockup/plan";
import { getValidAccessToken } from "@/server/drive/connection";
import { fetchFileBytes } from "@/server/drive/client";
import { connectionStatus as driveStatus } from "@/server/drive/connection";
import {
  parseQuad,
  DEFAULT_BLEND,
  DEFAULT_FIT,
  UPLOAD_BUDGET_BYTES,
  type PipelineType,
  type BlendMode,
  type FitMode,
} from "@/config/mockups";
import type { SimpleRecord } from "@/server/notion/props";

export interface GenerateJobStatus {
  listingId: string;
  status: "running" | "complete" | "interrupted";
  total: number;
  done: number;
  rendered: number;
  results: Array<{ name: string; detail: string; ok: boolean }>;
  startedAt: string;
  updatedAt: string;
}

const metaKey = (listingId: string) => `generate_mockups_${listingId}`;
const STALE_MS = 3 * 60 * 1000;

export function generateJobStatus(listingId: string): GenerateJobStatus | null {
  const raw = getMeta(metaKey(listingId));
  if (!raw) return null;
  let job: GenerateJobStatus;
  try {
    job = JSON.parse(raw) as GenerateJobStatus;
  } catch {
    return null;
  }
  if (job.status === "running" && Date.now() - new Date(job.updatedAt).getTime() > STALE_MS) {
    return { ...job, status: "interrupted" };
  }
  return job;
}

function writeJob(job: GenerateJobStatus): void {
  setMeta(metaKey(job.listingId), JSON.stringify({ ...job, updatedAt: new Date().toISOString() }));
}

/** file id out of a Drive share link, or null for non-Drive links */
function driveFileId(link: string): string | null {
  const m = link.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})/) ?? link.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

/**
 * The design master's bytes. Drive links need the Drive connection (share
 * links aren't fetchable anonymously unless truly public); anything else
 * is tried as a plain URL. Errors name the fix, not just the failure.
 */
async function fetchMaster(link: string): Promise<Buffer> {
  const fileId = driveFileId(link);
  if (fileId && driveStatus().connected) {
    const token = await getValidAccessToken();
    const { bytes } = await fetchFileBytes(fileId, token);
    return Buffer.from(bytes);
  }
  const res = await fetch(link, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      fileId
        ? `Couldn't fetch the design master from Drive (${res.status}) — connect Google Drive (Library page) or make the link public.`
        : `Couldn't fetch the design master (${res.status}) — check the Master PNG Link on the design.`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Drive share links served anonymously return an HTML viewer page, not
  // the file — catching it here beats a cryptic sharp decode error
  if (buf.subarray(0, 100).toString("latin1").toLowerCase().includes("<!doctype html")) {
    throw new Error("The Master PNG Link serves a web page, not the image — connect Google Drive or use a direct file link.");
  }
  return buf;
}

function firstFileUrl(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return ((v[0] as { url?: string })?.url) || null;
}

class LayerExpiredError extends Error {}

async function fetchLayer(url: string | null, label: string): Promise<Buffer | null> {
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new LayerExpiredError(`Couldn't fetch the ${label} (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchLayers(template: SimpleRecord) {
  return {
    base: await fetchLayer(firstFileUrl(template.props["Base Image"]), "base image"),
    displacement: await fetchLayer(firstFileUrl(template.props["Displacement Map"]), "displacement map"),
    shadow: await fetchLayer(firstFileUrl(template.props["Shadow Layer"]), "shadow layer"),
    highlight: await fetchLayer(firstFileUrl(template.props["Highlight Layer"]), "highlight layer"),
  };
}

/** WebP under the Notion cap — quality first; render output is already display-sized. */
async function encodeUnderBudget(png: Buffer): Promise<Buffer> {
  for (const quality of [90, 82, 74, 66, 58]) {
    const out = await sharp(png).webp({ quality }).toBuffer();
    if (out.length <= UPLOAD_BUDGET_BYTES) return out;
  }
  throw new Error("Render won't compress under Notion's upload cap.");
}

export interface GenerateArgs {
  listingId: string;
  /** re-render tiles that already have an image (default: skip them) */
  regenerate?: boolean;
  /** re-render ONLY tiles whose record is Flagged — the flag IS the redo list */
  onlyFlagged?: boolean;
}

export function startGenerateJob(args: GenerateArgs): GenerateJobStatus {
  const existing = generateJobStatus(args.listingId);
  if (existing?.status === "running") {
    throw new Error(`A generate run is already going (${existing.done}/${existing.total}) — wait for it.`);
  }
  const rec = cachedRecord(args.listingId);
  if (!rec || rec.dbKey !== "etsy_listings") throw new Error("Listing not found in cache — refresh first.");

  const plan = listingMockupPlan(rec);
  const tiles = args.onlyFlagged
    ? plan.tiles.filter((t) => {
        const g = generatedFor(args.listingId, t.variantId);
        return g != null && String(g.props["Verdict"] ?? "") === "Flagged";
      })
    : args.regenerate
      ? plan.tiles
      : plan.tiles.filter((t) => !generatedFor(args.listingId, t.variantId));
  if (tiles.length === 0) {
    throw new Error(
      args.onlyFlagged
        ? "Nothing is flagged — flag the misses first; the flag is the redo list."
        : plan.tiles.length === 0
          ? "The plan is empty — assign templates and colours first."
          : "Every planned mockup is already generated — use Regenerate to redo them."
    );
  }

  const job: GenerateJobStatus = {
    listingId: args.listingId,
    status: "running",
    total: tiles.length,
    done: 0,
    rendered: 0,
    results: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeJob(job);
  void runJob(rec, tiles, job);
  return job;
}

async function runJob(rec: SimpleRecord, tiles: PlanTile[], job: GenerateJobStatus): Promise<void> {
  // the master once per run, not per tile — it's the same artwork every time
  let master: Buffer;
  try {
    const m = masterPngLink(rec);
    if (!m) throw new Error("The design has no Master PNG Link — save it at C7.");
    master = await fetchMaster(m.link);
  } catch (err) {
    job.results.push({ name: "design master", detail: (err as Error).message, ok: false });
    job.status = "interrupted";
    writeJob(job);
    return;
  }

  for (const tile of tiles) {
    const label = `${tile.variantName}`;
    try {
      let template = cachedRecord(tile.variantId);
      if (!template) throw new Error("variant vanished from the cache — refresh and re-run");

      const pipelineType = String(template.props["Pipeline Type"] ?? "") as PipelineType;
      if (pipelineType !== "Simple Placement" && pipelineType !== "Full Displacement") {
        throw new Error("no pipeline type set — fix the variant in the Library");
      }

      // expiring-URL retry, same contract as the test-render route
      let layers;
      try {
        layers = await fetchLayers(template);
      } catch (err) {
        if (!(err instanceof LayerExpiredError)) throw err;
        template = await refreshRecord("mockup_templates", tile.variantId);
        layers = await fetchLayers(template);
      }
      if (!layers.base) throw new Error("variant has no base image");

      const png = await renderMockup(
        {
          pipelineType,
          quad: parseQuad(String(template.props["Print Area Quad (JSON)"] ?? "")),
          blend: (String(template.props["Blend Mode"] ?? "") || DEFAULT_BLEND) as BlendMode,
          fit: (String(template.props["Fit"] ?? "") || DEFAULT_FIT) as FitMode,
        },
        { base: layers.base, displacement: layers.displacement, shadow: layers.shadow, highlight: layers.highlight },
        master,
        null
      );

      const webp = await encodeUnderBudget(png);
      const file = new File([new Uint8Array(webp)], `${tile.variantName} - render.webp`, { type: "image/webp" });
      const up = await uploadFileToNotion(file);

      // one record per listing × variant — regenerate REPLACES the image
      const existing = cachedRecords("generated_mockups").find(
        (g) =>
          ((g.props["Listing"] as string[] | null) ?? []).includes(rec.id) &&
          ((g.props["Variant"] as string[] | null) ?? []).includes(tile.variantId)
      );
      const values = {
        Name: `${rec.title || "Listing"} — ${tile.variantName}`,
        Listing: [rec.id],
        Variant: [tile.variantId],
        Colour: tile.colour,
        Image: [{ name: file.name, uploadId: up.id }],
        "Generated At": new Date().toISOString().slice(0, 10),
        // approve-by-default: the operator flags the misses
        Verdict: "Approved",
      };
      if (existing) await updateRecord("generated_mockups", existing.id, values);
      else await createRecord("generated_mockups", values);

      job.rendered++;
      job.results.push({ name: label, detail: `${tile.colour} · rendered`, ok: true });
    } catch (err) {
      job.results.push({ name: label, detail: (err as Error).message, ok: false });
    } finally {
      if (job.status === "running") {
        job.done++;
        writeJob(job);
      }
    }
  }
  job.status = "complete";
  writeJob(job);
}
