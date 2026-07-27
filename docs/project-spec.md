# STUFFS Mission Control — Project Specification

*Planning document for a workflow dashboard managing an Etsy print-on-demand shop. Written to be handed to Claude Code, with a design system section to be appended after a Claude Design pass.*

---

## 1. What this is

A single-operator web dashboard that manages the pipeline from product idea to live Etsy listing. It is **not** a replacement for Etsy, Printify, Notion, eRank, Everbee, or Kittl. It is the connective layer between them — the thing that knows what step you're on, what a step needs, and what the previous step should have produced.

### The problem it solves

Steps get skipped because they were never explicitly defined, and skipped steps cause backtracking and rework. Research produces keyword data that never reaches a listing title. Design work gets multiplied across products before the design is validated. Artwork gets generated at the wrong aspect ratio and has to be redone. The dashboard's job is to make the process explicit, hold the data between steps, and prevent multiplication before validation.

### Design constraints

- **Solo operator today**, possibly one graphic-design VA later
- **~5 designs/week**, with occasional bursts of bundle listings from existing artwork
- **Pre-revenue**: 2 live listings, 9 drafts, 2 inactive
- **Etsy-only** for the foreseeable future

---

## 2. Foundational principles

These are load-bearing. Changing them later is expensive.

### 2.1 Notion is the system of record

The dashboard is a purpose-built front end over data that lives in Notion. It does not maintain its own database.

**Why:** existing trackers keep working, nothing migrates, and if the dashboard breaks you work in Notion that day instead of stopping. The Notion API is free on all plans and unrelated to the Notion AI subscription.

**Constraint:** the Notion API rate-limits at roughly 3 requests/second and isn't fast. Use a local cache with explicit refresh — do not live-query on every render.

### 2.2 The dashboard shows only what's actionable now

Notion remains the browse, archive, and documentation surface. The dashboard surfaces the items sitting at the current step and the fields still needed to advance them.

**Failure mode to watch:** if a screen starts to resemble a Notion table view, delete it. You've built a worse Notion.

### 2.3 Printify creates listings; the dashboard optimizes them

- **Printify owns** product creation, images, variants, pricing, SKUs, and the push to Etsy — set to **draft**, never auto-publish
- **The dashboard owns** title, tags, attributes, and description via the Etsy API, applied to the draft Printify created

This division prevents two systems writing the same listing, and it's the part no existing tool does.

### 2.4 Etsy publishing is draft-only (v1)

The dashboard prepares everything; the final publish happens in Etsy Shop Manager. This is deliberate — working inside Shop Manager while the shop is new teaches how attributes behave and which fields matter.

**Build requirement:** isolate all Etsy writes behind a single module with a publish-mode setting. Draft-only is mode one; preview-and-approve inside the dashboard is mode two, deferred. Scattering Etsy write calls across the codebase turns that upgrade into surgery.

### 2.5 Validate before you multiply

Any step that fans out — retrofitting art across products, generating mockup sets, creating variant listings — happens **after** the primary product is validated, never before.

### 2.6 Capture now, analyze later

Analytics, reporting, and financial dashboards are explicitly out of v1. But the *fields* they will need must exist from day one, because they can't be reconstructed retroactively: greenlight reasoning, origin type, model used, texture used, cost at time of listing.

### 2.7 Build Etsy-native and name it honestly

Do not build a channel abstraction layer. Name the object `EtsyListing`, not `Listing`. Explicit naming is cheaper than false generality and tells future-you exactly which parts are channel-specific if a second channel ever appears.

---

## 3. Data model

### 3.1 Objects

| Object | What it is | Lifecycle |
|---|---|---|
| `Idea` | Inbox item — a photo, screengrab, clipped URL, or scrap of copy | Most die. Lightweight by design. |
| `Niche` | An evaluated micro-niche with evidence and a gate decision | Greenlit / parked / killed |
| `Collection` | A creative grouping — shared style, palette, subject | Internal; spans listings |
| `ShopSection` | Etsy navigation — merchandising only, **capped at 20** | Buyer-facing |
| `Style` | A captured aesthetic — description, keyword bank, reusable prompt, eligible product types | Reused across many designs |
| `Texture` | A texture reference, either in Kittl or an owned file | Reused; usage logged |
| `MockupTemplate` | A purchased or collected PSD mockup template | Reused; usage and license tracked |
| `Product` | A blueprint × print-provider pair with specs, costs, and boilerplate copy | Reference data |
| `Design` | The creative asset — artwork, PSD master, derivatives | Moves through creative workflow |
| `EtsyListing` | A market offering referencing one or more Designs | Moves through listing workflow |
| `Brand` | Shop identity — visual tokens, logo, graphic templates, verbal voice | Single record |
| `Expense` | Subscriptions, asset purchases, sample orders | Manual entry |

**Niche, Collection, and Shop Section are three separate things**, even though they often line up today:

- **Niche** is a market — who buys and why *(research object)*
- **Collection** is a creative grouping — what Apply mode locks variables across *(production object)*
- **Shop Section** is navigation — how buyers browse *(merchandising object)*

Merging them means losing the ability to have one collection selling into three niches, or to reorganize sections without touching how your work is organized.

**Section strategy:** section by buyer browsing behavior (occasion, recipient, product type), not by collection. Collections are how you make things; sections are how people shop. Sectioning by collection hits the cap of 20 fast; sectioning by browsing behavior may never fill it.

Sections split into two types that behave differently:

| Type | Example | Behavior |
|---|---|---|
| Enduring interest | pet stuffs, music stuffs | Year-round, accumulates listing age |
| Seasonal window | halloween stuffs, christmas stuffs | Dead ten months, hot for two |

