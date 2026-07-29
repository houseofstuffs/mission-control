/**
 * Styles — the Design Tool's home (spec §9.2). Capture mode at the top;
 * below it, every captured style as a card. Opening one gives a split view:
 * reference on the left, fields editable with copy icons on the right.
 * Prompts are working material — they appear only inside a style, never
 * at grid level.
 */
import { cachedRecords } from "@/server/notion/store";
import { syncState } from "@/server/cache/db";
import { RefreshButton } from "@/components/RefreshButton";
import { StyleCapture } from "@/components/StyleCapture";
import { StylesBrowser, type StyleCard } from "@/components/StylesBrowser";

export const dynamic = "force-dynamic";

const FIELD_MAP: Record<string, string> = {
  description: "Description",
  composition: "Composition",
  slots: "Slots",
  typography: "Typography",
  keywordBank: "Keyword Bank",
  reusablePrompt: "Reusable Prompt",
  typePrompt: "Type Prompt",
  printsBeautifullyOn: "Prints Beautifully On",
  worksWithTweaksOn: "Works With Tweaks On",
  avoidOn: "Avoid On",
  ruleOfThumb: "Rule of Thumb",
  notes: "Notes",
};

export default function StylesPage() {
  const styles = cachedRecords("styles");
  const designs = cachedRecords("designs");
  const sync = syncState()["styles"];

  const cards: StyleCard[] = styles.map((s) => {
    const img = s.props["Source Image"];
    const first = Array.isArray(img) && img.length > 0 ? (img[0] as { url?: string }) : null;
    const fields: Record<string, string> = {};
    for (const [key, prop] of Object.entries(FIELD_MAP)) fields[key] = String(s.props[prop] ?? "");
    return {
      id: s.id,
      name: s.title,
      category: String(s.props["Category"] ?? ""),
      imageUrl: first?.url || null,
      usedIn: designs.filter((d) => (d.props["Style"] as string[] | null)?.includes(s.id)).length,
      fields,
    };
  });

  return (
    <div className="content-inner">
      <div className="page-head">
        <h1 className="page-title">Styles</h1>
        <RefreshButton lastSyncedAt={sync?.lastSyncedAt ?? null} />
      </div>
      <div className="stack-22">
        <StyleCapture />
        <StylesBrowser styles={cards} />
      </div>
    </div>
  );
}
