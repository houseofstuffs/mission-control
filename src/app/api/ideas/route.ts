import { NextResponse } from "next/server";
import { createRecord, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { screenCopy } from "@/server/anthropic/screen";
import { anthropicConfigured } from "@/server/anthropic/client";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // image upload + page create, both throttled

/**
 * Capture is one action — everything but a name is optional (spec §4.3),
 * and if an image is attached even the name can be derived from it.
 * Accepts JSON, or multipart/form-data when an image rides along.
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

    const name = body.name?.trim() || (image ? image.name.replace(/\.[^.]+$/, "") : "");
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const values: Record<string, SimpleValue> = {
      Name: name,
      Status: "Inbox",
      "Capture Type": body.captureType || (image ? "Photo" : "Copy"),
      Note: body.note ?? "",
    };
    if (body.sourceUrl) values["Source URL"] = String(body.sourceUrl);
    if (body.occasion) values["Occasion"] = String(body.occasion);
    if (body.occasionDate) values["Occasion Date"] = String(body.occasionDate);
    if (body.leadTimeDays != null && body.leadTimeDays !== "") {
      values["Lead Time Days"] = Number(body.leadTimeDays);
    }
    // Seasonal lead-time math: enter creative by = occasion date − lead time.
    if (body.occasionDate && body.leadTimeDays) {
      const enterBy = new Date(body.occasionDate);
      enterBy.setDate(enterBy.getDate() - Number(body.leadTimeDays));
      values["Enter Creative By"] = enterBy.toISOString().slice(0, 10);
    }

    if (image) {
      const upload = await uploadFileToNotion(image);
      values["Image"] = [{ name: image.name, uploadId: upload.id }];
    }

    const record = await createRecord("ideas", values);

    // Copy ideas get a capture-time trademark pre-screen — fire-and-forget,
    // the chip appears on the card once the result lands on the record.
    const isCopy = String(values["Capture Type"]) === "Copy" || (!image && (name || body.note));
    if (isCopy && anthropicConfigured()) {
      const text = [name, body.note ?? ""].filter(Boolean).join(" — ");
      void screenCopy(text)
        .then((r) =>
          updateRecord("ideas", record.id, { "Trademark Risk": r.risk, "Risk Reason": r.reason })
        )
        .catch(() => {
          /* advisory only — a failed screen never blocks capture */
        });
    }
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
