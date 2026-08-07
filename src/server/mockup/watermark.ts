/**
 * The "stuffs" watermark — applied to the ARTWORK-DETAIL output only.
 * That image shows the artwork clean, so it's the most rip-off-able
 * thing in the listing; garment mockups and print close-ups never get
 * marked.
 *
 * The word is a VENDORED VECTOR PATH: "stuffs" set in Fredoka 600 (the
 * brand header face), converted to outlines once with fontTools. No
 * font needs to exist on the deployment container, and the mark renders
 * identically everywhere. Regenerate the path by re-running the
 * fontTools step against Fredoka wght=600 if the brand face ever
 * changes.
 *
 * Spec (operator's, expressed as ratios of the output edge so it scales
 * at any size): size 10.6% of edge, opacity 9%, angle -30deg,
 * step-and-repeat with horizontal step 56% / vertical step 24% of edge,
 * alternate rows offset half a step. White on the dark background;
 * brand ink on the light eggshell.
 */
import sharp from "sharp";

/** "stuffs" in Fredoka 600, font units (upem 1000, y-up, baseline 0). */
const WORD_PATH = "M221.0 -17Q194.0 -17 162.5 -11.0Q131.0 -5 101.0 6.5Q71.0 18 51.0 33.5Q31.0 49 28.0 69Q26.0 79 28.5 90.5Q31.0 102 38.0 114.5Q45.0 127 55.0 141Q63.0 152 73.0 155.0Q83.0 158 96.0 154Q112.0 151 128.5 143.5Q145.0 136 161.5 127.5Q178.0 119 196.0 112.5Q214.0 106 233.0 106Q261.0 106 276.5 114.5Q292.0 123 292.0 138Q292.0 149 285.5 156.0Q279.0 163 267.5 168.5Q256.0 174 241.0 178.0Q226.0 182 208.5 186.5Q191.0 191 173.0 196Q148.0 203 125.0 214.0Q102.0 225 83.0 242.5Q64.0 260 53.0 285.5Q42.0 311 42.0 348Q42.0 397 65.0 430.0Q88.0 463 132.0 480.5Q176.0 498 239.0 498Q257.0 498 275.0 496.0Q293.0 494 310.5 489.0Q328.0 484 345.0 477.0Q362.0 470 379.0 460Q409.0 446 410.0 422.0Q411.0 398 393.0 373Q382.0 356 370.0 348.5Q358.0 341 345.0 344Q329.0 348 310.5 357.0Q292.0 366 271.5 374.0Q251.0 382 231.0 382Q214.0 382 202.0 377.5Q190.0 373 184.0 365.5Q178.0 358 178.0 348Q178.0 335 185.5 327.5Q193.0 320 206.0 315.0Q219.0 310 236.0 306.0Q253.0 302 273.0 298Q300.0 293 328.5 284.5Q357.0 276 380.5 260.0Q404.0 244 418.5 217.0Q433.0 190 433.0 146Q433.0 67 378.0 25.0Q323.0 -17 221.0 -17ZM756.0 -9Q705.0 -9 668.5 2.0Q632.0 13 608.0 36.0Q584.0 59 572.5 94.5Q561.0 130 561.0 179V585Q561.0 605 564.5 621.0Q568.0 637 584.0 647.5Q600.0 658 636.0 658Q672.0 658 688.0 647.0Q704.0 636 707.5 619.0Q711.0 602 711.0 582V185Q711.0 169 713.5 158.5Q716.0 148 721.0 143.0Q726.0 138 735.0 136.0Q744.0 134 757.0 134Q779.0 134 796.0 130.0Q813.0 126 822.5 112.0Q832.0 98 832.0 65Q832.0 29 821.0 13.0Q810.0 -3 792.5 -6.0Q775.0 -9 756.0 -9ZM530.0 483H640.0L778.0 487Q797.0 487 814.0 483.5Q831.0 480 842.0 464.0Q853.0 448 853.0 411Q853.0 377 842.5 361.0Q832.0 345 815.0 340.5Q798.0 336 778.0 336L647.0 339H526.0Q497.0 340 485.5 356.5Q474.0 373 474.0 412Q474.0 448 488.0 465.5Q502.0 483 530.0 483ZM1125.0 -8Q1079.0 -8 1038.5 10.0Q998.0 28 968.0 60.5Q938.0 93 921.5 137.5Q905.0 182 905.0 235V416Q905.0 436 909.0 453.0Q913.0 470 928.5 481.0Q944.0 492 981.0 492Q1018.0 492 1033.5 481.0Q1049.0 470 1052.5 452.5Q1056.0 435 1056.0 415V235Q1056.0 206 1066.5 184.5Q1077.0 163 1097.5 152.0Q1118.0 141 1146.0 141Q1175.0 141 1195.5 152.5Q1216.0 164 1227.5 185.0Q1239.0 206 1239.0 235V417Q1239.0 437 1243.0 454.0Q1247.0 471 1262.5 481.5Q1278.0 492 1315.0 492Q1352.0 492 1367.5 481.0Q1383.0 470 1386.5 452.5Q1390.0 435 1390.0 416V64Q1390.0 45 1386.5 28.5Q1383.0 12 1367.0 2.0Q1351.0 -8 1315.0 -8Q1288.0 -8 1273.0 -2.0Q1258.0 4 1251.0 13.0Q1244.0 22 1242.5 32.0Q1241.0 42 1241.0 50L1254.0 61Q1251.0 57 1241.0 46.0Q1231.0 35 1214.5 22.5Q1198.0 10 1176.0 1.0Q1154.0 -8 1125.0 -8ZM1603.0 -10Q1568.0 -10 1552.0 1.0Q1536.0 12 1532.5 29.5Q1529.0 47 1529.0 67V535Q1529.0 569 1540.0 602.0Q1551.0 635 1575.0 661.5Q1599.0 688 1636.0 704.0Q1673.0 720 1726.0 720Q1745.0 720 1762.5 716.5Q1780.0 713 1790.5 697.5Q1801.0 682 1801.0 645Q1801.0 608 1790.0 592.5Q1779.0 577 1761.5 573.5Q1744.0 570 1725.0 570Q1712.0 570 1703.5 568.5Q1695.0 567 1690.0 564.0Q1685.0 561 1682.5 554.0Q1680.0 547 1680.0 537V64Q1680.0 45 1676.0 28.0Q1672.0 11 1656.0 0.5Q1640.0 -10 1603.0 -10ZM1498.0 483H1608.0L1746.0 487Q1765.0 487 1782.0 483.5Q1799.0 480 1810.0 464.0Q1821.0 448 1821.0 411Q1821.0 377 1810.5 361.0Q1800.0 345 1783.0 340.5Q1766.0 336 1746.0 336L1615.0 339H1494.0Q1465.0 340 1453.5 356.5Q1442.0 373 1442.0 412Q1442.0 448 1456.0 465.5Q1470.0 483 1498.0 483ZM2008.0 -10Q1973.0 -10 1957.0 1.0Q1941.0 12 1937.5 29.5Q1934.0 47 1934.0 67V535Q1934.0 569 1945.0 602.0Q1956.0 635 1980.0 661.5Q2004.0 688 2041.0 704.0Q2078.0 720 2131.0 720Q2150.0 720 2167.5 716.5Q2185.0 713 2195.5 697.5Q2206.0 682 2206.0 645Q2206.0 608 2195.0 592.5Q2184.0 577 2166.5 573.5Q2149.0 570 2130.0 570Q2117.0 570 2108.5 568.5Q2100.0 567 2095.0 564.0Q2090.0 561 2087.5 554.0Q2085.0 547 2085.0 537V64Q2085.0 45 2081.0 28.0Q2077.0 11 2061.0 0.5Q2045.0 -10 2008.0 -10ZM1903.0 483H2013.0L2151.0 487Q2170.0 487 2187.0 483.5Q2204.0 480 2215.0 464.0Q2226.0 448 2226.0 411Q2226.0 377 2215.5 361.0Q2205.0 345 2188.0 340.5Q2171.0 336 2151.0 336L2020.0 339H1899.0Q1870.0 340 1858.5 356.5Q1847.0 373 1847.0 412Q1847.0 448 1861.0 465.5Q1875.0 483 1903.0 483ZM2460.0 -17Q2433.0 -17 2401.5 -11.0Q2370.0 -5 2340.0 6.5Q2310.0 18 2290.0 33.5Q2270.0 49 2267.0 69Q2265.0 79 2267.5 90.5Q2270.0 102 2277.0 114.5Q2284.0 127 2294.0 141Q2302.0 152 2312.0 155.0Q2322.0 158 2335.0 154Q2351.0 151 2367.5 143.5Q2384.0 136 2400.5 127.5Q2417.0 119 2435.0 112.5Q2453.0 106 2472.0 106Q2500.0 106 2515.5 114.5Q2531.0 123 2531.0 138Q2531.0 149 2524.5 156.0Q2518.0 163 2506.5 168.5Q2495.0 174 2480.0 178.0Q2465.0 182 2447.5 186.5Q2430.0 191 2412.0 196Q2387.0 203 2364.0 214.0Q2341.0 225 2322.0 242.5Q2303.0 260 2292.0 285.5Q2281.0 311 2281.0 348Q2281.0 397 2304.0 430.0Q2327.0 463 2371.0 480.5Q2415.0 498 2478.0 498Q2496.0 498 2514.0 496.0Q2532.0 494 2549.5 489.0Q2567.0 484 2584.0 477.0Q2601.0 470 2618.0 460Q2648.0 446 2649.0 422.0Q2650.0 398 2632.0 373Q2621.0 356 2609.0 348.5Q2597.0 341 2584.0 344Q2568.0 348 2549.5 357.0Q2531.0 366 2510.5 374.0Q2490.0 382 2470.0 382Q2453.0 382 2441.0 377.5Q2429.0 373 2423.0 365.5Q2417.0 358 2417.0 348Q2417.0 335 2424.5 327.5Q2432.0 320 2445.0 315.0Q2458.0 310 2475.0 306.0Q2492.0 302 2512.0 298Q2539.0 293 2567.5 284.5Q2596.0 276 2619.5 260.0Q2643.0 244 2657.5 217.0Q2672.0 190 2672.0 146Q2672.0 67 2617.0 25.0Q2562.0 -17 2460.0 -17Z";
const WORD_UPEM = 1000;

