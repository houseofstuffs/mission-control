# STUFFS Mission Control — Build Spec
**Direction: 2a "Full Butter"** — white canvas, Shortbread sidebar, Blueberry ink, chunky pills and offset shadows, flat status icons (stroke only on the selected step).

Reference render: `Direction Explorations.dc.html` → section `#2a`. Where this spec and the render disagree, the spec wins.

---

## 1. Colour tokens

### Surfaces & chrome
| Token | Hex | Use |
|---|---|---|
| `surface.canvas` | `#ffffff` | Main content background |
| `surface.sidebar` | `#fff3c5` | Sidebar (Shortbread) |
| `surface.well` | `#f6f5f0` | Recessed wells inside cards (NEEDS/PRODUCES rows) |
| `surface.panel-accent` | `#c5ede0` | Accent panels: gate check, empty-state hero (Ocean Breeze) |
| `surface.attention-yellow` | `#fffbe8` | Pale field for stale chips + callouts |
| `surface.attention-red` | `#fdeeee` | Pale field for blocked chips + callouts |
| `border.ink` | `#1f4897` | Primary component ink: card borders, selected strokes (Blueberry) |
| `border.sidebar` | `#eedfa0` | Sidebar right edge (2px) |
| `border.soft` | `#d9c37a` | Tertiary button outline |
| `border.faint` | `#e6dfc6` | Pending/idle rings |
| `border.hairline` | `#f0ead3` | Step connectors, subtle dividers |
| `shadow.offset-mint` | `#c5ede0` | Offset shadow under bordered cards / active nav |
| `shadow.offset-ink` | `#1f4897` | Offset shadow under primary buttons / selected step |

### Text
| Token | Hex | Use |
|---|---|---|
| `text.primary` | `#2f2817` | Headings, body emphasis |
| `text.secondary` | `#57534a` | Body |
| `text.tertiary` | `#6b675c` | Supporting copy |
| `text.muted` | `#a89c72` | Timestamps, hints, idle steps |
| `text.label` | `#8a7a45` | Kicker labels (STEP 2 OF 8, NEEDS) |
| `text.on-fill` | `#ffffff` | Text on Candy / Blueberry / Sea Foam fills |
| `text.on-mint` | `#134a3a` titles, `#2e5a4c` body | On Ocean Breeze panels |
| `text.on-yellow` | `#8a6d00` | On pale-yellow attention fields |
| `text.on-red-pale` | `#b81d22` | On pale-red attention fields |

### Status — workflow steps (done / stale / blocked)
| State | Fill | Glyph | Shape |
|---|---|---|---|
| `status.done` | `#68c2a9` | white ✓ | circle 28px |
| `status.stale` | `#ffd00d` | `#5c4a00` refresh icon | circle 28px |
| `status.blocked` | `#d7242a` | white ✕ | **octagon 30px** (clip-path `polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)`) |
| `status.pending` | `#ffffff` | none | circle 28px, 2px solid `#e6dfc6` |

### Status — niche gate (greenlit / parked / killed)
| State | Treatment |
|---|---|
| `gate.greenlit` | Sea Foam `#68c2a9` fill, white ✓, circle |
| `gate.parked` | Tuscan Sun outline on pale field: `#fffbe8` bg, 1px `#ffd00d`, text `#8a6d00`, ⏸-style double-bar glyph |
| `gate.killed` | Neutral, dead: `#f6f5f0` bg, 1px `#ddd6c2`, text `#a89c72`, ✕ glyph + strikethrough on the record title |

### THE RULE (state in code comments)
**Filled Candy = action. Outlined Candy = attention.** `#d7242a` as a solid fill appears ONLY on primary buttons (and the blocked octagon, which is additionally shape-coded). Every state must be distinguishable without colour: done=circle+✓, stale=circle+refresh, blocked=bigger octagon+✕, selected=stroke+offset shadow, killed=strikethrough.

---

## 2. Type scale

Families:
- **Display/headers/nav/buttons:** Quicksand (Google Fonts), weights 600/700
- **Body:** Nunito Sans (Google Fonts), weights 400/600/700
- GT Walsheim Pro + Avenir Next Pro are reserved for **exported listing graphics only** (desktop licence), never loaded in the interface.

| Token | Family / weight | Size / line-height | Case | Use |
|---|---|---|---|---|
| `type.page-title` | Quicksand 700 | 24px / 1.2 | **UPPERCASE**, letter-spacing .03em | Page headers |
| `type.card-title` | Quicksand 700 | 22px / 1.2 | sentence | Card titles (step name) |
| `type.panel-title` | Quicksand 700 | 14px / 1.3 | sentence | Side-panel titles (Gate check) |
| `type.nav` | Quicksand 600 | 14.5px / 1.3 | sentence | Sidebar nav |
| `type.button` | Quicksand 700 | 14.5px / 1 | sentence | All buttons |
| `type.kicker` | Nunito Sans 800 | 11.5px / 1.2, letter-spacing .08em | UPPERCASE, colour `text.label` | STEP 2 OF 8, NEEDS, PRODUCES |
| `type.body` | Nunito Sans 400 | 13.5px / 1.45 | sentence | Card body, callouts |
| `type.body-sm` | Nunito Sans 400 | 12.5px / 1.5 | sentence | Recent moves, hints |
| `type.chip` | Quicksand 700 | 11.5px / 1 | UPPERCASE | Status chips |
| `type.step-label` | Nunito Sans 400/700 | 11px / 1.2 | **lowercase** (text-transform) | Step rail labels |
| `type.empty-title` | Quicksand 700 | 22px / 1.2 | sentence | Empty-state heading |
| `type.empty-body` | Nunito Sans 400 | 14px / 1.5 | sentence | Empty-state copy |

