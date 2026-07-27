/**
 * Pulls every Notion database into the local SQLite cache.
 * Usage: npm run notion:refresh
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
  const { refreshAll } = await import("../src/server/notion/store");
  console.log("Refreshing cache from Notion (system of record)...\n");
  const counts = await refreshAll();
  for (const [key, count] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(20)} ${count} records`);
  }
  console.log("\nCache is current.");
}

main().catch((err) => {
  console.error("\nRefresh failed:", err.message ?? err);
  process.exit(1);
});
