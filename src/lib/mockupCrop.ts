/**
 * Client-side mockup crop — runs against the ORIGINAL file, before
 * downscaleImage() ever touches it, so the resolution the standard output
 * needs is never lost in transit.
 *
 * A CropRect's `size` is ONE fraction applied to both axes, so on a
 * non-square photo the region it marks is not square in pixels: 0.46 of a
 * 6830×5464 shot is 3125×2514. The output is always 1:1, so what gets
 * drawn is the largest true square inside that region, centred — drawing
 * the whole rectangle into a square canvas would squash the garment.
 * That square's side is also what decides the output resolution.
 */

export interface CropRect {
  x: number; // 0–1, left edge as a fraction of the reference photo's width
  y: number; // 0–1, top edge as a fraction of the reference photo's height
  size: number; // 0–1, applied to width AND height — see the note above
}

export async function nativeDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return dims;
}

/** The largest true square this rect yields, in source pixels. */
export function cropSquarePixels(width: number, height: number, rect: CropRect): number {
  return Math.floor(Math.min(rect.size * width, rect.size * height));
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

/** Where the centred square sits inside the rect, in source pixels. */
function squareSource(rect: CropRect, width: number, height: number) {
  const side = Math.min(rect.size * width, rect.size * height);
  // centre it in whichever axis the rect is longer on, then keep it inside
  // the image — a rect dragged past the edge must not read out of bounds
  const sx = Math.min(Math.max(rect.x * width + (rect.size * width - side) / 2, 0), Math.max(width - side, 0));
  const sy = Math.min(Math.max(rect.y * height + (rect.size * height - side) / 2, 0), Math.max(height - side, 0));
  return { sx, sy, side };
}

/**
 * Crops `file` to the largest square inside `rect` and resizes to exactly
 * target×target. Pass the target from cropOutputSize() so this never
 * upscales.
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
