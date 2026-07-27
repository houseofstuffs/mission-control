import { NextResponse } from "next/server";
import { createRecord } from "@/server/notion/store";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/** Capture is one action — everything but a name is optional (spec §4.3). */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const values: Record<string, SimpleValue> = {
      Name: String(body.name),
      Status: "Inbox",
      "Capture Type": body.captureType ?? "Copy",
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

    const record = await createRecord("ideas", values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
