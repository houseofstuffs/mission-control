/**
 * Screenshots the running app so a UI change can be CHECKED, not assumed.
 *
 * Born from a real miss: a redesign shipped with the wrong drop-zone
 * treatment, detached pill buttons and a cut-off textarea — none visible
 * in source, all obvious in a picture. Source review can't catch
 * render-time bugs; this can.
 *
 * Usage (see `npm run ui:shots`, which wires the env and server for you):
 *   BASE_URL=http://127.0.0.1:3000 npx tsx scripts/ui-shots.ts [name...]
 *
 * Shots land in .ui-shots/ (git-ignored). Read them with the Read tool.
 */
export {};

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const OUT = ".ui-shots";

/**
 * The sandbox ships Chromium at a fixed revision that won't always match
 * what the installed Playwright wants, and downloading browsers is
 * disabled. Point at the binary on disk when it's there; fall back to
 * Playwright's own resolution everywhere else (e.g. a normal laptop).
 */
function browserPath(): string | undefined {
  const candidates = [
    process.env.CHROMIUM_PATH,
    ...(fs.existsSync("/opt/pw-browsers")
      ? fs
          .readdirSync("/opt/pw-browsers")
          .filter((d) => d.startsWith("chromium-"))
          .map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)
      : []),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p));
}

interface Shot {
  name: string;
  path: string;
  /** click these (by visible text) before shooting — opens collapsed UI */
  clicks?: string[];
  full?: boolean;
}

const SHOTS: Shot[] = [
  { name: "today", path: "/", full: true },
  { name: "listing-l2", path: "/listings/listing-1", full: true },
  { name: "listing-l2-boilerplate", path: "/listings/listing-1", clicks: ["Expand"], full: true },
  { name: "listing-l2-siblings", path: "/listings/listing-1", clicks: ["APPROVED ON"], full: true },
  { name: "listing-l1", path: "/listings/listing-1?step=L1", full: true },
  { name: "listing-l3", path: "/listings/listing-1?step=L3", full: true },
  { name: "listing-l3-margin", path: "/listings/listing-1?step=L3", clicks: ["Margin → Price"], full: true },
  { name: "listing-l5", path: "/listings/listing-1?step=L5", full: true },
  { name: "design-c9", path: "/designs/design-1", full: true },
  { name: "products", path: "/products", full: true },
  { name: "listings", path: "/listings" },
  { name: "library", path: "/library", full: true },
  { name: "library-shot-form", path: "/library", clicks: ["＋ New template (colour batch)"], full: true },
];

async function main() {
  const only = process.argv.slice(2);
  const shots = only.length ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS;
  if (shots.length === 0) {
    console.error(`No shot matched. Known: ${SHOTS.map((s) => s.name).join(", ")}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: browserPath() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const problems: string[] = [];
  // surface client-side errors — a screenshot of a broken page should say so
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`);
  });

  for (const shot of shots) {
    problems.length = 0;
    const res = await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle", timeout: 60_000 });
    // L-step panels live behind the step rail: click the step chip when asked
    const step = new URL(`${BASE}${shot.path}`).searchParams.get("step");
    if (step) {
      const tab = page.getByRole("tab").filter({ hasText: new RegExp(stepLabel(step), "i") }).first();
      if (await tab.count()) await tab.click();
    }
    for (const label of shot.clicks ?? []) {
      const btn = page.getByRole("button", { name: label, exact: false }).first();
      if (await btn.count()) await btn.click();
    }
    await page.waitForTimeout(400);
    const file = `${OUT}/${shot.name}.png`;
    await page.screenshot({ path: file, fullPage: shot.full ?? false });
    const status = res?.status() ?? 0;
    console.log(
      `${status === 200 ? "✓" : "✗"} ${shot.name} (${status}) → ${file}` +
        (problems.length ? `\n    ⚠ ${problems.slice(0, 3).join("\n    ⚠ ")}` : "")
    );
  }
  await browser.close();
}

/** step id → the label rendered on its rail chip */
function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    L1: "printify product",
    L2: "write listing",
    L3: "verify pricing",
    L4: "images",
    L5: "image plan",
    L6: "publish gate",
    L7: "push draft",
  };
  return labels[step] ?? step;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
