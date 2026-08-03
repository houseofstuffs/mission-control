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
  const haystack = flatten(filename);
  let best: { colour: string; length: number } | null = null;
  for (const colour of palette) {
    const needle = flatten(colour);
    if (!needle || !haystack.includes(needle)) continue;
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

  const haystack = flatten(filename);
  for (const { role, tokens } of INFO_GRAPHIC_ROLES) {
    if (tokens.some((t) => haystack.includes(t))) return { kind: "info-graphic", role };
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
