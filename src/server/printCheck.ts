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

/**
 * ok    → green check.
 * info  → neutral note: a legitimate style choice worth knowing about, not a
 *         defect. Soft alpha (the vintage fade) lives here — it reads
 *         identically to full strength on screen, so it deserves a note, but
 *         painting it red just teaches people to ignore the panel.
 * warn  → attention: near-always an actual problem (pure black, undersized).
 */
export type FindingLevel = "ok" | "info" | "warn";

export interface PrintCheckResult {
  width: number | null;
  height: number | null;
  /** share of visible pixels that are solidly opaque */
  opaqueShare: number;
  /** share of opaque pixels that are exactly #000000 */
  pureBlackShare: number;
  /** true when the pixel walk ran on a reduction, not the full file */
  sampled: boolean;
  findings: Array<{ level: FindingLevel; text: string }>;
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

  const findings: Array<{ level: FindingLevel; text: string }> = [];

  // Soft alpha is a style (the vintage fade), so low solidity is a NOTE, not
  // an alarm — the point is that screens hide it and ink doesn't. The number
  // leads with what the effect does, not with what's "missing".
  findings.push(
    opaqueShare < MIN_OPAQUE_SHARE
      ? {
          level: "info",
          text: `Soft alpha across the artwork — ${pct(1 - opaqueShare)} of it prints at partial ink strength (${pct(opaqueShare)} fully solid). If that's the vintage fade, it's working as designed: expect the print darker and more fabric-tinted than mockups show, and let a sample confirm it. If no fade was intended, look for an alpha texture mask or an opacity slider.`,
        }
      : { level: "ok", text: `Ink lays down at full strength across ${pct(opaqueShare)} of the artwork.` }
  );

  findings.push(
    pureBlackShare > MAX_PURE_BLACK_SHARE
      ? {
          level: "warn",
          text: `Pure black present (${pct(pureBlackShare)} of the artwork) — will be destroyed by background knockout and limits garment compatibility.`,
        }
      : { level: "ok", text: "No meaningful pure black — linework will survive knockout." }
  );

  findings.push(
    longEdge > 0 && longEdge < MIN_LONG_EDGE
      ? { level: "warn", text: `Long edge is ${longEdge}px — under the ${MIN_LONG_EDGE}px a print file wants.` }
      : longEdge > 0
        ? { level: "ok", text: `${width}×${height} — clears the ${MIN_LONG_EDGE}px minimum.` }
        : { level: "warn", text: "Couldn't read the file's dimensions." }
  );

  return { width, height, opaqueShare, pureBlackShare, sampled, findings };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
}

/** Flatten a result into the plain text stored on the record. */
export function checkNotes(r: PrintCheckResult): string {
  const glyph: Record<FindingLevel, string> = { ok: "✓", info: "ℹ", warn: "⚠" };
  const lines = r.findings.map((f) => `${glyph[f.level]} ${f.text}`);
  lines.push(
    `Checked ${new Date().toISOString().slice(0, 10)}${r.sampled ? " · measured on a sampled reduction" : ""}`
  );
  return lines.join("\n");
}
