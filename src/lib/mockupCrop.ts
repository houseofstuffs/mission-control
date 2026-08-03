/**
 * Client-side mockup crop — runs against the ORIGINAL file, before
 * downscaleImage() ever touches it, so the resolution a 4000×4000 standard
 * output needs is never lost in transit. Square only: the drag UI enforces
 * width === height on every resize, so a rect here is always a true square.
 */

export interface CropRect {
  x: number; // 0–1, left edge as a fraction of the reference photo's width
  y: number; // 0–1, top edge as a fraction of the reference photo's height
  size: number; // 0–1, side length as a fraction of width AND height
}

export async function nativeDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return dims;
}

/** Would this rect, applied to a photo of this size, need to upscale to hit `target`? */
export function cropFeasible(width: number, height: number, rect: CropRect, target: number): boolean {
  return rect.size * width >= target && rect.size * height >= target;
}

/** Crops `file` to `rect` (in its own native pixels) and resizes to exactly target×target. Never upscales — call cropFeasible first. */
export async function cropToStandardSize(file: File, rect: CropRect, target: number): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const sx = rect.x * bitmap.width;
  const sy = rect.y * bitmap.height;
  const sw = rect.size * bitmap.width;
  const sh = rect.size * bitmap.height;
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
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, target, target);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Couldn't encode the cropped image.");
  const name = file.name.replace(/\.[^.]+$/, "") + `-${target}.png`;
  return new File([blob], name, { type: "image/png" });
}
