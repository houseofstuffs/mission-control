/**
 * Mockup compositing — pure pixels, no external services.
 *
 * ONE entry point, renderMockup(), and the template's Pipeline Type decides
 * which method runs. The choice was made at intake; render never asks.
 *
 *   Simple Placement   perspective-warp the artwork into the print-area quad,
 *                      composite onto the base with the template's blend mode.
 *
 *   Full Displacement  warp the artwork through the displacement map so it
 *                      follows the fabric, then composite shadow (multiply)
 *                      and highlight (screen) layers over it — each ONLY if
 *                      present, skipped silently if not. That's by contract:
 *                      many purchased mockups ship without them, and a
 *                      missing optional layer is not a defect.
 *
 * Everything runs on raw RGBA buffers via sharp; the homography and the
 * displacement sampling are plain math over those buffers.
 */
import sharp from "sharp";
import {
  RENDER_MAX_EDGE,
  DISPLACEMENT_STRENGTH,
  FABRIC_TEXTURE_STRENGTH,
  DEFAULT_QUAD,
  DEFAULT_FIT,
  isIdentityPlacement,
  type ArtPlacement,
  type Quad,
  type PipelineType,
  type BlendMode,
  type FitMode,
} from "@/config/mockups";

export interface TemplateSpec {
  pipelineType: PipelineType;
  /** normalized TL→TR→BR→BL; required for Simple Placement */
  quad: Quad | null;
  blend: BlendMode;
  /** how artwork meets the area when ratios disagree — never stretched */
  fit?: FitMode;
  /** design-in-region adjustment (listing-scoped) — identity when absent */
  placement?: ArtPlacement | null;
}

export interface TemplateLayers {
  base: Buffer;
  displacement?: Buffer | null;
  shadow?: Buffer | null;
  highlight?: Buffer | null;
}

interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

async function loadRaw(buf: Buffer, maxEdge = RENDER_MAX_EDGE): Promise<Raw> {
  const { data, info } = await sharp(buf)
    .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/* ---------- homography: unit square → quad (Heckbert) ---------- */

type Mat3 = [number, number, number, number, number, number, number, number, number];

function squareToQuad(q: Quad): Mat3 {
  const [p0, p1, p2, p3] = q; // TL, TR, BR, BL ← (0,0),(1,0),(1,1),(0,1)
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    // affine — parallelogram
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  }
  const dx1 = p1.x - p2.x, dy1 = p1.y - p2.y;
  const dx2 = p3.x - p2.x, dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - sy * dx2) / den;
  const h = (dx1 * sy - dy1 * sx) / den;
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h] = m;
  const i = 1;
  const A = e * i - f * h, B = c * h - b * i, C = b * f - c * e;
  const D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
  const G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  const det = a * A + b * D + c * G;
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det];
}

/** Bilinear RGBA sample; returns transparent outside bounds. */
function sample(src: Raw, x: number, y: number, out: [number, number, number, number]): void {
  if (x < 0 || y < 0 || x > src.width - 1 || y > src.height - 1) {
    out[0] = out[1] = out[2] = out[3] = 0;
    return;
  }
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, src.width - 1), y1 = Math.min(y0 + 1, src.height - 1);
  const fx = x - x0, fy = y - y0;
  const i00 = (y0 * src.width + x0) * 4, i10 = (y0 * src.width + x1) * 4;
  const i01 = (y1 * src.width + x0) * 4, i11 = (y1 * src.width + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = src.data[i00 + c] * (1 - fx) + src.data[i10 + c] * fx;
    const bot = src.data[i01 + c] * (1 - fx) + src.data[i11 + c] * fx;
    out[c] = top * (1 - fy) + bot * fy;
  }
}

/**
 * Perspective-place artwork into `quad` on a transparent canvas of the base's
 * size. Inverse mapping: for every canvas pixel, ask which artwork pixel
 * lands there — no holes, no double-writes.
 *
 * The artwork's proportions are not negotiable — when the quad's shape
 * disagrees, `fit` decides which honest compromise to make:
 *   Fit inside — whole artwork, centred, leftover transparent (contain)
 *   Fill area  — area covered edge-to-edge, overflow cropped equally (cover)
 */
