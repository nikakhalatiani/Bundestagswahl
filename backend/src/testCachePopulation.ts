import { refreshSeatCaches } from './services/cacheSeats';
import dbModule from './db';

const { pool } = dbModule;

async function test() {
  try {
    console.log('=== Testing Cache Population ===\n');

    // Refresh materialized views for 2025
    await refreshSeatCaches();

    // Verify row counts
    console.log('=== Verifying Cache Tables ===\n');

    const queries = [
      { name: 'mv_00_direct_candidacy_votes', query: 'SELECT COUNT(*) FROM mv_00_direct_candidacy_votes WHERE year = 2025' },
      { name: 'mv_01_constituency_party_votes', query: 'SELECT COUNT(*) FROM mv_01_constituency_party_votes WHERE year = 2025' },
      { name: 'mv_03_constituency_elections', query: 'SELECT COUNT(*) FROM mv_03_constituency_elections WHERE year = 2025' },
      { name: 'mv_02_party_list_votes', query: 'SELECT COUNT(*) FROM mv_02_party_list_votes WHERE year = 2025' },
      { name: 'seat_allocation_cache', query: 'SELECT COUNT(*) FROM seat_allocation_cache WHERE year = 2025' },
    ];

    for (const { name, query } of queries) {
      const result = await pool.query(query);
      const count = parseInt(result.rows[0].count);
      console.log(`  ${name}: ${count} rows`);
    }

    console.log('\n=== Sample Data from seat_allocation_cache ===\n');
    const sampleResult = await pool.query(`
      SELECT sac.*, p.first_name, p.last_name, pt.short_name as party, s.abbr as state
      FROM seat_allocation_cache sac
      JOIN persons p ON p.id = sac.person_id
      JOIN parties pt ON pt.id = sac.party_id
      JOIN states s ON s.id = sac.state_id
      WHERE sac.year = 2025
      ORDER BY sac.id
      LIMIT 10
    `);

    sampleResult.rows.forEach((row) => {
      console.log(`  ${row.first_name} ${row.last_name} (${row.party}, ${row.state}) - ${row.seat_type}`);
    });

    console.log('\nCache population test completed successfully!');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

test();
