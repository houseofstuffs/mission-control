/**
 * The branded colour card — "available colors" with the design across
 * this listing's garment colours, colour labels, brand dots, and the
 * soft-limit footer. Replaces the untyped grid composite: every colour
 * grid the shop ships carries the title, names and copy line, so the
 * card IS the product, not a contact sheet.
 *
 * Geometry and type come from CARD_GEOM (measured off the approved
 * references at 2000px; everything scales proportionally). All cells are
 * square, equal-sized across the whole card, and FIT the whole render —
 * never cover-cropped. Full-width rows span margin to margin; narrower
 * rows centre; the row block centres vertically in the image area.
 */
import sharp, { type OverlayOptions } from "sharp";
import { CARD_DEFAULTS, CARD_GEOM, CARD_ROWS } from "@/config/mockups";
import { textFragment } from "./cardText";

export interface CardCell {
  image: Buffer;
  /** garment colour, from the render record — rendered lowercase */
  label: string;
}

export interface CardTextInputs {
  title?: string;
  footer?: string;
  email?: string;
}

function hexRgb(hex: string): { r: number; g: number; b: number; alpha: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

/** Equal square cell edge for a layout: width-bound by its widest row, height-bound by its row count. */
export function cardCellEdge(rows: number[], edge = CARD_GEOM.edge): number {
  const k = edge / CARD_GEOM.edge;
  const g = CARD_GEOM;
  const maxRow = Math.max(...rows);
  const widthBound = (edge - 2 * g.margin * k - (maxRow - 1) * g.gutter * k) / maxRow;
  const availH = (2000 - g.imageTop - g.footerReserve) * k;
  const heightBound = (availH - rows.length * g.labelBlock * k - (rows.length - 1) * g.gutter * k) / rows.length;
  return Math.floor(Math.min(widthBound, heightBound));
}

export async function buildColourCard(
  cells: CardCell[],
  rows: number[],
  text: CardTextInputs = {},
  edge = CARD_GEOM.edge
): Promise<Buffer> {
  if (cells.length !== rows.reduce((a, b) => a + b, 0)) {
    throw new Error(`layout ${rows.join("+")} needs ${rows.reduce((a, b) => a + b, 0)} renders — got ${cells.length}`);
  }
  const g = CARD_GEOM;
  const k = edge / g.edge; // proportional scale
  const s = (v: number) => v * k;
  const title = (text.title ?? CARD_DEFAULTS.title).trim() || CARD_DEFAULTS.title;
  const footer = (text.footer ?? CARD_DEFAULTS.footer).trim();
  const email = (text.email ?? CARD_DEFAULTS.email).trim();

  const cell = cardCellEdge(rows, edge);
  const rowBlock = cell + s(g.labelBlock);
  const gridH = rows.length * rowBlock + (rows.length - 1) * s(g.gutter);
  const availTop = s(g.imageTop);
  const availH = edge - s(g.footerReserve) - availTop;
  const y0 = Math.round(availTop + (availH - gridH) / 2);

  // ---- the text layer: one SVG of outline paths, bars and dots ----
  const svg: string[] = [];
  const titleFrag = await textFragment(title.toLowerCase(), "fredoka600", s(g.titleSize), s(g.margin), s(g.titleBaseline), g.ink);
  svg.push(titleFrag.svg);
  g.dots.forEach((colour, i) => {
    svg.push(
      `<circle cx="${s(g.margin) + s(g.dotSize) / 2 + i * s(g.dotSpacing)}" cy="${s(g.dotCentreY)}" r="${s(g.dotSize) / 2}" fill="${colour}"/>`
    );
  });
  if (footer) {
    svg.push((await textFragment(footer, "nunito400italic", s(g.footerSize), s(g.margin), s(g.footerBaseline), g.muted)).svg);
  }
  if (email) {
    svg.push((await textFragment(email, "nunito700", s(g.emailSize), s(g.margin), s(g.emailBaseline), g.candy)).svg);
  }

  // ---- cells + labels, row by row ----
  const composites: OverlayOptions[] = [];
  let idx = 0;
  for (let r = 0; r < rows.length; r++) {
    const n = rows[r];
    const rowW = n * cell + (n - 1) * s(g.gutter);
    const x0 = Math.round((edge - rowW) / 2); // full-width rows land exactly on the margin
    const rowTop = Math.round(y0 + r * (rowBlock + s(g.gutter)));
    for (let c = 0; c < n; c++, idx++) {
      const left = Math.round(x0 + c * (cell + s(g.gutter)));
      const img = await sharp(cells[idx].image)
        .resize(cell, cell, { fit: "contain", background: hexRgb(g.bg) })
        .png()
        .toBuffer();
      composites.push({ input: img, left, top: rowTop });
      // label: candy bar at the cell's left edge, name indented, always lowercase
      const barTop = rowTop + cell + s(g.labelGapTop);
      svg.push(
        `<rect x="${left}" y="${barTop}" width="${s(g.labelBarW)}" height="${s(g.labelBarH)}" fill="${g.candy}"/>`
      );
      svg.push(
        (
          await textFragment(
            cells[idx].label.trim().toLowerCase(),
            "nunito600",
            s(g.labelSize),
            left + s(g.labelIndent),
            barTop + s(g.labelBarH) - s(2),
            g.ink
          )
        ).svg
      );
    }
  }

  const svgDoc = `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}">${svg.join("")}</svg>`;
  composites.push({ input: Buffer.from(svgDoc) });

  return sharp({ create: { width: edge, height: edge, channels: 4, background: hexRgb(g.bg) } })
    .composite(composites)
    .png()
    .toBuffer();
}