A design can legitimately belong to both, and Etsy allows only one section per listing. **Reassignment prompts fire at season *end*, while the listing is dormant** — moving a performing listing risks a ranking wobble, moving a dormant one costs nothing.

### 3.2 Key relationships

- **Design ↔ EtsyListing is many-to-many.** One design can appear in many listings; a bundle listing contains several designs. This is the reason Design and Listing are separate objects.
- **Variant-level design mapping** — which design sits behind which dropdown option, not just which designs are in the listing overall. Required for multi-product listings.
- **EtsyListing → EtsyListing** (self-referential) records lineage: which listing a spinoff or bundle came from.
- **Design → Style, Design → Texture, Design → Niche, Design → Collection** record provenance.
- **EtsyListing → Product** supplies boilerplate copy, costs, and shipping terms.
- **EtsyListing → ShopSection** — one only, reassignable seasonally.
- **Idea → Niche** — an idea can be promoted to a new niche or attached to an existing one.

### Bundles vs multi-product listings

These are on different axes and both fit the model above:

- **A bundle is an offer** — one purchase, several files or items, set price. Recorded as `origin_type`, not as a listing type.
- **A multi-product listing is a presentation format** — one listing, a dropdown, several purchasable options. The bundle is one option inside it.

**Verify before building toward this:** Etsy caps digital listings at 5 files, and adding variations may convert a digital listing from instant download to manual delivery. Either constraint could force the bundle into its own listing regardless of how you'd prefer to model it.

### 3.3 Critical schema notes

**Products are keyed on blueprint × print provider, not product type.** The same shirt from two providers can have different print areas and different base costs. Getting this wrong means exporting artwork at the wrong dimensions for part of your catalog.

**Two copy fields per Product, never merged:** `vendor_text_raw` (verbose Printify original) and `shop_voice_text` (your rewrite). Never overwrite the raw — you'll want to re-run the rewrite when your voice changes.

**Copy rewrites are cached at Product level, not per listing.** Bella+Canvas 3001 care instructions get written once and flow into every listing using that product.

**Ideas do not become Designs until greenlit.** Keeping dead ideas out of the pipeline is what keeps the pipeline trustworthy.

**Batch-capable schema from day one; batch UI deferred.** Schema decisions are hard to reverse, screens are easy to add.

### 3.4 Fields to include now, use later

| Field | On | Purpose |
|---|---|---|
| `assignee`, `review_state` | Design | VA workflow, nullable and invisible in v1 |
| `shop`, `channel` | Design, EtsyListing | Second shop or channel becomes additive |
| `external_ids` | Design, EtsyListing | Printify product ID, Etsy listing ID — makes reconciliation possible forever |
| `cost_at_creation` | EtsyListing | Snapshot, not a live lookup — Printify prices change and would silently rewrite your margin history |
| `origin_type` | EtsyListing | new concept / bundle / variant of winner / seasonal reissue |
| `parent_listing` | EtsyListing | Lineage |
| `occasion`, `lead_time` | Idea, Design | Seasonal scheduling math |
| `target_publish_date` | Design | Derived from occasion lead time; actual tracked against it. Listing age is what accumulates ranking — a Halloween listing published in October has no age when it matters. |
| `variant_sold` | Order data | Colorway performance — comes from Etsy transaction data, not the Design record |

### 3.5 Change log

A separate append-only record of listing edits: what changed, when, why. Notion's free plan keeps only 7 days of page history. Without your own log you can't attribute a performance shift to a change — which makes A/B testing anything (title length especially) impossible.

### 3.6 File storage

Artwork, PSDs, and owned texture packs live in **Google Drive or S3**. Notion stores links only — the free plan caps uploads at 5MB and print-ready POD artwork routinely exceeds that.

**The PSD is the master asset. Every PNG is a disposable derivative.** Change the design, change the PSD, regenerate everything downstream. Never edit a PNG directly.

### 3.7 What syncs, what you supply

| Data | Source | You do |
|---|---|---|
| Blueprints, print providers, print areas, base costs | **Printify API** | Nothing — auto-populates |
| Product variants, colors, sizes, SKUs | **Printify API** | Nothing |
| Listing status, IDs, receipts, lifetime views | **Etsy API** | Nothing (after OAuth) |
| Keyword and competitor data | **CSV export** → dashboard drop zone | Export from eRank / Everbee, drop the file |
| Kittl textures, PODSpy templates | **No API** | Browser extension clip, or manual |
| Collections, Sections, Brand, Expenses | **Yours** | Manual entry — these are business decisions, not vendor data |
| Style records, Niche records | **Generated by prompts** | Review and approve |

**Short answer to "what do I need to send":** almost nothing. Products, categories, and variants seed themselves from Printify. What you supply is the layer Printify doesn't know about — your collections, sections, brand, and the research you already export as CSV.

---

## 4. Workflow 1 — Research

**Purpose:** identify a micro-niche with proven demand and beatable execution, and produce a keyword bank that reaches the listing title.

### 4.1 The strategy this encodes

You are not avoiding saturation. You are hunting for a specific pattern: **high traffic, low conversion, with a diagnosable design cause.**

- **Sales volume** tells you demand exists
- **Conversion rate** tells you how well the incumbent is capturing it
- High traffic + low conversion = demand arriving that someone is failing to convert

The trap is high demand with *strong* incumbent designs — crowded and well executed. Low demand is a different trap: it looks open because nobody's there, and nobody's there because nobody's searching.

### 4.2 Steps

