/**
 * Prepare a print file for inspection without changing what it measures.
 *
 * The pre-flight check counts exact pixel values — how much of the artwork is
 * solidly opaque, how much is exactly #000000. A normal downscale destroys
 * both: interpolation invents half-transparent edges and turns pure black into
 * near-black. So when a file is too big to upload whole, this reduces it with
 * smoothing OFF, which copies source pixels rather than averaging them. The
 * result is a smaller file made entirely of real pixel values — a sample, not
 * a blur.
 *
 * Files small enough to send are sent untouched.
 */

/** Above this the upload starts getting truncated in transit. */
const MAX_UPLOAD_BYTES = 8_000_000;
const SAMPLE_EDGE = 2400;

export interface PreparedPrintFile {
  file: File;
  /** the real dimensions, read before any reduction */
  width: number | null;
  height: number | null;
  sampled: boolean;
}

export async function preparePrintFile(file: File): Promise<PreparedPrintFile> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // unreadable in the browser — let the server try
    return { file, width: null, height: null, sampled: false };
  }
  const width = bitmap.width;
  const height = bitmap.height;

  if (file.size <= MAX_UPLOAD_BYTES) {
    bitmap.close?.();
    return { file, width, height, sampled: false };
  }

  try {
    const scale = Math.min(1, SAMPLE_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { file, width, height, sampled: false };
    ctx.imageSmoothingEnabled = false; // the whole point — no invented values
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return { file, width, height, sampled: false };
    const name = file.name.replace(/\.[^.]+$/, "") + ".png";
    return { file: new File([blob], name, { type: "image/png" }), width, height, sampled: true };
  } catch {
    return { file, width, height, sampled: false };
  } finally {
    bitmap.close?.();
  }
}
