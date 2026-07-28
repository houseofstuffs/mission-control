import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { notionConfigured } from "@/server/notion/client";
import { printifyConfigured } from "@/server/printify/client";
import { getMeta, syncState } from "@/server/cache/db";

export const dynamic = "force-dynamic";

/** Booleans and paths only — never echoes secret values. */
export async function GET() {
  const cacheDbPath = process.env.CACHE_DB_PATH || "./data/cache.db (default — NOT persistent)";
  const resolved = path.resolve(process.env.CACHE_DB_PATH || "./data/cache.db");
  return NextResponse.json({
    notion: notionConfigured(),
    printify: printifyConfigured(),
    etsyPublishMode: process.env.ETSY_PUBLISH_MODE ?? "draft-only",
    cache: {
      configuredPath: cacheDbPath,
      resolvedPath: resolved,
      volumeDirExists: fs.existsSync("/data"),
      dbFileExists: fs.existsSync(resolved),
      onVolume: resolved.startsWith("/data/") && fs.existsSync("/data"),
    },
    schemaProvisionedAt: getMeta("schema_provisioned_at"),
    sync: syncState(),
  });
}