**R1 — Capture inputs**
Etsy bestseller screengrabs, Everbee CSV export, eRank CSV export.
- Dashboard provides a **CSV drop zone** that parses and normalizes both exports into Notion. Neither vendor has a public API; the export *is* the integration.
- Screengrabs attach to the Niche record, not a folder.

**R2 — Shortlist pass**
Niche Scout proposes ~8 micro-niches in one or two lines each. You mark the ones you're drawn to.
*Interest is your cheapest filter — apply it before any expensive analysis.*

**R3 — Deep analysis**
Full analysis on survivors only: buyer, purchase motivation, saturation read, conversion signals, community fit, seed keywords, niche→product-line fit, screenable text phrases.

**R4 — Conversion diagnostic** *(5 minutes per candidate)*
Low conversion is a symptom with several causes. Only one is yours to fix.

| Cause | Fixable by better design? |
|---|---|
| Weak listing images / dated design | **Yes** — this is the opening |
| Search intent mismatch | No — traffic was never going to buy |
| No reviews | No — you'd inherit this worse |
| Price positioning | Sometimes |
| Product or fulfillment complaints | No — same provider, same problem |

Check: open the listing, judge the images honestly, read reviews, compare price to top converters, then search the keyword and see whether the results page is coherent. An incoherent SERP means intent mismatch — walk away.

**R5 — Trademark screening**
The prompt emits **the exact phrases requiring screening** — every literal string that would appear on a product. Screening happens against a real trademark database, not a model's memory. Check whether Everbee's trademark tooling covers this before building anything.

**R6 — Product line decision**
Select the product line. **The profit calculator fires here**, because this is where cost is set. Also compute the master canvas spec (see 5.1).

Two additions from review:

- **Competitor price comparison** — pull bestseller and reference-listing prices from the Everbee export (already imported at R1) so pricing is set against the market rather than in isolation. No extra integration needed.
- **Printify Premium changes your cost basis.** Not subscribed yet; planned once order volume justifies it. When it happens, `cost_at_creation` snapshots will predate the change — historical margins need recalculating or clear labelling, not silent rewriting.

**Starting from an existing niche.** Niche Scout assumes discovery, but once the shop has shape you'll more often start from a niche you already run. In that mode it skips the shortlist pass and either goes straight to deep analysis or proposes adjacent sub-niches within it.

**R7 — Gate**
Record: **greenlit / parked / killed**, plus a one-line reason.

Kill criteria, in order of cost to apply:
1. Not interested in the micro-niche *(free)*
2. No community connection or path to one
3. Won't look good visually
4. High demand **and** strong incumbent designs

**Parked matters** — that's where seasonal ideas wait until they're timely.

**Log the "I can beat this" thesis.** When you greenlight on the basis of weak incumbent design, write the one-line reason. When sales data arrives, check whether the ones you called beatable actually beat anything. You're pre-revenue, so you don't yet know whether your design judgment is sharp. This is how you find out from six listings instead of sixty.

### 4.3 Ideas inbox

Ideas arrive from everywhere and die in the camera roll because capture costs too much.

**Separate capture from triage.** Capture must be one action; organizing happens later at a desk.

- **Phone album sync** — a dedicated album pulled into the Ideas inbox. Take the photo, done.
- **Browser extension** — one button clips URL, screenshot, and title from Kittl, PODSpy, Etsy, or any shop. Kittl and PODSpy have no public API, so their collections can't be synced; this is the workable substitute.
- **Weekly triage** in the dashboard, where typing is easy.

**Seasonal lead-time math.** Tag ideas with an occasion, set lead time, and the dashboard works backward: *these five Halloween ideas need to enter creative this week or they miss.* Your gut still picks which; the system makes sure you're picking at the right time.

### 4.4 Data caveats

Everbee and eRank don't see other shops' real analytics — conversion is modeled from public signals, a ratio of two estimates. Treat it as **directional**: good for building a review queue, not for precise thresholds.

---

## 5. Workflow 2 — Creative

**Purpose:** take a greenlit concept to an approved, print-validated design.

### 5.1 Before step one — canvas spec

Two separate things that must not be conflated:

- **Primary product** — a commercial choice. What you list first and validate the print on.
- **Master canvas** — a technical constraint. Set by the most demanding print area in the line, whichever product that is. A t-shirt can be primary while a blanket dictates canvas.

"Largest" means physical dimensions × print DPI, not physical size. Large-format products often print at lower DPI. Compute this from the Printify catalog rather than eyeballing it.

**Aspect ratio is the generation constraint. Pixel dimensions are the export constraint.** AI tools can't generate at final print resolution anyway — that's what uprez is for. But nothing fixes a wrong ratio except cropping or recomposing, which is the rework. Get the ratio right at generation, the pixels right at export.

The dashboard computes and displays: max pixel dimensions across the line, every target aspect ratio, and a **flag for any product whose ratio differs enough to need recomposition rather than scaling** (a mug wrap is not a scaled shirt).

Set the canvas for the largest *plausible future* product, not just the current line. At generation time it costs nothing.

### 5.2 Steps

**C1 — Input branch** *(three starting points, converging at C2)*

| Starting point | Given | Generated |
|---|---|---|
| Artwork reference | Visual direction | Copy that fits it |
| Copy first | The words | Visual treatment serving them |
| Kittl/PODSpy template | Layout and composition | Both, filled with your concept |

Design tool drafts image prompts and text prompts separately, with recommended pairings.

**C2 — Image generation** (Kittl, image-generate not agentic) — 2 options across 4 models, 8 max. Artboard at master canvas ratio.

