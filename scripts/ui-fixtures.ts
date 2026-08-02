/**
 * Seeds a THROWAWAY cache so the real app can be rendered — and
 * screenshotted — without Notion credentials.
 *
 * Reads in this app come only from the SQLite cache (Notion is queried on
 * explicit refresh alone), so a populated cache is enough to render every
 * page for real. Writes would fail without credentials; the screenshot
 * pass never writes.
 *
 * Always targets CACHE_DB_PATH — never data/cache.db. Usage:
 *   CACHE_DB_PATH=./data/ui-preview.db npx tsx scripts/ui-fixtures.ts
 */
export {};

import { setDbId, setMeta, replaceDbRecords } from "../src/server/cache/db";
import { SCHEMA } from "../src/server/notion/schema";
import type { SimpleRecord, SimpleValue } from "../src/server/notion/props";

const NOW = "2026-08-01T12:00:00.000Z";

function rec(dbKey: string, id: string, title: string, props: Record<string, SimpleValue>): SimpleRecord {
  return { id, dbKey, title, lastEdited: NOW, props };
}

/** a keyword bank with a real spread across buckets, so the shortlist fills */
function keywords(): SimpleRecord[] {
  const mk = (
    n: number,
    name: string,
    searches: number | null,
    competition: number | null,
    bucket: string,
    momentum?: string
  ) =>
    rec("keywords", `kw-${n}`, name, {
      Keyword: name,
      "Avg Searches": searches,
      "Etsy Competition": competition,
      "Tag Eligible": name.length <= 20,
      Bucket: bucket,
      Momentum: momentum ?? "Unknown",
      "Momentum Detail (JSON)": momentum
        ? JSON.stringify({
            recentShare: 0.72,
            monthlySales: 410,
            lifetimeSales: 2300,
            medianAgeMonths: 9,
            listingCount: 24,
            usableListings: 20,
            source: "Everbee",
            computedAt: "2026-07-30",
          })
        : "",
      "Pulled At": "2026-07-28",
      Source: "eRank",
      Designs: ["design-1"],
      "Etsy Listings": [],
    });

  const vis = [
    ["magical practice", 640, 3200],
    ["practice magic", 520, 2900],
    ["practicalmagic", 480, 4100],
    ["practical magic gift", 450, 6800],
    ["magic practical gift", 390, 2400],
    ["practically magic", 360, 5200],
    ["magic practical", 340, 1900],
    ["practical magic-ally", 300, 900],
    ["practicalmagic gifts", 280, 3300],
    ["tequila girl", 260, 7400],
    ["margs", 240, 8800],
    ["midnight margarita", 220, 5100],
  ] as const;
  const reach = [
    ["witchy tee", 2400, 24000],
    ["vintage halloween tee", 1900, 31000],
    ["oversized crewneck", 1700, 46000],
    ["spooky aesthetic", 1500, 28000],
    ["margarita shirt", 1300, 19000],
    ["sweater weather", 1100, 33000],
  ] as const;
  const best = [
    ["halloween witches", 12000, 210000],
    ["spooky gift", 9000, 140000],
    ["gift for wife", 8200, 320000],
    ["retro witch tee", 6100, 88000],
    ["halloween crewneck", 5600, 96000],
    ["practical magic shirt", 5200, 71000],
  ] as const;

  const out: SimpleRecord[] = [];
  let i = 0;
  for (const [name, s, c] of vis) out.push(mk(i++, name, s, c, "Visibility", i % 4 === 0 ? "Selling now" : undefined));
  for (const [name, s, c] of reach) out.push(mk(i++, name, s, c, "Reach", i % 3 === 0 ? "Selling now" : undefined));
  for (const [name, s, c] of best) out.push(mk(i++, name, s, c, "Best Seller"));
  // the dead tail every real bank carries
  for (let d = 0; d < 40; d++) out.push(mk(i++, `dead phrase ${d}`, 20, 400, "Dead"));
  return out;
}

