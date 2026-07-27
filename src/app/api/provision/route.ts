import { NextResponse } from "next/server";
import { provisionSchema } from "@/server/notion/provision";
import { notionConfigured } from "@/server/notion/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // ~30 throttled Notion calls on first run

/**
 * Browser-triggered equivalent of `npm run notion:provision` — makes the
 * app fully operable from a cloud host with no terminal. Idempotent, same
 * as the script: existing databases are patched, never duplicated.
 */
export async function POST() {
  try {
    if (!notionConfigured()) {
      return NextResponse.json(
        { error: "Set NOTION_TOKEN and NOTION_PARENT_PAGE_ID in the host's environment variables first." },
        { status: 400 }
      );
    }
    const result = await provisionSchema();
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