**C3 — Text generation** (Kittl) — 2 options across 4 models, 8 max. Adjust coloring.
*Default: text added as a Kittl layer, not generated in-image, wherever spelling matters.*

**C4 — Combine** selected image + text.

**C5 — Texture** — selection is a judgment call, not a recipe. Support it with better inputs rather than trying to systematize the decision:
- Texture shortlist chosen at the **concept stage**, not mid-creative — avoids a context switch into hunting mode while you're in flow
- Semantic matching matters (claw scratches on a monster graphic, not generic grunge)
- **Render intensity variants in one pass** rather than apply → evaluate → adjust → re-render
- Texture reads differently across garment colorways — knocked-out areas vanish on white. Intensity may need to be a variant-level decision.

**Dashboard texture preview.** Shortlisted textures shown as a grid, with what's possible split by source:

| Source | What the dashboard can show |
|---|---|
| Kittl texture | Thumbnail only — no API, so you eyeball it beside the design |
| Owned file | **Real composite** — texture applied to artwork, rendered onto available product colorways |

The colorway preview is the same PSD-rendering pipeline as L4, run earlier. That also settles the colorway-intensity question above by making it visible at decision time rather than after printing — and it's a further argument for building the owned-texture library sooner rather than later.

**C6 — Route by texture source** — creative steps 5–7 are two paths, not one:

| Texture source | Path |
|---|---|
| Kittl texture | Stay in Kittl through C5, export, Photoshop for retouching |
| Owned file | Kittl's job ends at generation; texturing + refinement in one Photoshop session |

**C7 — Uprez + remove background** (separate operations, not "enhance").
*Correction from review: uprez happens in Kittl, before moving to Photoshop — so it sits inside the C6 session rather than after it. Worth confirming which order (uprez-then-knockout, or knockout-then-uprez) gives cleaner edges; this was one of the original undefined points in the old steps 5–7.*

**C8 — Photoshop refinement** — cut out or fill AI artifacts, blur spots and edges, additional texture work.

**C9 — Save PSD master** to the auto-generated folder structure.

**C10 — Validation gate**
- Retrofit **the primary product only**
- Create that one Printify product
- Check the printed mock for bleed and margins
- Refine until correct
- **Decide on a physical sample here** — lead time runs 1–3 weeks, so it's a scheduling dependency, not a step

**C11 — Fan out** — retrofit remaining products only after C10 passes.
- **Pure scaling should be scripted** from the master using Printify print-area specs
- **Recomposition needs a human** — flagged already at 5.1

### 5.3 Tool division

| Tool | Role |
|---|---|
| Kittl | Generation, layout, its own texture library |
| Photoshop | Recomposition, retouching, owned textures |
| Script | Size derivation from master |

### 5.4 Logging

Per design, record: **which model** produced the winning generation, **which texture** was used, **which style** it was built on. After twenty designs this becomes your own index — and favorites derive from usage rather than a hand-maintained list.

**Winning-combination dimensions**, and where each comes from:

| Dimension | Source | Note |
|---|---|---|
| Model, texture, style | Design record | Already captured |
| Niche | Design → Niche relation | Already captured — correlation is free |
| Product | Design → Product relation | Already captured |
| Colorway | **Etsy transaction data** | Different source — variant-level detail off receipts |
| Buyer age bracket | **Not observable** | Etsy gives no demographics. This is your *assumed* target from the Niche record — a hypothesis you're testing, not data. |

### 5.5 Re-screening

If the text changed during design, it is no longer what was screened at R5. Re-check before listing.

### 5.6 Digital branch

**Creative branches by product category.** The Listing Optimizer already branches physical vs digital; creative does not, and that's a gap. Digital diverges early — no blueprint, no print provider, no variants, no Printify at all. Which means the Product record, the master canvas math (5.1), the print validation gate (C10), and the fan-out (C11) either don't apply or mean something different.

The digital path is **shorter but not simpler**:

- **Canvas question changes** from "what does the largest product need" to "what print sizes am I promising the buyer" — its own set of ratio decisions
- **C10 has no digital equivalent** — no printed mock to check. Something should still gate it, but it isn't that. Likely a file-integrity and print-size-claim check.

**Digital delivery production step.** Files are usually too large for direct download, so delivery is a PDF template containing a link to the file on Drive, plus any listing-specific announcements. This is the digital equivalent of L4's branded info graphics — a templated document assembled from records, not a design task.

Automatable end to end:

- **Drive API** handles upload, permission-setting, and link retrieval
- **The PDF is a headless render** from a template with variable fields — same build as the branded info cards

**Delivery risk worth designing against:** the buyer's file depends on that link staying live and the permission staying correct. A moved, renamed, or permission-reset file silently breaks every past buyer's download, and you won't hear about it until someone complains. Requires a stable folder convention and periodic link validation.

---

## 6. Workflow 3 — Listing

**Purpose:** turn an approved design into a complete, optimized Etsy listing.

> **The gap this fixes:** the original workflow had no step where the listing was written. Title, tags, description, and attributes never appeared, which meant the entire research workflow dead-ended. That is the single most important addition here.

### 6.1 Steps

**L1 — Create Printify product** — primary product first (already done at C10), then variations.

**L2 — Write the listing** *(Listing Optimizer)*
Inputs: design, product type, **curated keyword bank from the Niche record**, Product boilerplate, shop voice definition.
Outputs: title, 13 tags, attributes, description hook, design-specific body copy, screenable phrases.

**L3 — Verify pricing and shipping profile** — pricing was set at R6; this is verification, not decision.