Minimum interface size: 11px, and only for labels/timestamps.

---

## 3. Spacing & radius

Spacing scale (px): **2, 4, 6, 8, 12, 16, 22, 26, 32**. Gaps use flex/grid `gap`, never margins between siblings.

Common applications: card padding 26px; panel padding 18px; well padding 12px 14px; page padding 28px 32px; sidebar padding 22px 14px; gap between cards 22px; gap inside cards 16px.

| Radius token | Value | Use |
|---|---|---|
| `radius.pill` | 999px | Buttons, nav items, chips |
| `radius.hero` | 20px | Empty-state hero card |
| `radius.card` | 16px | Cards, side panels |
| `radius.well` | 12px | Wells inside cards |
| `radius.callout` | 10px | Callout boxes, panel inner cards |

Border weights: **2px** structural ink (cards, active nav, secondary buttons, pending rings); **1px** attention outlines (chips, callouts); **4px** left-bar accent (gate items).

Offset shadows (signature of the direction — solid, no blur):
- Card: `6px 6px 0 #c5ede0`
- Primary button / selected step: `3px 3px 0 #1f4897`
- Active nav / empty-state avatar: `3px 3px 0 #c5ede0`
- Pressed: translate(1px,1px) + shadow shrinks to `2px 2px 0`

---

## 4. Component specs

### Button
| Variant | Spec |
|---|---|
| Primary | Candy `#d7242a` fill, white text, pill, padding 10px 22px, shadow `3px 3px 0 #1f4897`. Hover: translate(1px,1px), shadow `2px 2px 0 #1f4897`. |
| Secondary | Transparent, 2px solid `#1f4897`, text `#1f4897`, pill, padding 8px 18px. Hover bg `#eef3fb`. |
| Tertiary | Transparent, 2px solid `#d9c37a`, text `#4a3f28`, pill, padding 8px 18px. Hover bg `#fdf6dd`. |
| Disabled | bg `#f6f5f0`, text `#a89c72`, no border, no shadow, cursor not-allowed. |

One primary button per view, maximum.

### Card
White bg, 2px solid `#1f4897`, radius 16, padding 26, shadow `6px 6px 0 #c5ede0`, internal `flex column, gap 16`. Kicker → title → content. Supporting cards (Recent moves) may drop to border `#e7d693` and no shadow to de-emphasise.

### Status pill (chip)
Pill, 1px outline on pale field, padding 4px 11px, `type.chip`:
- Stale: bg `#fffbe8`, border `#ffd00d`, text `#8a6d00`
- Blocked: bg `#fdeeee`, border `#d7242a`, text `#b81d22`
- Done/greenlit: bg `#eef8f4`, border `#68c2a9`, text `#134a3a`
- Neutral/killed: bg `#f6f5f0`, border `#ddd6c2`, text `#a89c72`
Counts precede the word: "2 STALE".

### Input
Height 40px, white bg, 2px solid `#e6dfc6`, radius 12, padding 0 12px, `type.body` at 14px, placeholder `#a89c72`. Focus: border `#1f4897` + shadow `3px 3px 0 #c5ede0`. Error: border `#d7242a`, message line 12.5px `#b81d22` below. Labels: `type.kicker` above, 6px gap. Textareas same, padding 10px 12px.

### Step rail (step runner)
Horizontal flex; each step = column (icon over label), width 96px; connectors `flex:1, height 2px, #f0ead3` (done segments `#68c2a9`), aligned to icon centre (margin-top 13px). Icons per §1 status table. **Selected step:** adds 2px solid `#1f4897` + shadow `3px 3px 0 #1f4897` to its icon; label goes 700 weight `#1f4897`. Labels lowercase 11px. Blocked octagon is 30px with -1px vertical margins to stay centred on the rail.

### Step card (current step)
Card (above) containing: kicker "STEP n OF m" → step title 22px → optional stale/blocked callout → NEEDS and PRODUCES wells **stacked as rows** (grid, 1 column, gap 12) → button row (gap 12): Primary "Mark step done", Secondary "← Back a step", Tertiary "Still valid". Callout: pale field + 1px outline, radius 10, padding 12px 15px (stale: `#fffbe8`/`#ffd00d`/`#8a6d00`; blocked: `#fdeeee`/`#d7242a`/`#b81d22`). Backward navigation is a normal secondary action, never styled as destructive.

