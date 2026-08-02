import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { notionConfigured } from "@/server/notion/client";
import { printifyConfigured } from "@/server/printify/client";
import { anthropicConfigured, model } from "@/server/anthropic/client";
import { etsyConfigured } from "@/server/etsy/client";
import { connectionStatus } from "@/server/etsy/connection";
import { getMeta, syncState } from "@/server/cache/db";

export const dynamic = "force-dynamic";

/** When this process booted — tells you whether a deploy picked up a new variable. */
const BOOTED_AT = new Date().toISOString();

/** Booleans and paths only — never echoes secret values. */
export async function GET() {
  const cacheDbPath = process.env.CACHE_DB_PATH || "./data/cache.db (default — NOT persistent)";
  const resolved = path.resolve(process.env.CACHE_DB_PATH || "./data/cache.db");
  return NextResponse.json({
    bootedAt: BOOTED_AT,
    notion: notionConfigured(),
    printify: printifyConfigured(),
    anthropic: anthropicConfigured(),
    anthropicModel: anthropicConfigured() ? model() : null,
    etsyPublishMode: process.env.ETSY_PUBLISH_MODE ?? "draft-only",
    etsy: { configured: etsyConfigured(), ...connectionStatus() },
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