**L4 — Generate images**
- Product mockups via **external PSD-rendering API** (evaluate Dynamic Mockups vs SudoMock — both render from Photoshop smart-object templates)
- Branded info graphics (sizing, care, announcements) via **HTML/CSS template → headless render**, variables pulled from the Product and Listing records

*Note: AI image generation is the wrong tool category for product mockups. It approximates, and a product photo must show the exact artwork. Mockups are a compositing problem, not a generation problem.*

**L5 — Assemble image slots** — per-product-type template with defined order. Slot one is the search thumbnail and does most of the click-through work; choose it deliberately.

**Confirmed limit: 20 images.** Design the slot template for 20, not 10 — that's room for lifestyle mockups, colorway coverage, and branded info graphics without them crowding out product shots.

**L6 — Publish gates** — all must pass:
- [ ] Title, tags, attributes, description present
- [ ] Required image slots filled in defined order
- [ ] **If the description cites the size chart, the size chart image is present** (the no-returns-for-wrong-size policy depends on this)
- [ ] Trademark screening confirmed complete
- [ ] Cost snapshot recorded

**L7 — Push to Etsy once, as a complete draft.** Finish and publish in Shop Manager.

> **The premature-activation problem.** Printify's "hide listing from Etsy" checkbox gets missed, the listing goes live before it's ready, and there's no way to convert back to draft — it sits inactive until you're ready. That costs the $0.20 listing fee, burns listing age while the listing isn't sellable, and can't be undone.
>
> **The fix isn't a reminder** — you'll be in Printify's UI when it matters, not the dashboard's. Two mechanisms instead:
>
> 1. **Sequence the push last.** If the Printify push happens only after L6 gates pass, the checkbox stops being load-bearing — the listing is ready anyway.
> 2. **Detect and flag.** Poll Etsy listing state; flag anything that went active before its gates passed. Doesn't prevent, but catches it in minutes rather than whenever you next look.

**L8 — Bundle listings** — new listings assembled from already-published designs. Separate path; this is where batch UI eventually matters.

### 6.2 Description assembly

The description is **assembled from four parts**, only two of which are generated:

1. **Hook** — generated, first 160 characters, serves as the search meta description
2. **Design-specific body** — generated
3. **Product boilerplate** — pulled from the Product record (materials, sizing, care, production and shipping windows, made-to-order note)
4. **Disclosure block** — pulled, matched to physical/digital

This is faster, cheaper, and consistent across every listing sharing a product.

---

## 7. Workflow 4 — Post-live

Minimal by design — 2 live listings means anything more would be premature.

**Listing term is four months**, then expiry. Manual renewal (rather than auto) turns each expiry into a **scheduled review**: *these six expire in two weeks, here's their performance, renew or let go.* One of the few genuinely useful automated prompts in the system.

**Record why each listing was created** — `origin_type` and `parent_listing`. This lets you eventually answer whether doubling down on winners actually works in your shop: do spinoffs of proven sellers outperform fresh concepts? No existing tool answers that.

**On A/B testing — two different mechanisms, only one of which works:**

| Approach | Verdict |
|---|---|
| **Sequential** — change one thing, log it, watch | **Works.** Already covered by the change log (3.5). The honest option on Etsy. |
| **Parallel** — duplicate listings with variations | **Contaminated by design.** Etsy doesn't split traffic; two near-identical listings compete with each other in the same search results. |

`parent_listing` supports the second mechanically, but the results wouldn't mean anything. Sequential testing with a good change log is the real capability.

**Any edit triggers re-evaluation.** Etsy tends to re-rank a listing after changes, with a temporary wobble while it settles. This is the reason behind "don't fiddle with performing listings" — it applies to any edit, including section reassignment. Make changes while listings are dormant.

**Data availability is split:**

| Data | Source |
|---|---|
| Receipts, transactions, order financials | Etsy API (OAuth) |
| Lifetime views per listing | Etsy API |
| Daily views, visits, order counts | **Not available via API** — manual export from Shop Manager, or eRank |
| Printify costs | Printify API |
| Subscriptions, texture packs, sample orders | **Manual — no API has these** |

**Start expense capture now.** Subscription and purchase records can't be recovered later.

**Do not build accounting into this tool.** Own cost and margin per design and per listing — the thing no accounting package knows — and export to bookkeeping software. Worth a conversation with an accountant once you're revenue-generating and considering registration.

**Calendars are a view, not a system.** Get dates on records (occasion, lead time, expiry, sample ETA) and any calendar rendering is trivial. Notion calendar views work today at zero build cost.

### Design creation records

A formal signed creation record **per listing is not worth the effort.** Short slogans generally aren't copyrightable, and purely AI-generated portions aren't registrable — so for a typical STUFFS design the attestation documents authorship of things that largely can't be enforced.

**The dashboard already produces a stronger record as a byproduct:** creation date, source niche, style and texture used, generating model, greenlight reasoning, PSD save dates, and the linked chat where copy was developed. Contemporaneous and detailed beats a reconstructed PDF.

**Reserve the formal signed version for:** genuinely original illustration you'd consider registering, designs that start selling well enough to attract copying, and active disputes.

**Realistic expectations on enforcement.** Etsy takedowns require asserting rights you actually hold. Against a shop that copied your artwork file, you have a case. Against one that made their own spooky-bakery cat shirt with a similar pun, you mostly don't — that's the genre. The defenses that work are speed, volume, and shop identity, not paperwork.

**Also:** archive the copy-development chat alongside design files as timeline corroboration.

*Not legal advice. Worth an IP attorney's read if a specific design becomes valuable enough to matter.*

---

## 8. Profit calculator

