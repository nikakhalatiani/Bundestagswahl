import dbModule from '../db';
const { pool } = dbModule;

const BASE_VIEWS = [
  "mv_00_direct_candidacy_votes",
  "mv_01_constituency_party_votes",
  "mv_02_party_list_votes",
  "mv_03_constituency_elections",
];

const SEAT_VIEWS = [
  "seat_allocation_cache",
];

async function refreshView(view: string): Promise<void> {
  const start = Date.now();
  await pool.query(`REFRESH MATERIALIZED VIEW ${view}`);
  const elapsed = Date.now() - start;
  console.log(`  ✓ ${view} refreshed in ${elapsed}ms`);
}

export async function refreshSeatCaches(): Promise<void> {
  console.log("\nRefreshing materialized views...");
  const start = Date.now();

  for (const view of BASE_VIEWS) {
    console.log(`  Refreshing ${view}...`);
    await refreshView(view);
  }

  console.log("  Refreshing seat caches...");
  await Promise.all(SEAT_VIEWS.map((view) => refreshView(view)));

  const elapsed = Date.now() - start;
  console.log(`✅ Materialized views refreshed in ${elapsed}ms\n`);
}

export async function isCacheValid(year: number): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM seat_allocation_cache WHERE year = $1 LIMIT 1",
    [year]
  );

  return result.rows.length > 0;
}

export async function ensureCacheExists(year: number): Promise<void> {
  const valid = await isCacheValid(year);
  if (!valid) {
    console.log(`Cache not found for year ${year}, refreshing materialized views...`);
    await refreshSeatCaches();
  }
}
