/**
 * The Drive auto-import as a server-side background job.
 *
 * The first version ran the fetch → crop → save loop in the page, which
 * meant any in-app navigation silently killed it mid-batch (a real 14-file
 * run lost 3 exactly this way). Everything the loop needs — Drive tokens,
 * the crop geometry, the encoder — already lives server-side, so the loop
 * belongs here: kick it off, navigate freely, close the tab; progress
 * persists in the meta table and the UI just reads it.
 *
 * One job per template at a time. Progress is written after EVERY file, so
 * the updatedAt doubles as a heartbeat: a "running" job whose heartbeat
 * has gone quiet is reported as interrupted (container restart mid-run),
 * never as forever-running.
 *
 * Crop parity: same normalized rect and adaptive-output rules as the
 * client pipeline (src/lib/mockupCrop.ts) — output side = crop's own
 * pixels clamped to [MOCKUP_CROP_MIN, MOCKUP_CROP_SIZE], never upscaled,
 * under-minimum files skipped by name.
 */
import sharp from "sharp";
import { getMeta, setMeta } from "@/server/cache/db";
import { createRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { getValidAccessToken } from "@/server/drive/connection";
import { fetchFileBytes, ReconnectError } from "@/server/drive/client";
import {
  MOCKUP_CROP_MIN,
  MOCKUP_CROP_SIZE,
  UPLOAD_BUDGET_BYTES,
  DEFAULT_BLEND,
  DEFAULT_FIT,
  DEFAULT_QUAD,
  type Quad,
} from "@/config/mockups";
import type { SimpleValue } from "@/server/notion/props";

export interface ImportFile {
  id: string;
  name: string;
  colour: string;
}

export interface ImportJobStatus {
  shotId: string;
  status: "running" | "complete" | "interrupted";
  total: number;
  /** files processed so far — success and failure both count */
  done: number;
  imported: number;
  results: Array<{ name: string; detail: string; ok: boolean }>;
  startedAt: string;
  updatedAt: string;
}

const metaKey = (shotId: string) => `drive_import_${shotId}`;

/** quality rungs tried at each size before giving up resolution instead */
const WEBP_QUALITY_STEPS = [90, 82, 74, 66, 58];

/**
 * Encodes the crop under UPLOAD_BUDGET_BYTES — Notion's 5 MiB cap, with
 * margin — losing quality first, resolution second, never going below
 * MOCKUP_CROP_MIN. Same ladder as the client encoder (src/lib/mockupCrop
 * .ts). The first version encoded once at fixed quality with no budget at
 * all, and three busy photos came out 5.3–5.6 MiB: past every check here,
 * dead at Notion. Returns null when even the floor size can't fit.
 */
async function encodeUnderBudget(
  buf: Buffer,
  crop: { left: number; top: number; side: number },
  startSize: number
): Promise<{ out: Buffer; size: number } | null> {
  for (let size = startSize; ; size = Math.round(size * 0.8)) {
    for (const quality of WEBP_QUALITY_STEPS) {
      const out = await sharp(buf)
        .extract({ left: crop.left, top: crop.top, width: crop.side, height: crop.side })
        .resize(size, size)
        .webp({ quality })
        .toBuffer();
      if (out.length <= UPLOAD_BUDGET_BYTES) return { out, size };
    }
    if (Math.round(size * 0.8) < MOCKUP_CROP_MIN) return null;
  }
}

/** running with no heartbeat for this long = the process died mid-run */
const STALE_MS = 3 * 60 * 1000;

export function jobStatus(shotId: string): ImportJobStatus | null {
  const raw = getMeta(metaKey(shotId));
  if (!raw) return null;
  let job: ImportJobStatus;
  try {
    job = JSON.parse(raw) as ImportJobStatus;
  } catch {
    return null;
  }
  if (job.status === "running" && Date.now() - new Date(job.updatedAt).getTime() > STALE_MS) {
    // report honestly — the loop is gone, only the record survived
    return { ...job, status: "interrupted" };
  }
  return job;
}

function writeJob(job: ImportJobStatus): void {
  setMeta(metaKey(job.shotId), JSON.stringify({ ...job, updatedAt: new Date().toISOString() }));
}

export interface StartArgs {
  shotId: string;
  templateName: string;
  rect: { x: number; y: number; size: number };
  quad: Quad | null;
  files: ImportFile[];
}

/**
 * Starts the job and returns immediately; the loop continues on the server
 * regardless of what the browser does next. Throws if a live job is
 * already running for this template.
 */
export function startImportJob(args: StartArgs): ImportJobStatus {
  const existing = jobStatus(args.shotId);
  if (existing?.status === "running") {
    throw new Error(
      `An import is already running for this template (${existing.done}/${existing.total}) — wait for it to finish.`
    );
  }
  const job: ImportJobStatus = {
    shotId: args.shotId,
    status: "running",
    total: args.files.length,
    done: 0,
    imported: 0,
    results: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeJob(job);
  // fire and forget — this is a long-lived Node server (Railway), not a
  // serverless function, so the promise outlives the response
  void runJob(args, job);
  return job;
}

async function runJob(args: StartArgs, job: ImportJobStatus): Promise<void> {
  for (const f of args.files) {
    try {
      const token = await getValidAccessToken();
      const { bytes } = await fetchFileBytes(f.id, token);
      const buf = Buffer.from(bytes);
      const meta = await sharp(buf).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      if (!w || !h) {
        job.results.push({ name: f.name, detail: "unreadable image", ok: false });
        continue;
      }

      // adaptive output, same rules as the client pipeline
      const cropPx = Math.round(args.rect.size * Math.min(w, h));
      if (cropPx < MOCKUP_CROP_MIN) {
        job.results.push({
          name: f.name,
          detail: `skipped — crop yields ${cropPx}px, under ${MOCKUP_CROP_MIN}`,
          ok: false,
        });
        continue;
      }
      const side = Math.min(cropPx, w, h);
      const left = Math.round(Math.min(Math.max(args.rect.x * w, 0), Math.max(w - side, 0)));
      const top = Math.round(Math.min(Math.max(args.rect.y * h, 0), Math.max(h - side, 0)));
      const encoded = await encodeUnderBudget(buf, { left, top, side }, Math.min(cropPx, MOCKUP_CROP_SIZE));
      if (!encoded) {
        job.results.push({
          name: f.name,
          detail: `skipped — won't fit Notion's 5 MiB upload cap even at ${MOCKUP_CROP_MIN}px`,
          ok: false,
        });
        continue;
      }
      const { out, size: target } = encoded;

      const upload = new File(
        [new Uint8Array(out)],
        `${f.name.replace(/\.[^.]+$/, "")}-${target}.webp`,
        { type: "image/webp" }
      );
      const up = await uploadFileToNotion(upload);
      const values: Record<string, SimpleValue> = {
        // the ACTUAL px produced — a name that overstates resolution is
        // worse than no name
        Name: `${args.templateName} - ${f.colour} - ${target}`,
        "Pipeline Type": "Simple Placement",
        "Blend Mode": DEFAULT_BLEND,
        Fit: DEFAULT_FIT,
        "Garment Color": f.colour,
        Shot: [args.shotId],
        "Print Area Quad (JSON)": JSON.stringify(args.quad ?? DEFAULT_QUAD),
        "Base Image": [{ name: upload.name, uploadId: up.id }],
      };
      await createRecord("mockup_templates", values);
      job.imported++;
      job.results.push({ name: f.name, detail: `${f.colour} · ${target}×${target}`, ok: true });
    } catch (err) {
      if (err instanceof ReconnectError) {
        // every later fetch fails the same way — stop, say so, keep what landed
        job.results.push({
          name: f.name,
          detail: "Drive connection expired — reconnect and re-run; already-imported colours will be skipped",
          ok: false,
        });
        job.done++;
        job.status = "interrupted";
        writeJob(job);
        return;
      }
      job.results.push({ name: f.name, detail: (err as Error).message, ok: false });
    } finally {
      if (job.status === "running") {
        job.done++;
        writeJob(job); // heartbeat — after every file, success or not
      }
    }
  }
  job.status = "complete";
  writeJob(job);
}
