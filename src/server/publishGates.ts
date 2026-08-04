/**
 * L6 publish gates — computed live from record fields, in one place.
 *
 * Two consumers with different jobs: the gate panel renders these
 * (viewmodels), and the step engine refuses to close L6/L7 while any fail
 * (steps.ts). They MUST agree — a panel showing green while the server
 * blocks, or the reverse, is the exact drift this module exists to prevent.
 *
 * `fixStep` names the listing step that owns the fix, which is what makes a
 * failing gate a button instead of a verdict. Gates fixed outside the
 * listing workflow (the design's print check, the product card) carry no
 * fixStep — their labels say where to go instead.
 */
import { cachedRecord, cachedRecords } from "@/server/notion/store";
import { compatForListing } from "@/server/imageSlots";
import { needsRecompose, derivativeFor } from "@/server/recompose";
import type { SimpleRecord } from "@/server/notion/props";

export interface PublishGate {
  label: string;
  ok: boolean;
  /** listing step that owns the fix — failing gates with one become jump buttons */
  fixStep?: string;
  /** a self-attestation the gate row can take directly — the "fix" is a
   *  claim, not work in another step, so jumping anywhere would be a
   *  dead end. Names the PATCH field the confirm button flips. */
  attest?: "trademarkScreened";
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const rel = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

export function publishGates(rec: SimpleRecord): PublishGate[] {
  const gates: PublishGate[] = [];

  const title = str(rec.props["Title"]);
  const tags = str(rec.props["Tags"]).split(",").map((t) => t.trim()).filter(Boolean);
  const attrs = str(rec.props["Attributes (JSON)"]);
  const hook = str(rec.props["Description Hook"]);
  const body = str(rec.props["Body Copy"]);
  gates.push(
    { label: "Title present (<15 words)", ok: title.length > 0 && title.split(/\s+/).length < 15, fixStep: "L2" },
    { label: `13 tags (${tags.length}/13)`, ok: tags.length === 13, fixStep: "L2" },
    { label: "Attributes recorded", ok: attrs.trim().length > 2, fixStep: "L2" },
    { label: "Description hook + body", ok: hook.length > 0 && body.length > 0, fixStep: "L2" },
    {
      // screening runs outside the app; the gate records the attestation.
      // No fixStep on purpose — jumping to L2 landed on nothing actionable.
      label: rec.props["Trademark Screened"]
        ? `Trademark screening confirmed${
            str(rec.props["Trademark Screened At"]) ? ` · ${str(rec.props["Trademark Screened At"])}` : ""
          }`
        : "Trademark screening not confirmed.",
      ok: Boolean(rec.props["Trademark Screened"]),
      attest: "trademarkScreened",
    },
    { label: "Cost snapshot recorded", ok: num(rec.props["Cost At Creation"]) != null, fixStep: "L3" },
    {
      label:
        num(rec.props["Price"]) != null
          ? `Price set ($${num(rec.props["Price"])!.toFixed(2)})`
          : "No price set.",
      ok: num(rec.props["Price"]) != null,
      fixStep: "L3",
    }
  );
  // L3 promises "shipping profile confirmed" in its PRODUCES; without a
  // gate the promise had nowhere to land.
  gates.push({
    label: rec.props["Shipping Profile Confirmed"]
      ? "Shipping profile confirmed"
      : "Shipping profile not confirmed.",
    ok: Boolean(rec.props["Shipping Profile Confirmed"]),
    fixStep: "L3",
  });
  // Hard block, not advice: this decides which garment colours ship. Set on
  // the design's print check, not a listing step — no jump target.
  const compat = compatForListing(rec);
  gates.push({
    label: compat === "Unset" ? "Garment compatibility not set (design's print check)." : `Garment compatibility: ${compat}`,
    ok: compat !== "Unset",
  });
  // wall_art without its anchor size has no honest cost — hard block.
  // Fixed on the product card, not a listing step.
  const gateProductId = rel(rec.props["Product"])[0];
  const gateProduct = gateProductId ? cachedRecord(gateProductId) : null;
  if (gateProduct && str(gateProduct.props["Category"]) === "wall_art") {
    const hasRep = rel(gateProduct.props["Representative Variant"]).length > 0;
    gates.push({
      label: hasRep ? "Representative size chosen" : "Needs representative size (product card).",
      ok: hasRep,
    });
  }
  // Image-slot hard gates. Belief-bucket coverage stays advisory — only
  // the thumbnail, the graphic card, and the multi-variant pair block.
  const slots = cachedRecords("image_slots")
    .filter((s) => rel(s.props["Listing"]).includes(rec.id))
    .sort((a, b) => (num(a.props["Position"]) ?? 0) - (num(b.props["Position"]) ?? 0));
  if (slots.length > 0) {
    const filled = (s: SimpleRecord) => ["Made", "Placed"].includes(str(s.props["Status"]));
    const thumb = slots.find((s) => num(s.props["Position"]) === 1);
    gates.push({
      label: thumb && filled(thumb) ? "Thumbnail set (slot 1)" : "No thumbnail set.",
      ok: Boolean(thumb && filled(thumb)),
      fixStep: "L5",
    });
    // The graphic card, as one gate with three named parts. The size chart
    // is ALWAYS required — a buyer who can't size a garment returns it —
    // so a listing with no size-chart slot at all still fails. Care and
    // colorways are required wherever their slots exist (colorways slots
    // are seeded only for listings whose compatibility allows them).
    const roleFilled = (role: string) =>
      slots.some((s) => str(s.props["Product Link Role"]) === role && filled(s));
    const roleExists = (role: string) =>
      slots.some((s) => str(s.props["Product Link Role"]) === role);
    const missing: string[] = [];
    if (!roleFilled("Highlights & Sizing")) missing.push("size chart");
    if (roleExists("Care & Policies") && !roleFilled("Care & Policies")) missing.push("care");
    if (roleExists("Colorways") && !roleFilled("Colorways")) missing.push("colorways");
    gates.push({
      label:
        missing.length === 0
          ? "Graphic card: size chart · care · colorways"
          : `Graphic card missing: ${missing.join(" · ")}.`,
      ok: missing.length === 0,
      fixStep: "L5",
    });
    if (rec.props["Is Multi Variant"]) {
      const gridOk = slots.some((s) => str(s.props["Shot Type"]) === "Grid Composite" && filled(s));
      gates.push({
        label: gridOk ? "Range/grid image filled" : "Multi-variant listing has no range/grid image.",
        ok: gridOk,
        fixStep: "L5",
      });
      const persOk = slots.some(
        (s) =>
          str(s.props["Shot Type"]) === "Graphic Card" &&
          filled(s) &&
          /personali[sz]/i.test(`${s.title} ${str(s.props["Notes"])}`)
      );
      gates.push({
        label: persOk ? "Personalisation instructions image filled" : "No personalisation instructions image.",
        ok: persOk,
        fixStep: "L5",
      });
    }
  }

  // Recomposed print file: when this garment's shape deviates from the
  // master, publishing without a Made (non-stale) derivative would ship
  // a stretched or cropped print.
  const gateDesignId = rel(rec.props["Designs"])[0];
  const gateDesign = gateDesignId ? cachedRecord(gateDesignId) : null;
  if (gateProduct && gateDesign && needsRecompose(gateDesign, gateProduct)) {
    const der = derivativeFor(cachedRecords("design_derivatives"), gateDesign.id, gateProduct.id);
    const made = der != null && str(der.props["Status"]) === "Made";
    gates.push({
      label: made
        ? "Recomposed print file saved"
        : der != null
          ? "Recomposed print file is stale — master changed."
          : "Needs a recomposed print file for this garment (L1).",
      ok: made,
      fixStep: "L1",
    });
  }

  // SEO hard gate: no visibility keyword attached = blocked. The bucket
  // mix ratios are advisory; this is the only hard keyword rule.
  const attachedKws = cachedRecords("keywords").filter((k) =>
    rel(k.props["Etsy Listings"]).includes(rec.id)
  );
  const hasVisibility = attachedKws.some((k) => str(k.props["Bucket"]) === "Visibility");
  gates.push({
    label: hasVisibility ? "Visibility keyword attached" : "No visibility keyword attached.",
    ok: hasVisibility,
    fixStep: "L2",
  });

  return gates;
}
