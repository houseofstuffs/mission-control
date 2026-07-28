/**
 * Direct Notion File Upload API calls (the installed SDK predates them).
 * Used for lightweight idea snapshots only — artwork and PSDs stay in
 * Drive/S3 per spec §3.6; Notion holds links for those.
 *
 * Flow: create a file_upload object → send the bytes → attach the upload id
 * to a files property. Single-part uploads cap at 20MB (Notion's free plan
 * enforces its own ~5MB limit and returns a clear error we surface).
 */
import { throttled } from "./client";

const NOTION_VERSION = "2022-06-28";

function authHeaders(): Record<string, string> {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN is not set.");
  return { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION };
}

export async function uploadFileToNotion(file: File): Promise<{ id: string }> {
  // 1) create the upload object
  const createRes = await throttled(() =>
    fetch("https://api.notion.com/v1/file_uploads", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "single_part", filename: file.name }),
    })
  );
  const meta = await createRes.json();
  if (!createRes.ok) {
    throw new Error(`Notion upload init failed: ${meta.message ?? createRes.status}`);
  }

  // 2) send the bytes as multipart form data
  const form = new FormData();
  form.append("file", file, file.name);
  const sendRes = await throttled(() =>
    fetch(`https://api.notion.com/v1/file_uploads/${meta.id}/send`, {
      method: "POST",
      headers: authHeaders(), // content-type set by FormData with boundary
      body: form,
    })
  );
  if (!sendRes.ok) {
    const err = await sendRes.json().catch(() => ({}));
    throw new Error(
      `Notion upload failed: ${err.message ?? sendRes.status}. ` +
        "Free-plan workspaces cap uploads around 5MB — idea snapshots should fit; artwork belongs in Drive."
    );
  }
  return { id: meta.id as string };
}
