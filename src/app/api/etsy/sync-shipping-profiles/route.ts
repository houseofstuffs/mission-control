import { NextResponse } from "next/server";
import { syncShippingProfiles } from "@/server/etsy/shippingProfiles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const result = await syncShippingProfiles();
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