### 8.1 Fee inputs (US, verify current rates in Shop Manager)

- Listing fee: $0.20 per listing, four-month term
- Transaction fee: 6.5% of order total **including shipping**
- Payment processing: 3% + $0.25 (US; varies by country)
- Offsite Ads: 15% under $10k trailing-12-month sales, 12% above — **mandatory above $10k**, capped at $100 per attributed order

### 8.2 Required behavior

**Forward mode** — given a price, show margin across full price and 10/15/20% promos, each with and without offsite ads. Fees recalculate on the discounted price; Printify cost does not move, so a discount comes almost entirely out of margin. Flag the worst case.

*Illustration: a $30 item at $12 cost yields roughly $14.70 profit at full price and roughly $9.27 at 20% off — a 37% profit cut from a 20% discount. Add offsite ads to that discounted sale and it drops to around $5.67.*

**Reverse mode** *(the more useful one)* — given a target margin and your deepest planned promo, return the minimum base price that survives it. Price this way and promos are safe by construction.

**Competitor price context** — show bestseller and reference-listing prices from the Everbee import alongside your margin figures, so pricing is set against the market rather than in a vacuum.

**Printify Premium** — not subscribed; planned once order volume justifies it. When it happens, base costs drop and every prior `cost_at_creation` snapshot becomes historical. Label them, don't retroactively rewrite them.

**Fires at the product-line decision (R6)**, not during listing. That's where cost is set.

---

## 9. Claude prompts

Three prompts, all emitting **structured JSON matching the Notion schema**, with readable summaries generated from the same data. Prose-only output means re-keying by hand, which is the friction that kills record-keeping.

### 9.1 Niche Scout

**Two passes:**

**Pass A — Shortlist.** Given a topic or direction, propose ~8 narrow micro-niches, one or two lines each. Narrow means a specific person with a specific identity ("pickleball for nurses," not "sports"). Reject anything describable in one generic word. No deep analysis.

**Pass B — Deep analysis** on selected niches only. For each:
- Who exactly buys, and why (gift / identity / in-joke)
- Honest saturation read — be blunt; a trap should be called a trap
- 8–10 seed keywords in buyer language
- **Community fit**: is this a community I'm in, could join, or would be an obvious tourist in?
- **Niche → product-line fit** — a gifting niche wants a mug, an identity niche wants a shirt
- **Screenable phrases** — every literal string that would appear on a product, output as a list for external trademark screening. This is *not* clearance and must say so.

**Inputs:** normalized eRank/Everbee data, list of already-evaluated niches with outcomes (for exclusion), current shop style records.

**Changes from the existing prompt:**
- Split into two passes
- Consumes your paid research data rather than web-searching for what's selling on Etsy
- Excludes previously-evaluated niches
- Returns 3 recommendations, not 1
- Trademark step emits phrases rather than verdicts
- **Reconsider "first sale within weeks"** — it biases toward niches with no competition, and the most common reason for no competition is no demand. Suggested replacement: *demonstrable demand, beatable competition.*

### 9.2 Design Tool — three modes

Replaces both the Design Prompt Generator and Design Inspiration Prompts projects. Nothing from either is discarded.

**Mode: Explore** *(was Design Prompt Generator)*
No style fixed. Deliberate range across humor, minimalist, retro, illustrative, moody. Runs at concept stage, before commitment.
*Variety belongs here and only here.*

**Mode: Capture** *(was Inspiration Step 1)*
Reference image in, **Style record** out:
- Style description: vibe, illustration treatment, palette, typography, layout, mood
- Keyword bank
- Reusable prompt with `[SUBJECT]` slot
- **Print-suitability → eligible blueprints.** The prints-beautifully / prints-with-tweaks / avoid buckets become a *constraint on which Printify products this style can use*, feeding the product-line decision at R6. A gradient-heavy fine-detail style should never reach a screen-print or embroidery product.

**Mode: Apply** *(was Inspiration Step 2)*
Style record + subject + product → prompt pair.
- Loads the Style record rather than requiring paste-back of a prior conversation
- Palette and type locked **within a series only** — not across the shop
- Font recommendations **constrained to Kittl's available, merch-licensed library**
- Retains the text-in-image vs Kittl-layer rule
- Emits exact text phrases for screening
- Handles all three starting points from C1

**Shop-wide visual identity is deliberately dropped at this stage.** The original prompts asked for genuine variety *and* a coherent shop identity — those pull opposite ways, and at pre-revenue the wide net wins. Explore is the default mode right now.

**But two kinds of consistency are being conflated, and only one is dropped:**

| Kind | Status |
|---|---|
| **Within-series** — palette and type locked across the six designs in one collection | **Kept.** This is what makes a collection read as a collection. |
| **Shop-wide artwork identity** — collections resembling each other | **Dropped.** Revisit once sales data shows what's working. |
| **Brand identity** — banner, logo, info graphics, listing voice | **Kept and enforced.** See below. |

**Shop identity is your packaging; artwork is your product.** The `Brand` record — visual tokens, logo, graphic templates, verbal voice — stays consistent across every listing's branded graphics and copy. The designs themselves stay wide open. Nothing is lost long-term: Style records plus 5.4 logging capture which aesthetics you actually used, so when something sticks you can define an identity from results rather than declaring one now.

### 9.3 Listing Optimizer

Writes Etsy listings. Product-type branching (physical apparel / physical other / digital) stays as written — it's correct.

**Changes:**

