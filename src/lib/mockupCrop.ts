/**
 * Client-side mockup crop — runs against the ORIGINAL file, before
 * downscaleImage() ever touches it, so the resolution the standard output
 * needs is never lost in transit.
 *
 * `size` is the square's side as a fraction of the photo's SHORTER edge,
 * which makes the rect a true square in pixels on any aspect ratio. It
 * used to be one fraction applied to both axes — on a 6830×5464 photo
 * that marked a 3125×2514 region, drawn into a square canvas and so
 * squashed, while the on-screen overlay showed the same lie. Anchoring to
 * the shorter edge keeps what you drag, what you see and what you get the
 * same shape.
 */

export interface CropRect {
  x: number; // 0–1, left edge as a fraction of the reference photo's width
  y: number; // 0–1, top edge as a fraction of the reference photo's height
  size: number; // 0–1, the square's side as a fraction of the SHORTER edge
}

export async function nativeDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return dims;
}

/** The square's side in source pixels. */
export function cropSquarePixels(width: number, height: number, rect: CropRect): number {
  return Math.floor(rect.size * Math.min(width, height));
}

/**
 * The rect as normalized width/height for the overlay. They differ on a
 * non-square photo — that difference is exactly what makes the drawn box
 * render square over the image.
 */
export function rectNormalizedSize(
  width: number,
  height: number,
  rect: CropRect
): { w: number; h: number } {
  const side = rect.size * Math.min(width, height);
  return { w: side / width, h: side / height };
}

/**
 * The biggest square this photo can give, centred.
 *
 * The common case for a mockup shot is "the whole frame, squared off", so
 * that is where the box should start — dragging it out to the edges by hand
 * every time was work the default could have done. Needs the dimensions
 * because centring a square in a non-square photo depends on which edge is
 * shorter, which is why this isn't a constant.
 */
export function maxCenteredSquare(width: number, height: number): CropRect {
  const side = Math.min(width, height);
  return { x: (width - side) / 2 / width, y: (height - side) / 2 / height, size: 1 };
}

/**
 * The side this crop should be written at: its own pixels, capped at `max`
 * and never upscaled. Returns null when the crop can't reach `min` — that
 * one is too small to use, and no resampling fixes it.
 */
export function cropOutputSize(
  width: number,
  height: number,
  rect: CropRect,
  min: number,
  max: number
): number | null {
  const px = cropSquarePixels(width, height, rect);
  return px < min ? null : Math.min(px, max);
}

/** The square in source pixels, kept inside the image. */
function squareSource(rect: CropRect, width: number, height: number) {
  const side = rect.size * Math.min(width, height);
  // a rect dragged to the edge must not read out of bounds
  const sx = Math.min(Math.max(rect.x * width, 0), Math.max(width - side, 0));
  const sy = Math.min(Math.max(rect.y * height, 0), Math.max(height - side, 0));
  return { sx, sy, side };
}

/**
 * The upload budget for one cropped photo.
 *
 * Next.js route handlers reject a request body over ~10MB, and they reject
 * it in the least helpful way available: req.formData() throws "Failed to
 * parse body as FormData", which reads like malformed multipart rather than
 * "too big". A 4000² crop of a real photo encodes to ~20MB as PNG, so every
 * upload of a full-size crop failed, every time, with a message pointing
 * nowhere near the cause. Budget is set below the wall to leave room for
 * the other form fields and multipart framing.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** The floor a crop may never be shrunk past to fit the budget. */
const MOCKUP_CROP_MIN = 2000;

/** Quality ladder — first rung under budget wins. */
const WEBP_QUALITY_STEPS = [0.92, 0.85, 0.78, 0.7, 0.6];

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Encodes this canvas under MAX_UPLOAD_BYTES, or returns null to say no
 * quality setting got there.
 *
 * Lossy is the right default and costs nothing real: the receiving route
 * re-encodes every layer to WebP with sharp regardless, so a lossless PNG
 * upload only ever paid ~20MB of transfer to hand the server pixels it was
 * about to throw away.
 */
async function encodeUnderBudget(canvas: HTMLCanvasElement): Promise<{ blob: Blob; ext: string } | null> {
  for (const quality of WEBP_QUALITY_STEPS) {
    const blob = await toBlob(canvas, "image/webp", quality);
    // a browser that can't encode WebP silently hands back PNG — take the
    // JPEG path rather than shipping an unbudgeted PNG
    if (!blob || blob.type !== "image/webp") break;
    if (blob.size <= MAX_UPLOAD_BYTES) return { blob, ext: "webp" };
  }
  for (const quality of WEBP_QUALITY_STEPS) {
    const blob = await toBlob(canvas, "image/jpeg", quality);
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return { blob, ext: "jpg" };
  }
  return null;
}

function drawSquare(bitmap: ImageBitmap, rect: CropRect, size: number): HTMLCanvasElement {
  const { sx, sy, side } = squareSource(rect, bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}

/**
 * Crops `file` to `rect`'s square and resizes to exactly target×target.
 * Pass the target from cropOutputSize() so this never upscales.
 *
 * Resolution is given up only after quality is: an exceptionally detailed
 * crop drops through the quality ladder first, and shrinks the square only
 * if even the lowest quality won't fit the upload. Never below
 * MOCKUP_CROP_MIN — under that a variant isn't worth saving, so failing
 * loudly beats quietly storing one.
 */
export async function cropToStandardSize(
  file: File,
  rect: CropRect,
  target: number
): Promise<{ file: File; size: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    for (let size = target; ; size = Math.round(size * 0.8)) {
      const encoded = await encodeUnderBudget(drawSquare(bitmap, rect, size));
      if (encoded) {
        const name = file.name.replace(/\.[^.]+$/, "") + `-${size}.${encoded.ext}`;
        // size is what was ACTUALLY produced, not what was asked for — the
        // variant's name records it, and a name that lies about resolution
        // is worse than no name at all
        return { file: new File([encoded.blob], name, { type: encoded.blob.type }), size };
      }
      if (Math.round(size * 0.8) < MOCKUP_CROP_MIN) {
        throw new Error(
          `This photo won't compress under ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB ` +
            `without dropping below ${MOCKUP_CROP_MIN}px. Re-crop a smaller region.`
        );
      }
    }
  } finally {
    // close only AFTER every draw — a closed bitmap is detached, and
    // drawing one throws InvalidStateError
    bitmap.close?.();
  }
}