function warpToQuad(
  artwork: Raw,
  quad: Quad,
  width: number,
  height: number,
  fit: FitMode,
  placement?: ArtPlacement | null
): Raw {
  const px: Quad = quad.map((p) => ({ x: p.x * (width - 1), y: p.y * (height - 1) })) as Quad;
  const inv = invert(squareToQuad(px));

  // quad's pixel shape, approximated by average edge lengths — exact for
  // rectangles, close enough under perspective
  const edge = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(b.x - a.x, b.y - a.y);
  const quadAspect =
    (edge(px[0], px[1]) + edge(px[3], px[2])) / Math.max(1, edge(px[0], px[3]) + edge(px[1], px[2]));
  const artAspect = artwork.width / artwork.height;
  // Fit inside: the centred band of the unit square the artwork occupies.
  // Fill area: the band GROWS past the unit square — the quad shows a
  // centred crop of the artwork, and sampling outside [0,1] never happens
  // because only u,v inside the quad are visited.
  let u0 = 0, v0 = 0, uw = 1, vh = 1;
  if (fit === "Fill width from top") {
    // span the width exactly; the art extends downward from the top edge
    // and whatever passes the box's bottom is cropped — a folded garment.
    // vh > 1 when the box is wider than the art: bottom cropped. vh < 1
    // when taller: art hangs from the top, empty space below.
    vh = quadAspect / artAspect;
  } else if (fit === "Fill area") {
    if (artAspect > quadAspect) {
      uw = artAspect / quadAspect;
      u0 = (1 - uw) / 2;
    } else if (artAspect < quadAspect) {
      vh = quadAspect / artAspect;
      v0 = (1 - vh) / 2;
    }
  } else {
    if (artAspect > quadAspect) {
      vh = quadAspect / artAspect;
      v0 = (1 - vh) / 2;
    } else if (artAspect < quadAspect) {
      uw = artAspect / quadAspect;
      u0 = (1 - uw) / 2;
    }
  }
  const out = Buffer.alloc(width * height * 4);
  const rgba: [number, number, number, number] = [0, 0, 0, 0];

  // placement: the design moves WITHIN the region, clipped to it like
  // real DTG. Inverse mapping again — for a canvas pixel's (u,v) inside
  // the quad, where was that point before the design was scaled/moved/
  // rotated? Rotation runs in quad-METRIC space (u stretched by the
  // region's aspect) so it stays visually rigid on non-square regions.
  const place = placement && !isIdentityPlacement(placement) ? placement : null;
  const rotRad = place ? (-place.rot * Math.PI) / 180 : 0;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  // only the quad's bounding box can receive pixels
  const minX = Math.max(0, Math.floor(Math.min(...px.map((p) => p.x))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...px.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...px.map((p) => p.y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...px.map((p) => p.y))));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w = inv[6] * x + inv[7] * y + inv[8];
      let u = (inv[0] * x + inv[1] * y + inv[2]) / w;
      let v = (inv[3] * x + inv[4] * y + inv[5]) / w;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      if (place) {
        const mx = (u - 0.5 - place.dx) * quadAspect;
        const my = v - 0.5 - place.dy;
        const rx = mx * cosR - my * sinR;
        const ry = mx * sinR + my * cosR;
        u = rx / (quadAspect * place.scale) + 0.5;
        v = ry / place.scale + 0.5;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      }
      // remap through the contain band; outside it stays transparent
      const au = (u - u0) / uw;
      const av = (v - v0) / vh;
      if (au < 0 || au > 1 || av < 0 || av > 1) continue;
      sample(artwork, au * (artwork.width - 1), av * (artwork.height - 1), rgba);
      const i = (y * width + x) * 4;
      out[i] = rgba[0]; out[i + 1] = rgba[1]; out[i + 2] = rgba[2]; out[i + 3] = rgba[3];
    }
  }
  return { data: out, width, height };
}

/**
 * Push each pixel along the displacement map's brightness. Photoshop's
 * displace: mid-grey moves nothing, black/white push opposite ways, both
 * axes from the same map.
 */
function displace(layer: Raw, map: Raw): Raw {
  const strength = Math.max(layer.width, layer.height) * DISPLACEMENT_STRENGTH;
  const out = Buffer.alloc(layer.data.length);
  const rgba: [number, number, number, number] = [0, 0, 0, 0];
  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      const mi = (y * map.width + x) * 4;
      // map is loaded at layer dims; luminance of RGB (alpha ignored)
      const lum = 0.299 * map.data[mi] + 0.587 * map.data[mi + 1] + 0.114 * map.data[mi + 2];
      const d = ((lum - 128) / 128) * strength;
      sample(layer, x + d, y + d, rgba);
      const i = (y * layer.width + x) * 4;
      out[i] = rgba[0]; out[i + 1] = rgba[1]; out[i + 2] = rgba[2]; out[i + 3] = rgba[3];
    }
  }
  return { data: out, width: layer.width, height: layer.height };
}

function toPng(raw: Raw): Promise<Buffer> {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .png()
    .toBuffer();
}

async function resizedPng(buf: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(buf).resize(width, height, { fit: "fill" }).png().toBuffer();
}

