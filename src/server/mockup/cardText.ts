/**
 * Text-to-vector for the colour card. The deployment container has no
 * fonts installed, so SVG <text> would silently render in whatever
 * fontconfig scrapes up (usually nothing). Instead the brand faces ship
 * as static TTFs in public/fonts/ and fontkit converts each string to
 * outline paths at build time — deterministic on every host.
 *
 * fontkit, not opentype.js: opentype's shaping produced NaNs in path
 * data for certain string/position combinations (truncating "grape" and
 * the shop email mid-word); fontkit's layout is the engine PDFKit ships
 * on and handles these fonts cleanly. The TTFs have GSUB stripped (no
 * ligatures — matching the references) while GPOS kerning stays.
 */
import { readFile } from "fs/promises";
import path from "path";
import { create as fontkitCreate, type Font } from "fontkit";

export type CardFace = "fredoka600" | "nunito600" | "nunito700" | "nunito400italic";

const cache = new Map<CardFace, Font>();

async function font(face: CardFace): Promise<Font> {
  const got = cache.get(face);
  if (got) return got;
  const buf = await readFile(path.join(process.cwd(), "public", "fonts", `${face}.ttf`));
  const parsed = fontkitCreate(buf) as Font;
  cache.set(face, parsed);
  return parsed;
}

/**
 * An SVG fragment (a <g> of glyph paths) drawing `text` with its
 * baseline starting at (x, y) in canvas px, plus the advance width.
 * Glyph outlines are in font units, y-up — the group transform scales
 * and flips them into place, so the path data itself is never touched.
 */
export async function textFragment(
  text: string,
  face: CardFace,
  sizePx: number,
  x: number,
  y: number,
  fill: string
): Promise<{ svg: string; width: number }> {
  const f = await font(face);
  const run = f.layout(text);
  const scale = sizePx / f.unitsPerEm;
  const parts: string[] = [];
  let pen = 0;
  for (let i = 0; i < run.glyphs.length; i++) {
    const d = run.glyphs[i].path.toSVG();
    const pos = run.positions[i];
    if (d) {
      parts.push(`<path transform="translate(${pen + pos.xOffset} ${pos.yOffset})" d="${d}"/>`);
    }
    pen += pos.xAdvance;
  }
  return {
    svg: `<g fill="${fill}" transform="translate(${x} ${y}) scale(${scale} ${-scale})">${parts.join("")}</g>`,
    width: pen * scale,
  };
}
