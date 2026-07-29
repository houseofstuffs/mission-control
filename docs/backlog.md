# Backlog

Decisions made during the Phase 1 build that aren't built yet. Kept here so
they survive session boundaries.

## Next up — change-log entry affordance

**Agreed, not yet built.** Lets you record a listing edit from the dashboard:
pick a listing, record which field changed, old value → new value, and why.
Writes to the **Change Log** database (already provisioned, currently unused).

Why it matters: sequential A/B testing is the only kind that works on Etsy
(§7 — parallel duplicates compete with each other in the same search results
and contaminate the result). Sequential testing is only as good as the log
behind it, and Notion's free plan keeps just 7 days of page history, so an
unlogged change is unrecoverable. The Listing Optimizer will write to the
same log in Phase 2, but changes made by hand in Shop Manager will always
need a manual entry.

Sketch: listing picker → field → old/new → why → save. Stamp `Changed At`
automatically.

## Deliberately not building — "already live" listing import

Considered for backfilling the 2 live / 9 draft / 2 inactive listings.
**Skipped on purpose:** Phase 2's Etsy integration will pull all listings from
the API and create records automatically, so hand-entering them now is work
that gets thrown away. The only fields the API can't supply — `origin_type`,
`parent_listing`, `cost_at_creation` — can be filled in afterwards on records
the sync creates.

## Phase 2 — build early in the batch

**Premature-activation detector.** Poll Etsy listing state and flag anything
that went active before its L6 gates passed (§6.1). Has already bitten twice
in real life via Printify's missed "Hide in Store" checkbox. Small piece of
work on top of the Etsy module that already exists.

## Future — workflow variants per product type

**Assessed 2026-07-29: schema has room; nothing to build yet.** The C1–C11
flow is the print workflow; digital downloads need a slightly different
sequence, and custom/personalized artwork a very different one.

The design already accommodates this: `Step State (JSON)` is keyed by step
id (any variant's steps fit), workflows are data in `workflows.ts` (a
variant is one more definition), and `Physical/Digital` exists on Designs
and Listings. When the first variant lands: (1) add a `Workflow Variant`
select on Designs (Print / Digital Download / Custom, default Print),
(2) union the variant's step ids into the `Current Step` select options,
(3) switch `runnerRecord`'s workflow lookup from dbKey to the variant field.
All additive — existing records keep working untouched.

**Custom artwork** additionally splits the data: the design becomes a
template, and personalization input (customer's name etc.) arrives per
ORDER — so it needs a new Orders/Custom Requests database linking
customer input → template → rendered output → delivery. Purely additive.

## Small open offers (say the word)

- Collapse **Triaged** and **Promoted** idea statuses into one — they mean the
  same thing operationally; only the niche's origin differs.
- Railway **healthcheck path** so deploy handovers don't briefly 502. Needs
  the health route exempted from the `APP_PASSWORD` basic-auth middleware.
- Product card headline: currently truncates long blueprint titles with an
  ellipsis to keep the header at exactly two lines. Alternative is wrapping.
