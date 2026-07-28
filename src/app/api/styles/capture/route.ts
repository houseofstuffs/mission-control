import { NextResponse } from "next/server";
import { captureStyle } from "@/server/anthropic/capture";
import { anthropicConfigured } from "@/server/anthropic/client";

export const dynamic = "force-dynamic";
export const maxDuration = 180; // vision + structured output on a large model

const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type Allowed = (typeof ALLOWED)[number];

/**
 * Capture mode: reference image in, draft Style record out. Analyses only —
 * nothing is written to Notion until the operator reviews and saves.
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

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const style = await captureStyle(base64, file.type as Allowed, String(form.get("hint") ?? ""));
    return NextResponse.json({ style });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
