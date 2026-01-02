import dbModule from '../db';
const { pool } = dbModule;
import type { CalculateSeatsResult, FederalDistributionRow, PartySummaryRow, SeatAllocationRow, StateDistributionRow } from '../types/seats';

const calculateSeats: (year: number) => Promise<CalculateSeatsResult> = require('../calculateSeats');

// Cache lookups to avoid repeated queries
let partyCache: Record<string, number> = {};
let stateCache: Record<string, number> = {};

/**
 * Populate seat allocation cache tables from calculateSeats() results
 */
export async function populateCacheForYear(year: number): Promise<void> {
  console.log(`\nPopulating seat allocation cache for year ${year}...`);
  const startTime = Date.now();

  try {
    // Run the seat allocation algorithm
    const results = await calculateSeats(year);

    console.log(`  Algorithm completed in ${Date.now() - startTime}ms`);
    console.log(`  Results: ${results.seatAllocation.length} seats, ${results.summary.length} parties`);

    // Clear existing cache for this year (parallel deletion)
    console.log(`  Clearing existing cache for year ${year}...`);
    await Promise.all([
      pool.query('DELETE FROM seat_allocation_cache WHERE year = $1', [year]),
      pool.query('DELETE FROM party_summary_cache WHERE year = $1', [year]),
      pool.query('DELETE FROM federal_distribution_cache WHERE year = $1', [year]),
      pool.query('DELETE FROM state_distribution_cache WHERE year = $1', [year]),
    ]);

    // Populate seat_allocation_cache (630 rows)
    console.log(`  Inserting ${results.seatAllocation.length} rows into seat_allocation_cache...`);
    if (results.seatAllocation.length > 0) {
      const seatValues = results.seatAllocation.map((row: SeatAllocationRow) =>
        `(${year}, ${row.person_id}, ${row.party_id}, ${row.state_id}, '${row.seat_type}', ${row.constituency ? `'${row.constituency.replace(/'/g, "''")}'` : 'NULL'}, ${row.list_position || 'NULL'}, ${row.percent_first_votes || 'NULL'})`
      ).join(',\n      ');

      await pool.query(`
        INSERT INTO seat_allocation_cache (year, person_id, party_id, state_id, seat_type, constituency_name, list_position, percent_first_votes)
        VALUES ${seatValues}
      `);
    }

    // Populate party_summary_cache (~10-15 rows)
    console.log(`  Inserting ${results.summary.length} rows into party_summary_cache...`);
    if (results.summary.length > 0) {
      const summaryValues = await Promise.all(
        results.summary.map(async (row: PartySummaryRow) => {
          const partyId = await findPartyIdByShortName(row.party);
          return `(${year}, ${partyId}, ${row.second_votes}, ${row.percent_second_votes}, ${row.direct_mandates}, ${row.minority_party}, ${row.in_bundestag})`;
        })
      );

      await pool.query(`
        INSERT INTO party_summary_cache (year, party_id, second_votes, percent_second_votes, direct_mandates, minority_party, in_bundestag)
        VALUES ${summaryValues.join(',\n      ')}
      `);
    }

    // Populate federal_distribution_cache
    console.log(`  Inserting ${results.federalDistribution.length} rows into federal_distribution_cache...`);
    if (results.federalDistribution.length > 0) {
      const federalValues = await Promise.all(
        results.federalDistribution.map(async (row: FederalDistributionRow) => {
          const partyId = await findPartyIdByShortName(row.party);
          return `(${year}, ${partyId}, ${row.seats})`;
        })
      );

      await pool.query(`
        INSERT INTO federal_distribution_cache (year, party_id, seats)
        VALUES ${federalValues.join(',\n      ')}
      `);
    }

    // Populate state_distribution_cache
    console.log(`  Inserting ${results.stateDistribution.length} rows into state_distribution_cache...`);
    if (results.stateDistribution.length > 0) {
      const stateValues = await Promise.all(
        results.stateDistribution.map(async (row: StateDistributionRow) => {
          const partyId = await findPartyIdByShortName(row.party);
          const stateId = await findStateIdByName(row.state);
          return `(${year}, ${partyId}, ${stateId}, ${row.seats})`;
        })
      );

      await pool.query(`
        INSERT INTO state_distribution_cache (year, party_id, state_id, seats)
        VALUES ${stateValues.join(',\n      ')}
      `);
    }

    const elapsed = Date.now() - startTime;
    console.log(`✅ Cache populated successfully in ${elapsed}ms\n`);
  } catch (err) {
    console.error('❌ Cache population failed:', err);
    throw err;
  }
}

/**
 * Helper: map party short_name to party_id (with caching)
 */
async function findPartyIdByShortName(shortName: string): Promise<number> {
  if (partyCache[shortName]) {
    return partyCache[shortName];
  }

  const result = await pool.query(
    'SELECT id FROM parties WHERE short_name = $1 LIMIT 1',
    [shortName]
  );

  if (!result.rows.length) {
    throw new Error(`Party not found: ${shortName}`);
  }

  partyCache[shortName] = result.rows[0].id;
  return result.rows[0].id;
}

/**
 * Helper: map state name to state_id (with caching)
 */
async function findStateIdByName(name: string): Promise<number> {
  if (stateCache[name]) {
    return stateCache[name];
  }

  const result = await pool.query(
    'SELECT id FROM states WHERE name = $1 LIMIT 1',
    [name]
  );

  if (!result.rows.length) {
    throw new Error(`State not found: ${name}`);
  }

  stateCache[name] = result.rows[0].id;
  return result.rows[0].id;
}

/**
 * Check if cache exists for a given year
 */
export async function isCacheValid(year: number): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM seat_allocation_cache WHERE year = $1 LIMIT 1',
    [year]
  );

  return result.rows.length > 0;
}

/**
 * Ensure cache exists for a year, populate if not
 */
export async function ensureCacheExists(year: number): Promise<void> {
  const valid = await isCacheValid(year);
  if (!valid) {
    console.log(`Cache not found for year ${year}, generating...`);
    await populateCacheForYear(year);
  }
}
