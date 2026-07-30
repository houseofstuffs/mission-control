/**
 * Print-file pre-flight — looks at the actual pixels of a master PNG and
 * reports what will go wrong at print. ADVISORY ONLY: it never edits the
 * file, never blocks a step, and never calls Kittl. Inspection and guidance.
 *
 * Three things it can see that the eye can't:
 *   1. Texture riding on alpha instead of on colour — prints weak and washed.
 *   2. Pure #000000 — background knockout eats it, and it forces the design
 *      onto dark garments only.
 *   3. A master too small for the print area — Printify upscales, print softens.
 */
import sharp from "sharp";
import {
  MIN_OPAQUE_SHARE,
  OPAQUE_ALPHA,
  MAX_PURE_BLACK_SHARE,
  MIN_LONG_EDGE,
} from "@/config/design-prompt";

/** Above this, walk a nearest-neighbour reduction instead of every pixel.
 *  Nearest keeps exact source values — no interpolated greys, no fake alpha —
 *  so the shares it measures are a true sample, not a blurred average. */
const MAX_WALK_EDGE = 3000;

export interface PrintCheckResult {
  width: number | null;
  height: number | null;
  /** share of visible pixels that are solidly opaque */
  opaqueShare: number;
  /** share of opaque pixels that are exactly #000000 */
  pureBlackShare: number;
  /** true when the pixel walk ran on a reduction, not the full file */
  sampled: boolean;
  findings: Array<{ ok: boolean; text: string }>;
}

export async function inspectPrintFile(
  buf: Buffer,
  trueSize?: { width: number | null; height: number | null }
): Promise<PrintCheckResult> {
  const meta = await sharp(buf).metadata();
  // The client may have sent a reduction to keep the upload sane; when it
  // does, it also sends the real dimensions, and those are what we judge.
  const width = trueSize?.width ?? meta.width ?? null;
  const height = trueSize?.height ?? meta.height ?? null;

  const longestIn = Math.max(meta.width ?? 0, meta.height ?? 0);
  const sampled = longestIn > MAX_WALK_EDGE;
  let pipeline = sharp(buf);
  if (sampled) {
    pipeline = pipeline.resize(MAX_WALK_EDGE, MAX_WALK_EDGE, {
      fit: "inside",
      kernel: "nearest",
    });
  }
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  let visible = 0;
  let opaque = 0;
  let pureBlack = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const a = data[i + 3];
    if (a === 0) continue;
    visible++;
    if (a < OPAQUE_ALPHA) continue;
    opaque++;
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) pureBlack++;
  }

  const opaqueShare = visible > 0 ? opaque / visible : 0;
  const pureBlackShare = opaque > 0 ? pureBlack / opaque : 0;
  const longEdge = Math.max(width ?? 0, height ?? 0);

  const findings: Array<{ ok: boolean; text: string }> = [];

  findings.push(
    opaqueShare < MIN_OPAQUE_SHARE
      ? {
          ok: false,
          text: `Artwork is largely semi-transparent (${pct(opaqueShare)} solid) — will print at reduced strength. Check texture is not riding on alpha.`,
        }
      : { ok: true, text: `${pct(opaqueShare)} of the artwork is solid — texture is carried by colour, not alpha.` }
  );

  findings.push(
    pureBlackShare > MAX_PURE_BLACK_SHARE
      ? {
          ok: false,
          text: `Pure black present (${pct(pureBlackShare)} of the artwork) — will be destroyed by background knockout and limits garment compatibility.`,
        }
      : { ok: true, text: "No meaningful pure black — linework will survive knockout." }
  );

  findings.push(
    longEdge > 0 && longEdge < MIN_LONG_EDGE
      ? { ok: false, text: `Long edge is ${longEdge}px — under the ${MIN_LONG_EDGE}px a print file wants.` }
      : longEdge > 0
        ? { ok: true, text: `${width}×${height} — clears the ${MIN_LONG_EDGE}px minimum.` }
        : { ok: false, text: "Couldn't read the file's dimensions." }
  );

  return { width, height, opaqueShare, pureBlackShare, sampled, findings };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
}

/** Flatten a result into the plain text stored on the record. */
export function checkNotes(r: PrintCheckResult): string {
  const lines = r.findings.map((f) => `${f.ok ? "✓" : "⚠"} ${f.text}`);
  lines.push(
    `Checked ${new Date().toISOString().slice(0, 10)}${r.sampled ? " · measured on a sampled reduction" : ""}`
  );
  return lines.join("\n");
}