export const WATERMARK_DEFAULTS = {
  on: true,
  /** 0-1; the committed treatment is 9% */
  opacity: 0.09,
  /** em size as a fraction of the output edge */
  sizeFrac: 0.106,
  angleDeg: -30,
  stepXFrac: 0.56,
  stepYFrac: 0.24,
  darkColour: "#FFFFFF",
  /** brand ink for the light/eggshell background */
  lightColour: "#2A3540",
  /**
   * Measured: 9% ink on eggshell blends ~20% fainter than 9% white on
   * black (pixel deltas 56 vs 69). This boost applies to the LIGHT
   * background only, so the mark reads equally faint on both.
   */
  lightBoost: 1.25,
  /**
   * Tile-phase shift along the -30deg axis (up and to the right), as a
   * fraction of the output edge. The default half-vertical-step moves
   * the corner marks further INTO the canvas so they read as whole
   * words, not clipped mistakes. Step-and-repeat means this changes
   * WHICH marks meet the edges, never coverage or density. Both
   * backgrounds share the footprint.
   */
  shift: 0.12,
};

export interface WatermarkSettings {
  on: boolean;
  opacity: number;
  /** phase shift along the -30deg axis, fraction of edge */
  shift: number;
}

export function parseWatermark(raw: unknown): WatermarkSettings {
  const o = (raw ?? {}) as { on?: unknown; opacity?: unknown; shift?: unknown };
  const op = Number(o.opacity);
  const sh = Number(o.shift);
  return {
    on: o.on === undefined ? WATERMARK_DEFAULTS.on : Boolean(o.on),
    opacity: Number.isFinite(op) ? Math.min(0.5, Math.max(0.02, op)) : WATERMARK_DEFAULTS.opacity,
    shift: Number.isFinite(sh) ? Math.min(0.5, Math.max(-0.5, sh)) : WATERMARK_DEFAULTS.shift,
  };
}

