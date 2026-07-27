/**
 * Brand asset resolution. Real files are expected in public/assets/ (see
 * assets/README.md manifest). Until they land, components fall back to
 * placeholder marks — drop the real SVGs in and they take over with no code
 * change. Pencil motif and paper-clip.svg are retired — never use.
 */
import fs from "node:fs";
import path from "node:path";

const ASSET_FILES = {
  heart: "heart-1.svg",
  figure: "figure-mark.svg",
  pattern: "pattern-5-clean.svg",
  stamps: "stamps-strokes.svg",
} as const;

export type AssetKey = keyof typeof ASSET_FILES;

export function assetUrl(key: AssetKey): string | null {
  const file = ASSET_FILES[key];
  const onDisk = path.join(process.cwd(), "public", "assets", file);
  return fs.existsSync(onDisk) ? `/assets/${file}` : null;
}
