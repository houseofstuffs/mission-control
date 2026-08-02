import { NextResponse } from "next/server";
import { disconnect } from "@/server/etsy/connection";

export const dynamic = "force-dynamic";

export async function POST() {
  disconnect();
  return NextResponse.json({ ok: true });
}
