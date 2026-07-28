import { NextResponse } from "next/server";
import { createRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Saves a reviewed Style record to Notion, with the reference image attached.
 * Accepts multipart (image rides along) or JSON.
 */
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let body: Record<string, string> = {};
    let image: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") body[key] = value;
      }
      const f = form.get("image");
      if (f && typeof f !== "string" && f.size > 0) image = f;
    } else {
      body = await req.json();
    }

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "A style name is required." }, { status: 400 });
    }

    const values: Record<string, SimpleValue> = {
      Name: body.name.trim(),
      Description: body.description ?? "",
      Typography: body.typography ?? "",
      "Keyword Bank": body.keywordBank ?? "",
      "Reusable Prompt": body.reusablePrompt ?? "",
      "Type Prompt": body.typePrompt ?? "",
      "Prints Beautifully On": body.printsBeautifullyOn ?? "",
      "Works With Tweaks On": body.worksWithTweaksOn ?? "",
      "Avoid On": body.avoidOn ?? "",
      "Rule of Thumb": body.ruleOfThumb ?? "",
    };
    if (body.category) values["Category"] = body.category;

    if (image) {
      const upload = await uploadFileToNotion(image);
      values["Source Image"] = [{ name: image.name, uploadId: upload.id }];
    }

    const record = await createRecord("styles", values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
