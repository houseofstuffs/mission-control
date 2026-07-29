import { NextResponse } from "next/server";
import sharp from "sharp";
import { captureStyle } from "@/server/anthropic/capture";
import { anthropicConfigured } from "@/server/anthropic/client";
import {
  createCaptureJob,
  getCaptureJob,
  completeCaptureJob,
  failCaptureJob,
} from "@/server/cache/captureJobs";

export const dynamic = "force-dynamic";
export const maxDuration = 180; // vision + structured output on a large model

const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type Allowed = (typeof ALLOWED)[number];

/**
 * Capture mode, job-based: POST hands the image to the server and returns a
 * job id immediately — the model call runs here, so navigating away doesn't
 * kill it. GET polls the job; the draft waits until it's collected. Nothing
 * is written to Notion until the operator reviews and saves.
 */
export async function POST(req: Request) {
  try {
    if (!anthropicConfigured()) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not set. Add it in your host's environment variables." },
        { status: 400 }
      );
    }
    const form = await req.formData();
    const file = form.get("image");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "A reference image is required." }, { status: 400 });
    }
    if (!ALLOWED.includes(file.type as Allowed)) {
      return NextResponse.json(
        { error: `Unsupported image type "${file.type}". Use JPEG, PNG, GIF or WebP.` },
        { status: 400 }
      );
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Reference images should be under 5MB — a screenshot is plenty." },
        { status: 400 }
      );
    }

    const raw = Buffer.from(await file.arrayBuffer());
    const hint = String(form.get("hint") ?? "");
    // Original goes to the job (Notion gets full quality on save); the model
    // gets a downscaled copy — its hard cap is 8000px a side, and reading a
    // style needs nowhere near that.
    const forModel = await sharp(raw)
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const jobId = createCaptureJob(raw.toString("base64"), file.type, file.name, hint);

    // Fire and return — the job finishes server-side whether or not the
    // page that started it is still open.
    void captureStyle(forModel.toString("base64"), "image/jpeg", hint)
      .then((style) => completeCaptureJob(jobId, JSON.stringify(style)))
      .catch((err) => failCaptureJob(jobId, (err as Error).message));

    return NextResponse.json({ jobId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const jobId = new URL(req.url).searchParams.get("job");
    if (!jobId) return NextResponse.json({ error: "job parameter required" }, { status: 400 });
    const job = getCaptureJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found — it may have expired." }, { status: 404 });
    return NextResponse.json({
      status: job.status,
      style: job.resultJson ? JSON.parse(job.resultJson) : null,
      error: job.error,
      fileName: job.fileName,
      imageDataUrl: `data:${job.mediaType};base64,${job.imageB64}`,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