- **Takes the curated keyword bank from the Niche record as input.** This is the change that makes the entire research workflow worth doing.
- **Generates only listing-specific copy** — hook and design-specific body. Product boilerplate, disclosure, shipping terms, and care instructions are assembled from records.
- **Title spec is short-form. Confirmed, not a hypothesis.** Etsy is actively flagging long titles on this shop as a search-visibility risk and offering AI rewrites. Target **under 15 words** — 14 is the ceiling, not the goal. Fill slots only when they carry a search term you'd otherwise miss.

**Etsy's own recommendations are the reference implementation.** Match their style rather than the old 130–140 character spec. Default to accepting them; edit only with a specific reason.

Rules learned from the two live listings:

| Rule | Why |
|---|---|
| **Never invent a phrase the design doesn't display** | Etsy dropped "Til Death Do Us Part" from a design with no text on it — correctly. Title carries literal text *only when the design has text.* |
| **Style descriptors are search terms** | "Vintage," "dark romance," "gothic," "dark academia" do real work — not decoration. |
| **Watch for repeated stems** | "Couples" and "couple" are the same term to Etsy's search. A duplicate stem wastes a slot. |
| **Occasion ≠ aesthetic** | "Spooky Season" is the aesthetic; "Halloween" is the occasion. Different volumes, not interchangeable. |
| **Functional terms for digital** | "Printable" or "Digital Download" are filter terms; omitting them hurts more than any style word. |
| **Community fit can outrank volume** | "Witchy" kept over "Bookish" deliberately — being inside a community is how you learn buyer language (§4.2). |
- **Outputs attributes**, not just title/tags/description
- **Trademark step verifies prior screening happened** rather than re-assessing from memory (third redundant check otherwise)
- **Bundle mode** for multi-design listings
- **Shipping terms from the shipping profile record**, not hardcoded US-only
- **Shop voice defined once** as a verbal identity record, alongside the visual Style records

**Retained as-is:** the size-chart citation tied to the returns policy, the disclosure blocks, 13 tags at 20 characters with no keyword repetition, buyer language over seller language, the custom-orders-final-sale line.

---

## 10. Build order

### Phase 1 — Spine
1. Notion schema and connection, with local cache
2. Design Kanban and Listing table
3. Step runner — the screen that walks you through a workflow with state
4. Ideas inbox
5. Product seed from Printify catalog API

#### Step runner: backtracking is a first-class path

This is the screen fixing the actual problem, so backward transitions get designed deliberately rather than treated as an error state. If the runner only goes forward, it gets worked around and the state is lost.

- **Backward transitions are normal**, not exceptions
- **Per-step downstream dependencies.** Returning to C8 and changing artwork makes retrofits, mockups, and listing images stale — but usually *not* title and tags. Dependencies must be per-step, not "everything after this point," or the warnings get ignored.
- **Stale ≠ unchecked.** Affected steps are marked as needing redo, so you always know what you've actually redone. This is precisely the failure mode described at the outset.
- **Log every backtrack** — which step, from where, why. After ten designs that shows where the process leaks, which is what lets you fix the workflow rather than just survive it.

*C10's validation gate solves the same problem from the other end: validating before fan-out means a backtrack invalidates one retrofit instead of six.*

### Phase 2 — The pain
6. Branded info-card generation (HTML template → headless render)
7. Profit calculator, forward and reverse
8. CSV import for Everbee/eRank
9. Listing Optimizer integration

### Phase 3 — Scale
10. Mockup API integration — **hosted PSD rendering (Dynamic Mockups or SudoMock), dashboard owns the UI**
11. Scripted size derivation from master — **Photopea, scripted**
12. Browser extension — serves three collections: Ideas, textures, mockup templates
13. Digital delivery PDF generation + Drive API
14. **Backward-planned production scheduler** — counts back from a seasonal target and real lead-time constraints; surfaces one week's batch at a time, never the full backlog; falling behind recalculates and offers stretch pace / cut goal / move deadline instead of overdue-shaming; goals partially succeed, and unmet seasonal items become parked ideas for next cycle. *Phase 3 by necessity — it needs observed velocity before it can schedule honestly; a planner built on guessed pace just lies politely.*

#### Mockup rendering: hosted API, not self-built

The dashboard UI is yours either way — the only question is what does the compositing underneath. **Use a hosted API.**

The hard part isn't the interface, it's warping artwork onto fabric with correct displacement, shadow, and lighting so it reads as a photograph rather than a sticker. That's the entire product those companies sell. At ~5 designs/week the cost is a few dollars a month; building it yourself means weeks of work for a worse result.

**Photopea's role** is scripted resize and export from the PSD master, plus retouching fallback — not mockups. Its free tier is ad-supported with an API rate limit, and headless/server-side automation may fall under different terms than interactive use. Confirm on their pricing page before building against it.

### Deferred (build nothing now)
Real multi-user auth · batch operations UI · analytics and reporting dashboards · preview-and-approve publishing · multi-channel anything · public API · in-tool accounting

### Non-negotiable from day one
- **Secrets stay server-side.** Printify and Etsy tokens never reach the browser, even when the only browser is yours.
- **Deployable stack.** No localhost assumptions.
- **Etsy writes behind one module** with a publish-mode flag.
- **External IDs stored** on every synced record.

---

## 11. Setup and open items

### Do now
- [ ] **Register Etsy seller app** — Developer Portal → "Create a seller app." Approved in minutes, no review queue. Don't put "Etsy" in the app name. Callback `http://localhost:3000/oauth/redirect` for development. Keystring and shared secret go straight to server-side env vars.
- [ ] **Confirm Printify is set to push drafts, not auto-publish**
- [ ] Start expense capture (subscriptions, purchases, samples)
- [ ] Check Kittl's terms on merchandise resale
- [ ] Set the Drive folder convention before files accumulate

