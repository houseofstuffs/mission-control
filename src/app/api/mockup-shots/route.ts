import { NextResponse } from "next/server";
import { createRecord } from "@/server/notion/store";

export const dynamic = "force-dynamic";

/** Creates the parent shot record a colourway batch's variants attach to. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name the shot — e.g. \"CC1466 Model 1\"." }, { status: 400 });
    const record = await createRecord("mockup_shots", { Name: name });
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
