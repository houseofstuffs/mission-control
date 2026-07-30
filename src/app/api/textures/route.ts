import { NextResponse } from "next/server";
import { createRecord } from "@/server/notion/store";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/** Add a texture to the library without leaving the runner. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "A texture name is required." }, { status: 400 });
    }
    const values: Record<string, SimpleValue> = {
      Name: String(body.name).trim(),
      Source: body.source === "Owned file" ? "Owned file" : "Kittl",
    };
    if (body.fileLink) values["File Link"] = String(body.fileLink);
    const record = await createRecord("textures", values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
