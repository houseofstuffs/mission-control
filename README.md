# STUFFS Mission Control

A single-operator dashboard managing the pipeline from product idea to live
Etsy listing. It is the connective layer between Notion, Printify, Etsy,
Kittl and the research tools — the thing that knows what step you're on, what
a step needs, and what the previous step should have produced.

Full specs live in [`docs/project-spec.md`](docs/project-spec.md) and
[`docs/build-spec.md`](docs/build-spec.md) (design direction 2a "Full Butter").

## Load-bearing principles

- **Notion is the system of record.** This app is a front end with a local
  SQLite cache and *explicit* refresh — it never live-queries on render and it
  is never a second database. Delete `data/` any time; it rebuilds from Notion.
- **Printify owns listing creation; this app owns listing optimisation.**
  Never both.
- **All Etsy writes go through one module** — `src/server/etsy/publisher.ts` —
  behind `ETSY_PUBLISH_MODE`. v1 is draft-only.
- **Secrets stay server-side.** Tokens live in env vars, are read only inside
  `src/server/`, and never reach the browser.
- **External IDs stored on every synced record** — reconciliation is possible
  forever.

## Phase 1 scope (this build)

1. Notion schema (15 databases) + provisioning script + SQLite cache
2. Designs Kanban and Listings table
3. Step runner with first-class backtracking, per-step stale marking, and an
   append-only workflow log
4. Ideas inbox with seasonal lead-time math
5. Product seed from the Printify catalog (blueprint × provider, variants,
   print areas, master-canvas math)

Phases 2 and 3 (profit calculator, CSV import, Listing Optimizer, mockup API,
clipper, scheduler) are deliberately not here.

## Setup

```bash
npm install
cp .env.example .env.local     # fill in NOTION_TOKEN, NOTION_PARENT_PAGE_ID, PRINTIFY_API_TOKEN
npm run notion:provision       # creates all databases under your parent page
npm run notion:refresh         # pulls everything into the local cache
npm run dev
```

Notion setup: create an internal integration at notion.so/my-integrations,
create (or pick) an empty parent page, share it with the integration, and put
both values in `.env.local`. Provisioning is idempotent — re-run it after
schema changes and it patches new properties without duplicating databases.

## Deploying (works with zero local tooling)

Any Node host with a persistent volume works (Railway, Fly.io, Render):

- Build `npm run build`, start `npm start`
- Point `CACHE_DB_PATH` at the persistent volume (e.g. `/data/cache.db`)
- Set the env vars from `.env.example`; optionally set `APP_PASSWORD` for a
  shared-password gate, or put Cloudflare Access in front
- No localhost assumptions anywhere

First-run setup needs no terminal: once `NOTION_TOKEN` and
`NOTION_PARENT_PAGE_ID` are set in the host's dashboard, the Today page
offers a one-click **Provision Notion schema** button (same idempotent
logic as the script), and every view has its own Refresh button.

## Brand assets

Drop the four real SVGs into `public/assets/` (see the manifest in
`public/assets/README.md`). Placeholders render until then.
