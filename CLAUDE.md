# Working notes for Claude

## Check UI changes with a screenshot — don't ship on source review alone

Source review cannot catch render-time bugs. Real examples from this
project that source looked fine for: a single-line input scrolling the
start of a long title out of view, a textarea whose newline-derived row
count cut off wrapped paragraphs, a badge with text crowded inside it, a
drop zone that lost its pattern background, and pill buttons that drifted
apart into separate widgets.

After any visual change, look at it:

```bash
npm run ui:seed     # once — seeds a throwaway cache (data/ui-preview.db)
npm run ui:shots    # boots the app on :3111 and writes .ui-shots/*.png
```

Then open the PNGs with the Read tool and compare against the mockup.
`npx tsx scripts/ui-shots.ts listing-l2` re-shoots one page while the
server is already up (faster loop). Add a shot by appending to `SHOTS` in
`scripts/ui-shots.ts`.

How it can run with no Notion credentials: reads come only from the local
SQLite cache (Notion is queried on explicit refresh alone), so a seeded
cache renders the real pages. `scripts/ui-fixtures.ts` writes a listing at
L2 with a full keyword bank, a product with shop voice, a design and a
mockup template — deliberately including the states that hid bugs before
(long title, filled boilerplate, populated attributes). It refuses to run
unless `CACHE_DB_PATH` points somewhere other than the real cache.

The screenshot pass never writes to Notion — writes would fail without
credentials, and nothing in the pass attempts one.

## Standing assumptions that expire

These are true today and will quietly stop being true. Each one names its
trigger and where to change it — check them when the trigger fires, not on
a schedule.

| Assumption | True while | Flip it here |
| --- | --- | --- |
| Offsite Ads default **15%, mandatory** | STUFFS is under **$10,000** trailing-12-month Etsy revenue | `OFFSITE_ADS_TIER` in `src/config/fees.ts` → `"over10k"`. Rate becomes 12% and opt-out becomes possible. The L3 panel prints this assumption next to the advertising input on every visit, so it should get noticed. Nothing in the app can read Etsy revenue — this is a human check. |
| Etsy fee rates (listing $0.20, transaction 6.5%, processing 3% + $0.25) | Etsy doesn't change them | `src/config/fees.ts` — all rates live there, nowhere else |
| Fees computed for a **US seller in USD**, free-shipping-friendly | shop stays US/USD | `src/config/fees.ts` |

## Conventions worth not re-deciding

- **Button colour**: filled candy red is ONLY for generate actions and
  step completion. Every save is `.btn-save` (filled blueberry).
  Secondary/tertiary stay outlined.
- **Save state**: one indicator per section — the `UNSAVED` chip in the
  section header. Its clearing is the save confirmation; no scattered
  inline "unsaved" text.
- **A mockup detail beats a scope fence.** If the written scope says
  "only touch X" but the mockup shows a change in Y, ask — don't silently
  pick one. (This is how the Needs/Produces split-column got missed.)