### Accounts and hardware

**Everything business-side lives under the dedicated STUFFS Google account** — Drive artwork, digital delivery folders, shop email, and the Google Cloud project behind Drive API access. One identity you own outright, separate from employer and personal.

**Two employer-owned dependencies carry real risk:**

| Dependency | Risk |
|---|---|
| **Photoshop** (SSO, employer-licensed) | Personal commercial use is usually a policy violation. Access could vanish with a job change or license audit, taking the retouching step with it. **Photopea is the contingency — test it on a real PSD.** |
| **Hardware** (employer-managed) | API keys, shop credentials, and code on a machine that could be wiped, audited, or reclaimed. |

**No Photoshop step is automatable regardless** — it's a desktop app with only local scripting, so C8 and the manual parts of C11 are always hands-on.

**Build sequencing around this:** Phase 1 needs no Etsy access and no personal machine. Notion schema, Kanban, table, step runner, Ideas inbox, and Printify seeding are all available now — and the step runner is the piece that fixes the actual problem. Register the Etsy app today regardless; keys are tied to the account, not the device, and nothing expires.

**Keep the repo and credentials in a personal cloud account from the start.** Migrating a project is easy; untangling one from employer-managed storage is not.

### For the build
- **Etsy publishes an OpenAPI Dev MCP server** — connects Claude Code directly to the live API spec with endpoint details, schemas, and OAuth scopes. No API key required, Claude-compatible. Use it.
- **Notion has an official MCP server** — point Claude Code at your workspace so it reads real database schemas rather than described ones.

### To validate later
- Whether Everbee's trademark tooling covers phrase screening
- Dynamic Mockups vs SudoMock for PSD rendering
- **Etsy digital listing constraints** — 5-file cap, and whether variations break instant download
- Photopea terms for headless/server-side use
- Uprez before or after background knockout — which gives cleaner edges
- Whether a Notion paid plan is worth it (affects the 5MB upload cap, 7-day history limit, and guest permissions — all of which currently have workarounds)

### Resolved during review
- ~~Etsy image limit~~ → **20**
- ~~Title length A/B test~~ → **short-form confirmed**; Etsy is flagging it directly
- ~~Etsy app approval delay~~ → **minutes, not weeks**
- ~~Build mockup renderer in-house~~ → **hosted API**

### Known dead ends
- eRank, Everbee (research data), Kittl, and PODSpy have no usable public APIs. CSV export and browser clipping are the integrations.
- Etsy's API does not expose daily traffic stats.
- Claude Projects have no API — prompts live in the dashboard and call the Anthropic API directly.

---

## 12. Design system

*To be appended after a Claude Design pass. Required as **text**, not images — tokens and component specs Claude Code can implement literally, rather than screenshots it will approximate.*

**Five screen archetypes to design.** Everything else composes from these:
1. Kanban board with cards — Designs in creative
2. Table with multi-select and batch action bar — Listings
3. **Inbox grid for visual triage** — Ideas, textures, **and mockup templates**. One archetype, three collections.
4. Record detail view — a single Design or Listing
5. **Step runner** — executing a workflow one step at a time, **including backward transitions and stale-step marking**

**A shop brand already exists** — banner, logo, graphic templates, colors, type. The design pass should *extend* it rather than invent something, and the same tokens should serve both the interface and the branded listing graphics (L4). The `Brand` record is the single source for both.

**Design deliberately:** empty states (you'll see many of them early) and the step runner (it's the screen fixing the actual problem). Everything else can be plain.

**Required output:**
- Color tokens — hex values with semantic names, including status colors for greenlit / parked / killed
- Type scale — family, sizes, weights, line heights
- Spacing scale and border radius values
- Component specs — card, button, input, status pill, table row, Kanban card
- Layout shell — nav structure, page widths
- States — hover, selected, disabled, empty, loading

---


---

## Open items before build

**User to-do (account-level, do anytime):**
- [ ] Confirm Printify is set to push **drafts, not auto-publish** — the whole "Printify owns creation, dashboard owns optimization" split depends on this one setting.
- [ ] Ensure the dedicated **STUFFS Google account** exists, with Drive API + Cloud project credentials living in *that* account from day one (not migrated from a personal account later).
- [ ] **Migrate master files off the local (employer-managed) laptop into the STUFFS Drive.** Do this *after* the STUFFS account exists — uploading into a personal account first means moving everything twice, and cross-account transfers produce copies rather than clean ownership moves. Migrate: **master PSDs, purchased mockup templates, owned textures, source artwork.** Do *not* migrate exported PNGs — they are disposable derivatives and only add noise.
  - *Risk driving this:* files existing only on employer-managed hardware are exposed to device wipes and offboarding, which don't distinguish personal from work.
  - *Link-integrity rule, permanent:* Drive file IDs survive renames and folder moves, so reorganizing later is safe. **Deleting and re-uploading a file breaks every stored link.** Always edit in place or replace-in-file; never delete-and-reupload a "new version."
- [x] Etsy seller app application — submitted.

**Notion databases — existing, will be rebuilt:** The user has already hand-built Notion databases but is fine overriding them. **Rebuild from the Printify-seed starting point** rather than reconciling the hand-made schema: Printify auto-seeds products, variants, costs, and print areas, so the schema should be shaped to *receive* that data first, with user-owned objects (Collections, Sections, Brand, Expenses) layered on. Do not preserve the current hand-built structure — let the build spec define field names, types, and relations.

---

*End of specification. Sections 1–11 complete; section 12 pending design pass.*