/** The tiled overlay as an SVG document sized edge x edge. */
export function watermarkSvg(edge: number, colour: string, opacity: number, shift = WATERMARK_DEFAULTS.shift): string {
  const d = WATERMARK_DEFAULTS;
  const scale = (d.sizeFrac * edge) / WORD_UPEM;
  const stepX = d.stepXFrac * edge;
  const stepY = d.stepYFrac * edge;
  // the phase shift rides the lattice's own x-axis; the outer rotation
  // turns that into "up and to the right" on the canvas
  const phase = shift * edge;
  // lattice big enough that the -30deg rotation still covers the corners
  const uses: string[] = [];
  let row = 0;
  for (let y = -edge; y <= edge * 2; y += stepY, row++) {
    const off = (row % 2 === 1 ? stepX / 2 : 0) + phase;
    for (let x = -edge; x <= edge * 2; x += stepX) {
      uses.push(`<use href="#w" xlink:href="#w" x="${((x + off) / scale).toFixed(1)}" y="${(y / scale).toFixed(1)}"/>`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${edge}" height="${edge}">` +
    `<defs><path id="w" transform="scale(1,-1)" d="${WORD_PATH}"/></defs>` +
    `<g transform="rotate(${d.angleDeg} ${edge / 2} ${edge / 2}) scale(${scale})" fill="${colour}" fill-opacity="${opacity}">` +
    uses.join("") +
    `</g></svg>`
  );
}

/** Composite the mark over a square image buffer (edge x edge). */
export async function applyWatermark(
  image: Buffer,
  edge: number,
  background: "dark" | "light",
  settings: WatermarkSettings
): Promise<Buffer> {
  if (!settings.on) return image;
  const colour = background === "dark" ? WATERMARK_DEFAULTS.darkColour : WATERMARK_DEFAULTS.lightColour;
  const opacity =
    background === "light" ? Math.min(0.5, settings.opacity * WATERMARK_DEFAULTS.lightBoost) : settings.opacity;
  const svg = watermarkSvg(edge, colour, opacity, settings.shift);
  return sharp(image).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}
