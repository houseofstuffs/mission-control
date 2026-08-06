import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, updateRecord } from "@/server/notion/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export interface SendResult {
  name: string;
  detail: string;
  ok: boolean;
  /** true = nothing was written (already placed) — quiet line, not a win */
  skipped?: boolean;
  /** offered when nothing matched but a near-neighbour slot is open */
  suggestion?: { slotId: string; position: number; label: string; slotShotType: string };
  generatedId?: string;
}

/**
 * Approved renders → image slots. Send FILLS EMPTY SLOTS ONLY — it never
 * overwrites an asset, never touches a slot's status once set, and skips
 * renders that are already placed (reported quietly, not re-processed).
 * L5 is the operator's; Send is a courier, not an editor.
 *
 * Matching, in priority order per render:
 *   1. an EMPTY slot whose Mockup Template relation names this variant
 *   2. an EMPTY same-shot-type slot whose Colour equals the render's
 *   3. an EMPTY same-shot-type slot with NO colour, lowest position
 * A coloured slot never accepts a mismatched colour. No match = a named
 * mismatch ("slot 3 is Flat Lay, this render is Flat Lay Styled") plus a
 * one-click retarget suggestion when a near-neighbour is open.
 *
 * Body:
 *   { templateId? }                — send only that template's renders
 *   { assign: {generatedId, slotId} } — the retarget: fill ONE named slot
 *                                        (still refuses an occupied one)
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found — refresh first." }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));

    const slots = cachedRecords("image_slots")
      .filter((s) => ((s.props["Listing"] as string[] | null) ?? []).includes(id))
      .sort((a, b) => (Number(a.props["Position"]) || 0) - (Number(b.props["Position"]) || 0));

    const fileRoute = (gid: string) => `/api/generated-mockups/${gid}/file`;
    const slotPos = (s: (typeof slots)[number]) => Number(s.props["Position"]) || 0;

    // ---- targeted assign — the "place it there anyway" button ----
    if (body.assign?.generatedId && body.assign?.slotId) {
      const g = cachedRecord(String(body.assign.generatedId));
      const slot = cachedRecord(String(body.assign.slotId));
      if (!g || g.dbKey !== "generated_mockups" || !slot || slot.dbKey !== "image_slots") {
        return NextResponse.json({ error: "Render or slot not found — refresh first." }, { status: 404 });
      }
      if (String(slot.props["Asset Ref"] ?? "").trim()) {
        return NextResponse.json(
          { error: `Slot ${Number(slot.props["Position"]) || "?"} already holds an asset — Send never overwrites.` },
          { status: 409 }
        );
      }
      const variantId = ((g.props["Variant"] as string[] | null) ?? [])[0] ?? "";
      await updateRecord("image_slots", slot.id, {
        "Asset Ref": fileRoute(g.id),
        "Mockup Template": variantId ? [variantId] : [],
        Status: "Made",
      });
      await updateRecord("generated_mockups", g.id, { "Sent To Slot": [slot.id] });
      const results: SendResult[] = [
        { name: g.title || "render", detail: `→ slot ${Number(slot.props["Position"]) || "?"} (${slot.title})`, ok: true },
      ];
      return NextResponse.json({ results, sent: 1 });
    }

    const templateFilter = body.templateId ? String(body.templateId) : null;
    const approved = cachedRecords("generated_mockups").filter((g) => {
      if (!((g.props["Listing"] as string[] | null) ?? []).includes(id)) return false;
      // a Variant-less record is a built composite (the grid), placed via
      // its own confirm — not a tile awaiting a home
      const variantId = ((g.props["Variant"] as string[] | null) ?? [])[0];
      if (!variantId) return false;
      if (String(g.props["Verdict"] ?? "") !== "Approved") return false;
      if (!Array.isArray(g.props["Image"]) || (g.props["Image"] as unknown[]).length === 0) return false;
      if (templateFilter) {
        const variant = cachedRecord(variantId);
        const shotId = ((variant?.props["Shot"] as string[] | null) ?? [])[0] ?? variantId;
        if (shotId !== templateFilter) return false;
      }
      return true;
    });
    if (approved.length === 0) {
      return NextResponse.json({ error: "Nothing approved to send (check the template filter)." }, { status: 400 });
    }
    if (slots.length === 0) {
      return NextResponse.json({ error: "No slot plan yet — seed it at L5 first." }, { status: 400 });
    }

    const taken = new Set<string>();
    const norm = (c: string) => c.trim().toLowerCase();
    const results: SendResult[] = [];
    for (const g of approved) {
      const variantId = ((g.props["Variant"] as string[] | null) ?? [])[0] ?? "";
      const variant = variantId ? cachedRecord(variantId) : null;
      const shotType = String(variant?.props["Shot Type"] ?? "");
      const colour = norm(String(g.props["Colour"] ?? ""));
      const name = g.title || "render";

      // already placed → skip quietly; re-sending must not re-process
      const placedIn = slots.find((s) => String(s.props["Asset Ref"] ?? "").startsWith(fileRoute(g.id)));
      if (placedIn) {
        results.push({
          name,
          detail: `already assigned to slot ${slotPos(placedIn)} (${placedIn.title})`,
          ok: true,
          skipped: true,
        });
        continue;
      }

      // only EMPTY, role-less, unclaimed slots are candidates for ANY
      // path — a slot the operator filled or hand-edited is off limits
      const empty = (s: (typeof slots)[number]) =>
        !taken.has(s.id) &&
        !String(s.props["Asset Ref"] ?? "").trim() &&
        !String(s.props["Product Link Role"] ?? "").trim();
      const typed = (s: (typeof slots)[number]) =>
        empty(s) && shotType !== "" && String(s.props["Shot Type"] ?? "") === shotType;

      const byRelation = slots.find(
        (s) => empty(s) && ((s.props["Mockup Template"] as string[] | null) ?? []).includes(variantId)
      );
      // colour-carrying slots first, and ONLY for their own colour — a
      // "colorway — espresso" slot must never swallow the Black render
      const byColour = colour
        ? slots.find((s) => typed(s) && norm(String(s.props["Colour"] ?? "")) === colour)
        : undefined;
      const byShotType = slots.find((s) => typed(s) && !String(s.props["Colour"] ?? "").trim());
      const slot = byRelation ?? byColour ?? byShotType;

      if (!slot) {
        if (!shotType) {
          results.push({
            name,
            detail: "the variant has no shot type — set it on the template (Library), Re-sync, and send again",
            ok: false,
          });
          continue;
        }
        // name the mismatch: what's actually open, and how close it is.
        // Rank open slots by shared leading words with the render's type
        // ("Flat Lay" vs "Flat Lay Styled" beats "On Model"), colour
        // agreement as tiebreak.
        const words = shotType.toLowerCase().split(/\s+/);
        const overlap = (t: string) => {
          const w = t.toLowerCase().split(/\s+/);
          let n = 0;
          while (n < words.length && n < w.length && words[n] === w[n]) n++;
          return n;
        };
        const openSlots = slots
          .filter((s) => empty(s))
          .filter((s) => {
            const sc = norm(String(s.props["Colour"] ?? ""));
            return !sc || sc === colour;
          })
          .sort((a, b) => {
            const d = overlap(String(b.props["Shot Type"] ?? "")) - overlap(String(a.props["Shot Type"] ?? ""));
            return d !== 0 ? d : slotPos(a) - slotPos(b);
          });
        const nearest = openSlots[0];
        results.push({
          name,
          detail: nearest
            ? `no open ${shotType} slot${colour ? ` for ${colour}` : ""} — nearest: slot ${slotPos(nearest)} "${nearest.title}" is ${String(nearest.props["Shot Type"] ?? "untyped")}`
            : `no open ${shotType} slot${colour ? ` for ${colour}` : ""} — every candidate slot is filled`,
          ok: false,
          ...(nearest
            ? {
                suggestion: {
                  slotId: nearest.id,
                  position: slotPos(nearest),
                  label: nearest.title || "slot",
                  slotShotType: String(nearest.props["Shot Type"] ?? ""),
                },
                generatedId: g.id,
              }
            : {}),
        });
        continue;
      }
      taken.add(slot.id);
      await updateRecord("image_slots", slot.id, {
        "Asset Ref": fileRoute(g.id),
        "Mockup Template": variantId ? [variantId] : [],
        Status: "Made",
      });
      await updateRecord("generated_mockups", g.id, { "Sent To Slot": [slot.id] });
      results.push({ name, detail: `→ slot ${slotPos(slot)} (${slot.title})`, ok: true });
    }
    return NextResponse.json({ results, sent: results.filter((r) => r.ok && !r.skipped).length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