function main() {
  if (!process.env.CACHE_DB_PATH) {
    throw new Error("Refusing to seed: set CACHE_DB_PATH to a throwaway file (never data/cache.db).");
  }
  for (const db of SCHEMA) setDbId(db.key, `fake-db-${db.key}`);
  // Today's Notion gate checks this too — the fixture simulates an
  // already-provisioned app, not first-run setup.
  setMeta("schema_provisioned_at", NOW);

  const product = rec("products", "product-1", "Comfort Colors® Garment-Dyed Sweatshirt — SwiftPOD", {
    Name: "Comfort Colors® Garment-Dyed Sweatshirt — SwiftPOD",
    "Blueprint Title": "Unisex Lightweight Crewneck Sweatshirt",
    "Blueprint Brand": "Comfort Colors®",
    "Blueprint Model": "1466",
    "Print Provider Name": "SwiftPOD",
    "Printify Blueprint ID": 1405,
    "Printify Print Provider ID": 99,
    Category: "apparel",
    "Print Areas (JSON)": JSON.stringify([
      { position: "front", maxWidth: 4200, maxHeight: 4800, ratioLabel: "7:8" },
    ]),
    "Max Print Width px": 4200,
    "Max Print Height px": 4800,
    "Variant Count": 84,
    "Estimated Cost": 29.83,
    "Cost Calc Method": "Core size average",
    "Cost Pulled At": "2026-07-31",
    "Base Cost Min": 28.87,
    "Base Cost Max": 38.62,
    "Estimated Shipping Cost": 5.99,
    "Shipping Cost Source": "Printify catalog",
    "Shipping Pulled At": "2026-07-31",
    // pointed at a real profile so L3's SHIPPING CHARGED pre-fills — the
    // buyer-facing counterpart to the Printify cost above
    "Etsy Shipping Profile": ["ship-2"],
    "Highlights & Sizing Graphic Link": "https://cdn.example.com/graphics/cc1466-sizing.png",
    "Care & Policies Graphic Link": "https://cdn.example.com/graphics/cc1466-care.png",
    // deliberately blank — exercises the "needs Colorways graphic" badge
    "Shop Voice Text":
      "🧵 Fabric: 100% ring-spun cotton, which is the soft kind. It is a lighter sweatshirt at 6.4 oz/yd² (217 g/m²), so it is more \"cool evening on a porch\" than \"blizzard armor.\"\n\n📏 Fit: unisex fit, relaxed, with a rolled forward shoulder so it sits nicely instead of doing that weird bunching thing. Room to slouch, room to breathe, room to eat a whole sandwich. See the size chart photo for exact measurements.\n\n🧼 Care: wash cold, tumble dry low, and do not iron directly over the print.",
    "Voice Generated At": "2026-08-01",
    Status: "Active",
  });

  const design = rec("designs", "design-1", "Midnight Margaritas Retro", {
    Name: "Midnight Margaritas Retro",
    "Current Step": "C9",
    "Step State (JSON)": JSON.stringify({
      steps: {
        C1: { status: "done" }, C2: { status: "done" }, C3: { status: "done" },
        C4: { status: "done" }, C5: { status: "done" }, C6: { status: "done" },
        C7: { status: "done" }, C8: { status: "done" }, C9: { status: "pending" },
      },
      current: "C9",
    }),
    Niche: ["niche-1"],
    "Primary Product": ["product-1"],
    "Master Canvas (JSON)": JSON.stringify([
      { position: "front", maxWidth: 4200, maxHeight: 4800, ratioLabel: "7:8" },
    ]),
    "Master PNG Link": "https://drive.google.com/file/d/master-png/view",
    "PSD Master Link": "https://drive.google.com/file/d/master-psd/view",
    "Master Width": 4200,
    "Master Height": 4800,
    "Garment Compatibility": "Dark only",
    "Text Prompt": "MIDNIGHT MARGARITAS set in a retro condensed serif, arched over the artwork",
    "Print File Checked": true,
  });

  const niche = rec("niches", "niche-1", "Practical Magic fans", {
    Name: "Practical Magic fans",
    Gate: "Greenlit",
    Buyer: "Women 25-45 who rewatch it every October",
    "Purchase Motivation": "Identity",
  });

  const listing = rec("etsy_listings", "listing-1", "Midnight Margaritas Retro — Unisex Lightweight Crewneck Sweatshirt", {
    Name: "Midnight Margaritas Retro — Unisex Lightweight Crewneck Sweatshirt",
    "Current Step": "L2",
    "Step State (JSON)": JSON.stringify({ steps: { L1: { status: "done" } }, current: "L2" }),
    "Etsy State": "Not pushed",
    Designs: ["design-1"],
    Product: ["product-1"],
    "Colorways (JSON)": JSON.stringify(["Black", "Espresso", "Pepper"]),
    // saved copy, so the shots exercise the states that hid bugs before:
    // a long title (start-truncation), a filled boilerplate (cut-off
    // height), and populated attributes (two-column layout)
    Title:
      "Midnight Margarita Sweatshirt, Practical Magic Comfort Colors Crewneck, Vintage Halloween Witch Spooky Gift",
    Tags: "practical magic gift, practical magic-ally, midnight margarita, magical practice, practice magic, practicalmagic, magic practical gift, oversized crewneck, sweater weather, witchy tee, spooky aesthetic, halloween witches, spooky gift",
    "Description Hook":
      "🍹 It is midnight, the blender is running, and somebody is standing on the kitchen table. You know exactly which friend you are in that scene. Salt the rim, put on the sweatshirt.",
    "Body Copy":
      "🧵 Fabric: 100% ring-spun cotton, which is the soft kind. It is a lighter sweatshirt at 6.4 oz/yd² (217 g/m²), so it is more \"cool evening on a porch\" than \"blizzard armor.\"\n\n📏 Fit: unisex fit, relaxed, with a rolled forward shoulder so it sits nicely instead of doing that weird bunching thing. Room to slouch, room to breathe, room to eat a whole sandwich. See the size chart photo for exact measurements.\n\n🧼 Care: wash cold, tumble dry low, and do not iron directly over the print.",
    "Attributes (JSON)": JSON.stringify([
      { name: "Occasion", value: "Halloween" },
      { name: "Holiday", value: "Halloween" },
      { name: "Recipient", value: "Women" },
      { name: "Style", value: "Retro / Goth" },
    ]),
    Price: 48,
    "Cost At Creation": 29.83,
    "Cost Snapshot At": "2026-08-01",
    "Cost Basis": "Printify Standard",
    "Printify Product ID": "pfy-123",
    Shop: "STUFFS",
    Channel: "Etsy",
  });

  // The spinoff case: a second garment off the SAME design, already
  // carrying its own hand-approved tags. Some overlap listing-1's set and
  // some don't — that's what makes the sibling panel worth opening, and
  // it exercises both the tappable and the already-carried pill states.
  const siblingProduct = rec("products", "product-2", "Unisex Heavy Blend Hoodie — Monster Digital", {
    Name: "Unisex Heavy Blend Hoodie — Monster Digital",
    "Blueprint Title": "Unisex Heavy Blend Hooded Sweatshirt",
    "Blueprint Brand": "Gildan",
    "Blueprint Model": "18500",
    "Print Provider Name": "Monster Digital",
    "Printify Blueprint ID": 49,
    "Printify Print Provider ID": 29,
    Category: "apparel",
    "Variant Count": 60,
    Status: "Active",
  });

  const siblingListing = rec(
    "etsy_listings",
    "listing-2",
    "Midnight Margaritas Retro — Unisex Heavy Blend Hoodie",
    {
      Name: "Midnight Margaritas Retro — Unisex Heavy Blend Hoodie",
      "Current Step": "L6",
      "Etsy State": "Not pushed",
      Designs: ["design-1"],
      Product: ["product-2"],
      Tags: "practical magic gift, midnight margarita, witchy tee, spooky gift, cozy hoodie, oversized hoodie, halloween hoodie, witch hoodie, fall layering, gift for her, autumn vibes, cottagecore witch, samhain gift",
      Shop: "STUFFS",
      Channel: "Etsy",
    }
  );

  const variants = ["Black", "Espresso", "Pepper", "Butter"].flatMap((color, ci) =>
    ["S", "M", "L", "XL", "2XL"].map((size, si) =>
      rec("product_variants", `var-${ci}-${si}`, `${color} / ${size}`, {
        Name: `${color} / ${size}`,
        Product: ["product-1"],
        "Printify Variant ID": 1000 + ci * 10 + si,
        Color: color,
        Size: size,
        "Base Cost": 28.87 + si,
        Available: true,
      })
    )
  );

  const slots = Array.from({ length: 8 }, (_, i) =>
    rec("image_slots", `slot-${i}`, i === 0 ? "hero" : `slot ${i + 1}`, {
      Name: i === 0 ? "hero" : `slot ${i + 1}`,
      Listing: ["listing-1"],
      Position: i + 1,
      Bucket: i < 4 ? "Sell Design" : i < 6 ? "Sell Belief" : "Sell Specifics",
      Status: "Planned",
    })
  );
  // Product-linked slots — one synced (asset matches the Product's current
  // link), one gone stale/custom (matches the "hand-replaced" case), one
  // still waiting on a Product graphic that doesn't exist yet.
  slots.push(
    rec("image_slots", "slot-sizing", "size chart", {
      Name: "size chart",
      Listing: ["listing-1"],
      Position: 9,
      Bucket: "Sell Specifics",
      "Shot Type": "Graphic Card",
      Status: "Placed",
      "Asset Ref": "https://cdn.example.com/graphics/cc1466-sizing.png",
      "Product Link Role": "Highlights & Sizing",
    }),
    rec("image_slots", "slot-care", "care info", {
      Name: "care info",
      Listing: ["listing-1"],
      Position: 10,
      Bucket: "Sell Specifics",
      "Shot Type": "Graphic Card",
      Status: "Placed",
      "Asset Ref": "https://cdn.example.com/graphics/cc1466-care-CUSTOM.png",
      "Product Link Role": "Care & Policies",
    }),
    rec("image_slots", "slot-colorways", "colorways", {
      Name: "colorways",
      Listing: ["listing-1"],
      Position: 11,
      Bucket: "Sell Specifics",
      "Shot Type": "Graphic Card",
      Status: "Planned",
      "Product Link Role": "Colorways",
    })
  );

  // two profiles, one deliberately without a US destination row — that's the
  // state that renders the "no US rate" chip and leaves L3's SHIPPING CHARGED
  // un-prefilled, which source review can't tell apart from the happy path
  const shippingProfiles = [
    rec("shipping_profiles", "ship-1", "Free US shipping", {
      Name: "Free US shipping",
      "Etsy Shipping Profile ID": 312091099058,
      "Origin Country": "US",
      "Destinations (JSON)": JSON.stringify([
        {
          destination_country_iso: "US",
          primary_cost: { amount: 0, divisor: 100, currency_code: "USD" },
          min_delivery_days: 3,
          max_delivery_days: 7,
        },
      ]),
      "Synced At": NOW,
    }),
    rec("shipping_profiles", "ship-2", "Standard flat rate", {
      Name: "Standard flat rate",
      "Etsy Shipping Profile ID": 312091099059,
      "Origin Country": "US",
      "Destinations (JSON)": JSON.stringify([
        {
          destination_country_iso: "US",
          primary_cost: { amount: 495, divisor: 100, currency_code: "USD" },
        },
      ]),
      "Synced At": NOW,
    }),
    rec("shipping_profiles", "ship-3", "International only", {
      Name: "International only",
      "Etsy Shipping Profile ID": 312091099060,
      "Origin Country": "US",
      "Destinations (JSON)": JSON.stringify([
        {
          destination_country_iso: "CA",
          primary_cost: { amount: 1200, divisor: 100, currency_code: "USD" },
        },
      ]),
      "Synced At": NOW,
    }),
  ];

  const template = rec("mockup_templates", "tpl-1", "CC1466 Flat Lay Folded", {
    Name: "CC1466 Flat Lay Folded",
    "Pipeline Type": "Simple Placement",
    "Blend Mode": "Normal",
    Fit: "Fill width from top",
    "Garment Color": "Pepper",
    "Print Area Quad (JSON)": JSON.stringify([
      [0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7],
    ]),
  });

  // every database gets an explicit (possibly empty) set, so sync_state
  // exists for all of them and "never synced" banners don't fire
  const byDb: Record<string, SimpleRecord[]> = {
    products: [product, siblingProduct],
    product_variants: variants,
    designs: [design],
    niches: [niche],
    etsy_listings: [listing, siblingListing],
    keywords: keywords(),
    image_slots: slots,
    mockup_templates: [template],
    shipping_profiles: shippingProfiles,
  };
  for (const db of SCHEMA) replaceDbRecords(db.key, byDb[db.key] ?? []);

  const counts = Object.entries(byDb).map(([k, v]) => `${k} ${v.length}`).join(" · ");
  console.log(`Seeded ${process.env.CACHE_DB_PATH}: ${counts}`);
  console.log("Listing page: /listings/listing-1  ·  Design page: /designs/design-1");
}

main();
