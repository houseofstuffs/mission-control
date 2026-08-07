import { NextResponse } from "next/server";
import { cachedRecord, updateRecord, archiveRecord } from "@/server/notion/store";
import { slotsForListing } from "@/server/imageSlots";
import { generatedFor } from "@/server/mockup/plan";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";

/**
 * Slot edits. Choosing a mockup template auto-fills Shot Type from the
 * template (a shot type set before the template was the PLAN; the explicit
 * shotType field in the same request wins as the override).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const slot = cachedRecord(id);
    if (!slot || slot.dbKey !== "image_slots") {
      return NextResponse.json({ error: "Slot not found in cache — refresh first" }, { status: 404 });
    }

    const values: Record<string, SimpleValue> = {};
    if (body.label != null) values["Name"] = String(body.label);
    if (body.bucket != null) values["Bucket"] = String(body.bucket);
    // which Product graphic this slot carries — settable in-app so a
    // hand-added or hand-filled slot can satisfy the graphic-card gate
    // (the gate reads role-carrying slots, and only those)
    if (body.productLinkRole !== undefined) {
      const role = String(body.productLinkRole ?? "").trim();
      const valid = ["", "Highlights & Sizing", "Care & Policies", "Colorways"];
      if (!valid.includes(role)) {
        return NextResponse.json({ error: "Unknown graphic-card role." }, { status: 400 });
      }
      values["Product Link Role"] = role || null;
    }
    if (body.shotType !== undefined) values["Shot Type"] = body.shotType ? String(body.shotType) : null;
    if (body.status != null) values["Status"] = String(body.status);
    if (body.assetRef !== undefined) values["Asset Ref"] = body.assetRef ? String(body.assetRef) : null;
    if (body.notes != null) values["Notes"] = String(body.notes);

    if (body.mockupTemplateId !== undefined) {
      // COLOUR GUARD — server-side, so no path around the UI can cross a
      // coloured slot: "colorway — espresso" refuses a Black variant no
      // matter who asks. Colour-neutral variants pass (they render every
      // colour). Send has the same rule; this closes the manual door.
      if (body.mockupTemplateId) {
        const tplRec = cachedRecord(String(body.mockupTemplateId));
        const slotColour = String(slot.props["Colour"] ?? "").trim().toLowerCase();
        const tplColour = String(tplRec?.props["Garment Color"] ?? "").trim().toLowerCase();
        if (slotColour && tplColour && slotColour !== tplColour) {
          return NextResponse.json(
            {
              error: `This slot is ${String(slot.props["Colour"])} — that variant is ${String(
                tplRec?.props["Garment Color"]
              )}. Pick the ${String(slot.props["Colour"])} variant of the same shot instead.`,
            },
            { status: 400 }
          );
        }
      }

      // CARD SLOTS ARE EXEMPT from the one-fact rule below. A colour
      // grid / print close-up / artwork detail is a VARIANT-LESS
      // composite: there is no render behind the template relation to
      // keep in sync with, so "re-point the asset" could only replace
      // finished work with a plain render. On these slots the template
      // is a label — changing it changes the relation, never the asset.
      // Swapping the image itself stays behind "replace…".
      const assetRefStr = String(slot.props["Asset Ref"] ?? "");
      const assetGenId = /^\/api\/generated-mockups\/([^/?]+)\/file/.exec(assetRefStr)?.[1];
      const assetGen = assetGenId ? cachedRecord(assetGenId) : null;
      const isCardAsset = Boolean(
        assetGen &&
          assetGen.dbKey === "generated_mockups" &&
          (((assetGen.props["Variant"] as string[] | null) ?? []).length === 0)
      );
      if (isCardAsset) {
        values["Mockup Template"] = body.mockupTemplateId ? [String(body.mockupTemplateId)] : [];
        // no shot-type auto-fill either — it would overwrite the slot's
        // own type (Grid Composite etc.), which the card senders key on
      } else {

      // ONE action, ONE fact: the variant relation and the placed asset
      // are two halves of "what image is this slot showing", and letting
      // them move independently is what minted crossed pairs. Picking a
      // variant RE-POINTS THE ASSET to that variant's render in the same
      // write — and if no render exists yet, nothing is written at all.
      const listingId = ((slot.props["Listing"] as string[] | null) ?? [])[0] ?? "";
      const assetIsOurs = String(slot.props["Asset Ref"] ?? "").startsWith("/api/generated-mockups/");
      if (body.mockupTemplateId) {
        const variantId = String(body.mockupTemplateId);
        const render = generatedFor(listingId, variantId);
        if (!render) {
          const tpl = cachedRecord(variantId);
          return NextResponse.json(
            {
              error: `No render for "${tpl?.title ?? "that variant"}" yet — generate it at L4 first. Nothing was changed.`,
            },
            { status: 409 }
          );
        }
        values["Asset Ref"] = `/api/generated-mockups/${render.id}/file`;
        // a slot that now HAS an image can't honestly stay "Planned";
        // every other status (Designing, Placed…) is the operator's
        if (String(slot.props["Status"] ?? "") === "Planned") values["Status"] = "Made";
      } else if (assetIsOurs) {
        // clearing the variant clears OUR render with it — the halves
        // stay in lockstep in both directions. Hand-pasted external
        // links are the operator's and stay put.
        values["Asset Ref"] = null;
      }

      values["Mockup Template"] = body.mockupTemplateId ? [String(body.mockupTemplateId)] : [];
      // auto-fill shot type from the template unless the caller overrode it
      if (body.mockupTemplateId && body.shotType === undefined) {
        const tpl = cachedRecord(String(body.mockupTemplateId));
        const tplShot = tpl?.props["Shot Type"];
        if (typeof tplShot === "string" && tplShot) values["Shot Type"] = tplShot;
      }
      }
    }

    // reorder: swap positions with the neighbor in that direction
    if (body.move === "up" || body.move === "down") {
      const listingId = ((slot.props["Listing"] as string[] | null) ?? [])[0];
      const siblings = listingId ? slotsForListing(listingId) : [];
      const idx = siblings.findIndex((s) => s.id === slot.id);
      const other = body.move === "up" ? siblings[idx - 1] : siblings[idx + 1];
      if (other) {
        const myPos = Number(slot.props["Position"]) || 0;
        const otherPos = Number(other.props["Position"]) || 0;
        await updateRecord("image_slots", other.id, { Position: myPos });
        values["Position"] = otherPos;
      }
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("image_slots", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const slot = cachedRecord(id);
    if (!slot || slot.dbKey !== "image_slots") {
      return NextResponse.json({ error: "Slot not found in cache — refresh first" }, { status: 404 });
    }
    await archiveRecord("image_slots", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