/**
 * The dispatcher. `quadOverride` exists for design-specific placement
 * (spec: quad_override) — same machinery, different corners.
 *
 * `artworkOpacity` (0–1) MULTIPLIES the artwork's own alpha before
 * compositing — a preview knob for matching what ink actually does with
 * soft-alpha art on fabric, never stored, never applied to real exports.
 */
export async function renderMockup(
  spec: TemplateSpec,
  layers: TemplateLayers,
  artworkBuf: Buffer,
  quadOverride?: Quad | null,
  artworkOpacity = 1
): Promise<Buffer> {
  const base = await loadRaw(layers.base);
  const artwork = await loadRaw(artworkBuf, 2400);
  if (artworkOpacity < 1) {
    const k = Math.max(0.05, artworkOpacity);
    for (let i = 3; i < artwork.data.length; i += 4) {
      artwork.data[i] = Math.round(artwork.data[i] * k);
    }
  }
  const quad = quadOverride ?? spec.quad;
  const fit = spec.fit ?? DEFAULT_FIT;

  if (spec.pipelineType === "Simple Placement") {
    if (!quad) throw new Error("This template has no print-area corners yet — open it and place them.");
    const warped = warpToQuad(artwork, quad, base.width, base.height, fit, spec.placement);

    if (spec.blend === "Print (DTG)") {
      // White-underbase equivalent: art composites NORMAL so its colours
      // stay true on any garment, then the garment's own weave comes back
      // as a soft-light texture pass CLIPPED to the printed pixels. The
      // texture layer is the base's luminance, alpha = artAlpha × strength
      // — so fabric shows through the ink without tinting it the way
      // multiply does (off-white × espresso = brown was the bug).
      const texture = Buffer.alloc(base.data.length);
      for (let i = 0; i < base.data.length; i += 4) {
        const a = warped.data[i + 3];
        if (a === 0) continue; // outside the print — fully transparent
        const l = Math.round(
          0.2126 * base.data[i] + 0.7152 * base.data[i + 1] + 0.0722 * base.data[i + 2]
        );
        texture[i] = l;
        texture[i + 1] = l;
        texture[i + 2] = l;
        texture[i + 3] = Math.round(a * FABRIC_TEXTURE_STRENGTH);
      }
      const texturePng = await sharp(texture, {
        raw: { width: base.width, height: base.height, channels: 4 },
      })
        .png()
        .toBuffer();
      return sharp(await toPng(base))
        .composite([
          { input: await toPng(warped), blend: "over" },
          { input: texturePng, blend: "soft-light" },
        ])
        .png()
        .toBuffer();
    }

    return sharp(await toPng(base))
      .composite([{ input: await toPng(warped), blend: spec.blend === "Normal" ? "over" : "multiply" }])
      .png()
      .toBuffer();
  }

  // Full Displacement
  if (!layers.displacement) {
    throw new Error("This template is Full Displacement but has no displacement map.");
  }
  // Placement first: the quad if one was saved (optional crop guide), else a
  // centred box — the artwork has to sit somewhere before the fabric warps it.
  const placed = warpToQuad(artwork, quad ?? DEFAULT_QUAD, base.width, base.height, fit, spec.placement);
  const map = await loadRaw(layers.displacement).then((m) =>
    m.width === base.width && m.height === base.height
      ? m
      : loadRaw(layers.displacement!, Math.max(base.width, base.height))
  );
  // guard: map must cover the base grid — resample to exact base dims
  const mapExact =
    map.width === base.width && map.height === base.height
      ? map
      : {
          data: (await sharp(map.data, { raw: { width: map.width, height: map.height, channels: 4 } })
            .resize(base.width, base.height, { fit: "fill" })
            .raw()
            .toBuffer()),
          width: base.width,
          height: base.height,
        };
  const rippled = displace(placed, mapExact);

  // Artwork over the photo: with a shadow layer the shading comes back on
  // top, so the artwork composites normal; without one, multiply keeps the
  // base's own shading visible through the ink.
  const overlays: Array<{ input: Buffer; blend: "over" | "multiply" | "screen" }> = [
    { input: await toPng(rippled), blend: layers.shadow ? "over" : "multiply" },
  ];
  // Optional layers: composite ONLY if present, silently skip if null —
  // no error, no warning. Contract, not oversight.
  if (layers.shadow) {
    overlays.push({ input: await resizedPng(layers.shadow, base.width, base.height), blend: "multiply" });
  }
  if (layers.highlight) {
    overlays.push({ input: await resizedPng(layers.highlight, base.width, base.height), blend: "screen" });
  }

  return sharp(await toPng(base)).composite(overlays).png().toBuffer();
}
