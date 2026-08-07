import { NextResponse } from "next/server";
import sharp from "sharp";
import { archiveRecord, cachedRecord, cachedRecords, createRecord, refreshRecord, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import { buildColourCard, type CardCell } from "@/server/mockup/colourCard";
import { CARD_DEFAULTS, CARD_MAX_CELLS, CARD_ROWS, UPLOAD_BUDGET_BYTES } from "@/config/mockups";
import { createSlotForShotType } from "@/server/imageSlots";
import { MAX_IMAGES } from "@/config/images";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The branded colour card (supersedes the plain grid composite as the
 * thing the operator actually ships). Cells are the picked approved
 * renders IN PICK ORDER; labels come from each render's Colour — never
 * typed by hand. Template is chosen by cell count, overridable.
 *
 * Series-aware: every build creates a NEW staged record (replacing in
 * place would kill the slot reference of an earlier card in a 6+6+3
 * series). Assign fills the first EMPTY Grid Composite slot, falling
 * back to the first one (the single-card overwrite case).
 *
 * Bodies:
 *   { generatedIds: [...], layout?, title?, footer?, email? } — build & stage
 *   { assignRecordId }  — staged card -> a Grid Composite slot
 *   { discardRecordId } — archive a staged card
 */
async function encodeUnderBudget(png: Buffer): Promise<Buffer> {
  for (const quality of [90, 82, 74, 66, 58]) {
    const out = await sharp(png).webp({ quality }).toBuffer();
    if (out.length <= UPLOAD_BUDGET_BYTES) return out;
  }
  throw new Error("The colour card won't compress under Notion's upload cap.");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const listing = cachedRecord(id);
    if (!listing || listing.dbKey !== "etsy_listings") {
      return NextResponse.json({ error: "Listing not found — refresh first." }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));

    const gridSlots = () =>
      cachedRecords("image_slots")
        .filter(
          (s) =>
            ((s.props["Listing"] as string[] | null) ?? []).includes(id) &&
            String(s.props["Shot Type"] ?? "") === "Grid Composite"
        )
        .sort((a, b) => (Number(a.props["Position"]) || 0) - (Number(b.props["Position"]) || 0));

    if (body.assignRecordId) {
      const rec = cachedRecord(String(body.assignRecordId));
      if (!rec || rec.dbKey !== "generated_mockups") {
        return NextResponse.json({ error: "That card is gone — rebuild it." }, { status: 404 });
      }
      let slots = gridSlots();
      if (slots.length === 0 && body.createSlot) {
        await createSlotForShotType(id, "Grid Composite", "color grid", "Sell Design", MAX_IMAGES);
        slots = gridSlots();
      }
      if (slots.length === 0) {
        return NextResponse.json(
          { error: "no Grid Composite slot on this listing", canCreate: true },
          { status: 400 }
        );
      }
      // a series fills empty grid slots first; a lone card overwrites its slot
      const slot = slots.find((s) => !String(s.props["Asset Ref"] ?? "").trim()) ?? slots[0];
      // the builder KNOWS the source template — stamp it, don't make the
      // operator re-pick it at L5. And a card arrives from a
      // preview-then-commit flow with nothing left to judge, so it lands
      // Placed (mockup sends stay Made — those get reviewed in place).
      const srcVariant = cachedRecord(String(body.sourceVariantId ?? ""));
      await updateRecord("image_slots", slot.id, {
        "Asset Ref": `/api/generated-mockups/${rec.id}/file`,
        ...(srcVariant && srcVariant.dbKey === "mockup_templates" ? { "Mockup Template": [srcVariant.id] } : {}),
        Status: "Placed",
      });
      await updateRecord("generated_mockups", rec.id, { "Sent To Slot": [slot.id] });
      return NextResponse.json({
        ok: true,
        slot: { position: Number(slot.props["Position"]) || 0, label: slot.title },
      });
    }

    if (body.discardRecordId) {
      const rec = cachedRecord(String(body.discardRecordId));
      if (rec && rec.dbKey === "generated_mockups") await archiveRecord("generated_mockups", rec.id);
      return NextResponse.json({ ok: true });
    }

    // ---- build & stage ----
    const ids = Array.isArray(body.generatedIds) ? (body.generatedIds as unknown[]).map(String) : [];
    if (ids.length < 2 || ids.length > CARD_MAX_CELLS) {
      return NextResponse.json(
        { error: `Pick 2–${CARD_MAX_CELLS} renders (a series is multiple cards).` },
        { status: 400 }
      );
    }
    const layoutKey = Number(body.layout ?? ids.length);
    const rows = CARD_ROWS[layoutKey];
    if (!rows) {
      return NextResponse.json({ error: `Unknown layout "${body.layout}" — 2 to ${CARD_MAX_CELLS} cells.` }, { status: 400 });
    }
    const need = rows.reduce((a, b) => a + b, 0);
    if (need !== ids.length) {
      return NextResponse.json(
        { error: `The ${rows.join("+")} layout needs ${need} renders — you picked ${ids.length}.` },
        { status: 400 }
      );
    }

    const cells: CardCell[] = [];
    for (const gid of ids) {
      const g = cachedRecord(gid);
      if (!g || g.dbKey !== "generated_mockups" || !((g.props["Listing"] as string[] | null) ?? []).includes(id)) {
        return NextResponse.json({ error: "A picked render is gone — refresh and re-pick." }, { status: 404 });
      }
      const urlOf = (rec: typeof g) => {
        const v = rec.props["Image"];
        return Array.isArray(v) && v.length > 0 ? ((v[0] as { url?: string })?.url ?? "") : "";
      };
      const fetchBytes = async (url: string) => {
        if (!url) throw new Error("no stored image");
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      };
      let bytes: Buffer;
      try {
        bytes = await fetchBytes(urlOf(g));
      } catch {
        const fresh = await refreshRecord("generated_mockups", gid);
        try {
          bytes = await fetchBytes(urlOf(fresh));
        } catch (err) {
          return NextResponse.json(
            { error: `Couldn't fetch the ${String(g.props["Colour"] ?? "") || "?"} render ("${g.title}") — ${(err as Error).message}. Try regenerating it.` },
            { status: 502 }
          );
        }
      }
      cells.push({ image: bytes, label: String(g.props["Colour"] ?? "").trim() || "colour" });
    }
    // cell 1's variant stands for the card's source template on the slot
    const firstGen = cachedRecord(ids[0]);
    const sourceVariantId = ((firstGen?.props["Variant"] as string[] | null) ?? [])[0] ?? null;

    const png = await buildColourCard(cells, rows, {
      title: typeof body.title === "string" ? body.title : undefined,
      footer: typeof body.footer === "string" ? body.footer : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
    });
    const webp = await encodeUnderBudget(png);

    const name = `${(listing.title || "listing").replace(/[\\/:*?"<>|]+/g, "-")} - colour card ${rows.join("+")}`;
    const file = new File([new Uint8Array(webp)], `${name}.webp`, { type: "image/webp" });
    const up = await uploadFileToNotion(file);

    // ALWAYS a fresh record — series cards must not clobber each other
    const record = await createRecord("generated_mockups", {
      Name: name,
      Listing: [id],
      Colour: "Colour card",
      Image: [{ name: file.name, uploadId: up.id }],
      "Generated At": new Date().toISOString().slice(0, 10),
      Verdict: "Approved",
    });

    return NextResponse.json({
      ok: true,
      recordId: record.id,
      url: `/api/generated-mockups/${record.id}/file?v=${encodeURIComponent(record.lastEdited)}`,
      layout: rows.join("+"),
      cells: cells.map((c) => c.label.toLowerCase()),
      sourceVariantId,
      title: typeof body.title === "string" && body.title.trim() ? body.title : CARD_DEFAULTS.title,
      hasSlot: gridSlots().length > 0,
      openSlots: gridSlots().filter((s) => !String(s.props["Asset Ref"] ?? "").trim()).length,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
