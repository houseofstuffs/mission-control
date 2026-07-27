/**
 * Creates the full Notion schema under NOTION_PARENT_PAGE_ID.
 * Usage: npm run notion:provision
 * Idempotent — re-run safely after schema changes to patch new properties.
 */
export {};

try {
  process.loadEnvFile(".env.local");
} catch {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* rely on real env vars */
  }
}

async function main() {
  const { provisionSchema } = await import("../src/server/notion/provision");
  console.log("Provisioning Notion schema (throttled to ~3 req/s, this takes a minute)...\n");
  const result = await provisionSchema();
  const pad = Math.max(...result.databases.map((d) => d.title.length)) + 2;
  for (const db of result.databases) {
    console.log(`  ${db.title.padEnd(pad)} ${db.id}  ${db.created ? "(created)" : "(existing, patched)"}`);
  }
  console.log(`\n${result.databases.length} databases ready. IDs are registered in the local cache DB.`);
  console.log("Next: npm run notion:refresh (or the Refresh button in the app).");
}

main().catch((err) => {
  console.error("\nProvisioning failed:", err.message ?? err);
  process.exit(1);
});
