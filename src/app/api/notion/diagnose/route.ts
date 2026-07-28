import { NextResponse } from "next/server";
import { notion, notionConfigured, parentPageId, throttled } from "@/server/notion/client";

export const dynamic = "force-dynamic";

/**
 * Setup diagnostic: lists everything the integration token can actually see
 * (Notion search returns only content shared with the integration), and
 * whether the configured parent page is among it. Read-only; exists to make
 * "could not find page" self-explanatory during first-run setup.
 */
export async function POST() {
  try {
    if (!notionConfigured()) {
      return NextResponse.json({ error: "Notion env vars not set." }, { status: 400 });
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const res: any = await throttled(() => notion().search({ page_size: 25 }));
    const items = (res.results ?? []).map((r: any) => {
      let title = "";
      if (r.object === "page") {
        const titleProp: any = Object.values(r.properties ?? {}).find(
          (p: any) => p?.type === "title"
        );
        title = (titleProp?.title ?? []).map((t: any) => t.plain_text).join("");
      } else {
        title = (r.title ?? []).map((t: any) => t.plain_text).join("");
      }
      return {
        id: String(r.id).replace(/-/g, ""),
        type: r.object as string,
        title: title || "(untitled)",
      };
    });
    const target = parentPageId();
    return NextResponse.json({
      target,
      targetVisible: items.some((i: { id: string }) => i.id === target),
      visible: items,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
