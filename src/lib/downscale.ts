/**
 * Shrink an image in the browser before uploading it.
 *
 * Snapshots are thumbnails, but a full-resolution generation is routinely
 * 20-40MB — big enough that the upload gets truncated in transit and the
 * server reports "Failed to parse body as FormData". Sending a few hundred KB
 * instead makes the save fast and the failure impossible.
 *
 * PNG out, so transparency survives for the server's backdrop pass.
 */

const MAX_EDGE = 1600;

export async function downscaleImage(file: File): Promise<File> {
  // Small files are already fine — don't re-encode and lose quality for nothing.
  if (file.size < 1_500_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".png";
    return new File([blob], name, { type: "image/png" });
  } catch {
    // Any failure falls back to the original — a large upload that might work
    // beats no upload at all.
    return file;
  }
}