### Gate check panel
Ocean Breeze `#c5ede0` bg, radius 16, padding 18, title 14px `#134a3a`. Each gate item: white card, radius 10, padding 12px 14px, **border-left 4px solid `#d7242a`** (Candy bar = attention, consistent with the rule), body 13px `#2f2817`.

### Table row (Listings)
Height 44px, white bg, bottom border 1px `#f0ead3`. Hover: bg `#fdf6dd`. Selected: bg `#eef3fb` + 2px left inset bar `#1f4897` + checkbox filled. Checkbox: 18px, radius 6, 2px `#e6dfc6`; checked: fill `#1f4897`, white ✓. Inline-editable cells show a dotted underline `#d9c37a` on hover; editing swaps to Input (compact 32px). Batch action bar: appears fixed at bottom of table on ≥1 selection — white, 2px solid `#1f4897`, radius 16, shadow `6px 6px 0 #c5ede0`, padding 12px 16px, count 700 + buttons per Button spec.

### Kanban card (Designs)
Width = column, white, 2px solid `#e6dfc6`, radius 16, padding 0. Artwork-forward: image area 4:3 top (radius 14 top corners, bg `#f6f5f0` placeholder), body padding 12px 14px: title Quicksand 700 14.5px `#2f2817`, meta 12px `#a89c72`, chip row (gap 6). "In n listings" count is a chip: bg `#eef3fb`, text `#1f4897`. Hover: border `#1f4897`. Dragging: border `#1f4897` + shadow `6px 6px 0 #c5ede0` + 2° tilt. Column headers: `type.kicker` + count; column bg transparent, no boxes.

### Empty state
Centred in content area. Ocean Breeze card, radius 20, padding 40px 56px, max-width 520px, `overflow:hidden`; pattern `assets/pattern-5-clean.svg` absolutely filling at **opacity .14** with a radial mask clearing a 100px-radius hole behind the figure (`mask: radial-gradient(circle at 50% 110px, transparent 100px, black 101px)`); `figure-mark.svg` at height 140px; title 22px `#134a3a`; body 14px `#2e5a4c`; one primary button. Optional hint line 12px `#a89c72` below. Copy tone: warm, brief, active ("Nothing to triage", "Go make something weird —"). Never use the word "empty"; never grey the screen out.

---

## 5. Layout shell

- App frame: full viewport, flex row. **Sidebar 190px fixed**, Shortbread `#fff3c5`, border-right 2px `#eedfa0`, padding 22px 14px.
- Sidebar contents: brand lockup (heart-1.svg 20px + "STUFFS" Quicksand 700 15px `#1f4897` over "MISSION CONTROL" 9.5px letter-spacing .14em `#8a7a45`), then nav (flex column, gap 6).
- Nav item: pill, padding 8px 14px, Quicksand 600 14.5px `#4a3f28`. Hover: bg `rgba(255,255,255,.6)`. **Active: white bg, 2px solid `#1f4897`, text `#1f4897`, shadow `3px 3px 0 #c5ede0`.**
- Nav order: Today, Designs, Listings, Inbox, Library, Products.
- Content pane: white, padding 28px 32px, max content width 1200px. Step-runner grid: `1fr 320px`, gap 22. Table pages: full width. Kanban: horizontal columns 280px, gap 16.
- Minimum viewport 1280px; no responsive breakpoints needed (desk tool).
- Links: `#1f4897`, hover `#d7242a`, no underline at rest.

---

## 6. States

| State | Treatment |
|---|---|
| Hover (buttons) | Primary: press-toward-shadow (translate 1px,1px + shadow shrink). Outlined: pale fill (`#eef3fb` blue family, `#fdf6dd` yellow family). |
| Hover (cards/rows) | Rows: bg `#fdf6dd`. Kanban cards: border → `#1f4897`. Never scale/zoom. |
| Selected | Stroke + offset shadow (nav item, step icon, table row inset bar). Selection is always Blueberry, never Candy. |
| Focus (keyboard) | Same as selected stroke: 2px `#1f4897`, offset 2px. |
| Disabled | `#f6f5f0` fill, `#a89c72` text, shadows removed. |
| Empty | Per Empty state component. Sidebar and header always render fully — only the content well is empty. |
| Loading | Skeleton blocks: `#f6f5f0`, radius matching target component, shimmer via opacity pulse (0.6↔1, 1.2s). No spinners for page loads; spinner (2px `#1f4897` arc, 16px) only inside buttons mid-action. |
| Stale | Yellow family everywhere it appears: icon circle `#ffd00d` + refresh glyph, chip + callout on `#fffbe8` with 1px `#ffd00d`. Stale ≠ error: copy explains what changed and offers "Still valid" as a first-class action. |
| Blocked | Candy family, shape-coded (octagon / left-bar). Copy always names the unblocking step and links to it. |

---

## Asset notes
- `assets/pattern-5-clean.svg` = pattern-5 with its baked-in frame stroke removed. Use it, not the original.
- Heart mark minimum size 14px height; clear space = ½ its height on all sides.
- figure-mark.svg reserved for empty states / human moments; stamps-strokes.svg elements may decorate section headers sparingly (≤1 per screen).
- Pencil motif and paper-clip.svg are retired — never use.
