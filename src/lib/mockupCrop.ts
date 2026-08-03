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
 * Crops `file` to `rect`'s square and resizes to exactly target×target.
 * Pass the target from cropOutputSize() so this never upscales.
 */
export async function cropToStandardSize(file: File, rect: CropRect, target: number): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const { sx, sy, side } = squareSource(rect, bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    throw new Error("Canvas 2D context unavailable.");
  }
  // close only AFTER the draw — a closed bitmap is detached, and drawing
  // one throws InvalidStateError
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, target, target);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Couldn't encode the cropped image.");
  const name = file.name.replace(/\.[^.]+$/, "") + `-${target}.png`;
  return new File([blob], name, { type: "image/png" });
}
