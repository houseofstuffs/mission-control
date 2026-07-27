import { NextResponse } from "next/server";
import { notionConfigured } from "@/server/notion/client";
import { printifyConfigured } from "@/server/printify/client";
import { getMeta, syncState } from "@/server/cache/db";

export const dynamic = "force-dynamic";

/** Booleans only — never echoes secret values. */
export async function GET() {
  return NextResponse.json({
    notion: notionConfigured(),
    printify: printifyConfigured(),
    etsyPublishMode: process.env.ETSY_PUBLISH_MODE ?? "draft-only",
    schemaProvisionedAt: getMeta("schema_provisioned_at"),
    sync: syncState(),
  });
}
