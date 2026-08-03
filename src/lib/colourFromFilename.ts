/**
 * Reads a garment colour out of a mockup filename.
 *
 * Two real formats in the shop's Drive, and no positional rule covers
 * both — the colour is a leading PascalCase token in one and an
 * underscore-separated run in the middle of the other:
 *
 *   BlueJean_C1466_MBLF_3924-7.png
 *   20_Comfort_Colors_1717_Blue_Jean_Tshirt_Mockup_2000x2000.jpg
 *
 * So don't parse position: flatten both the filename and the known
 * palette to letters-and-digits, then look the palette up inside the
 * name. "Blue Jean" and "BlueJean" both flatten to "bluejean", which is
 * what makes one matcher cover every format the supplier invents next.
 *
 * The palette is the listing's own colours (Mockup Colors, else
 * Colorways) — matching against a closed set, never guessing a colour out
 * of arbitrary text, is what keeps "Comfort_Colors" from reading as a
 * colour and a size chart from becoming a variant.
 */

/** Letters and digits only, lowercased — the form both formats agree on. */
export function flatten(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The filename split into words, so a match can be required to start and
 * end on a real boundary.
 *
 * Flattening the WHOLE name into one string and searching inside it was too
 * loose in exactly the way brand names punish: every file in the shop's
 * folder is named "GOLDIE MOCKS - Comfort Colors 1466 - GM052 Yam - ...",
 * and "goldiemocks" contains "gold". Longest-match then preferred the
 * supplier's brand over the actual colour on every short name — Yam (3)
 * lost to Gold (4) outright, Grey (4) lost the tie on palette order. The
 * other twelve colours only survived by being longer than "gold".
 *
 * Splitting on separators alone isn't enough either, because one of the two
 * real formats glues the colour together as PascalCase ("BlueJean_C1466"),
 * so case transitions and letter/digit transitions are boundaries too.
 */
function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // BlueJean -> Blue Jean
    .replace(/([A-Za-z])([0-9])/g, "$1 $2") // Yam3924  -> Yam 3924
    .replace(/([0-9])([A-Za-z])/g, "$1 $2") // 1466MBLF -> 1466 MBLF
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Does some run of whole words join to exactly `needle`? "Blue Jean",
 * "Blue_Jean" and "BlueJean" all reach "bluejean"; "goldie" never reaches
 * "gold".
 */
function hasWordRun(words: string[], needle: string): boolean {
  for (let i = 0; i < words.length; i++) {
    let joined = "";
    for (let j = i; j < words.length; j++) {
      joined += words[j];
      if (joined === needle) return true;
      if (joined.length >= needle.length) break;
    }
  }
  return false;
}

/** Filenames that are branded graphics rather than a garment colour. */
const INFO_GRAPHIC_ROLES: Array<{ role: string; tokens: string[] }> = [
  { role: "Highlights & Sizing", tokens: ["sizechart", "sizeguide", "sizing", "measurements"] },
  { role: "Care & Policies", tokens: ["careinfo", "careguide", "washcare", "care"] },
  { role: "Colorways", tokens: ["colorway", "colourway", "colorchart", "colourchart"] },
];

export type FileRole =
  | { kind: "variant"; colour: string }
  | { kind: "info-graphic"; role: string }
  | { kind: "unknown" };

/**
 * The palette entry this filename names, or null.
 *
 * Longest match wins, and that isn't a tie-breaker detail — a palette
 * holding both "Blue" and "Blue Jean" would otherwise label every Blue
 * Jean file "Blue".
 */
export function detectColour(filename: string, palette: string[]): string | null {
  const parts = words(filename);
  let best: { colour: string; length: number } | null = null;
  for (const colour of palette) {
    const needle = flatten(colour);
    if (!needle || !hasWordRun(parts, needle)) continue;
    if (!best || needle.length > best.length) best = { colour, length: needle.length };
  }
  return best?.colour ?? null;
}

/**
 * What this file is for. A colour match makes it a variant; otherwise a
 * branded-graphic keyword routes it to the matching Product graphic. The
 * colour check runs FIRST so a colour named after a keyword can't be
 * misrouted.
 */
export function classifyFile(filename: string, palette: string[]): FileRole {
  const colour = detectColour(filename, palette);
  if (colour) return { kind: "variant", colour };

  // same boundary rule — "care" should match "Care Guide", not "Scarecrow"
  const parts = words(filename);
  for (const { role, tokens } of INFO_GRAPHIC_ROLES) {
    if (tokens.some((t) => hasWordRun(parts, t))) return { kind: "info-graphic", role };
  }
  return { kind: "unknown" };
}

export interface ClassifiedFile {
  id: string;
  name: string;
  role: FileRole;
}

/**
 * Classifies a folder listing. Colours outside the palette never appear —
 * the supplier ships every colour they sell, and only the ones this
 * listing actually offers should become variants (same rule L4 and L5
 * already apply).
 */
export function classifyFolder(
  files: Array<{ id: string; name: string }>,
  palette: string[]
): ClassifiedFile[] {
  return files.map((f) => ({ ...f, role: classifyFile(f.name, palette) }));
}
