import fs from "node:fs";
import { chromium } from "playwright";
function browserPath(): string | undefined {
  const c = [process.env.CHROMIUM_PATH, ...(fs.existsSync("/opt/pw-browsers") ? fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-")).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`) : [])].filter(Boolean) as string[];
  return c.find((p) => fs.existsSync(p));
}
(async () => {
  const browser = await chromium.launch({ executablePath: browserPath() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  let reorderBody: string | null = null;
  await page.route("**/slots-reorder", async (route) => {
    reorderBody = route.request().postData();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, writes: 2 }) });
  });
  await page.goto("http://127.0.0.1:3131/listings/listing-1?step=L5", { waitUntil: "networkidle" });
  const tab = page.getByRole("tab").filter({ hasText: /image plan|image slots/i }).first();
  if (await tab.count()) await tab.click();
  await page.waitForTimeout(400);

  const grips = page.locator(".l5-grip");
  console.log("grips:", await grips.count());
  const src = grips.nth(0);
  const dst = grips.nth(3);
  const a = await src.boundingBox();
  const b = await dst.boundingBox();
  if (!a || !b) { console.log("no boxes"); process.exit(1); }
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + a.width / 2, a.y + (b.y + b.height / 2 - a.y) * (i / 8));
    await page.waitForTimeout(30);
  }
  // check lift + indicator mid-drag
  const midState = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".l5-slot")] as HTMLElement[];
    return {
      lifted: rows.some((r) => r.style.opacity === "0.45"),
      indicator: rows.some((r) => r.style.boxShadow.includes("0px -3px") || r.style.boxShadow.includes("-3px")),
    };
  });
  console.log("mid-drag:", JSON.stringify(midState));
  await page.mouse.up();
  await page.waitForTimeout(500);
  console.log("reorder POST:", reorderBody ? reorderBody.slice(0, 200) : "NONE");
  await browser.close();
})();
