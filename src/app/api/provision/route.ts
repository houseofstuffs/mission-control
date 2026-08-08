import { NextResponse } from "next/server";
import { provisionSchema, checkSchema } from "@/server/notion/provision";
import { notionConfigured } from "@/server/notion/client";
import { backfillLogStepTitles } from "@/server/steps";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // ~30 throttled Notion calls on first run

/**
 * Read-only: what Notion actually carries versus what this build writes.
 * Answers "did my last Provision run include field X?" — which the run's own
 * success message can't, since it only ever patches the SCHEMA it shipped with.
 */
export async function GET() {
  try {
    if (!notionConfigured()) {
      return NextResponse.json({ error: "Notion is not configured on this host." }, { status: 400 });
    }
    return NextResponse.json(await checkSchema());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

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
    // history hardening rides along: pre-existing workflow_log entries get
    // their step titles stamped, so retired-id reuse can't relabel them
    const backfilled = await backfillLogStepTitles();
    return NextResponse.json({ result, logTitlesBackfilled: backfilled });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
