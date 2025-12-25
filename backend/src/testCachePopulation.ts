import { populateCacheForYear } from './services/cacheSeats';
import dbModule from './db';

const { pool } = dbModule;

async function test() {
  try {
    console.log('=== Testing Cache Population ===\n');

    // Populate cache for 2025
    await populateCacheForYear(2025);

    // Verify row counts
    console.log('=== Verifying Cache Tables ===\n');

    const queries = [
      { name: 'seat_allocation_cache', query: 'SELECT COUNT(*) FROM seat_allocation_cache WHERE year = 2025' },
      { name: 'party_summary_cache', query: 'SELECT COUNT(*) FROM party_summary_cache WHERE year = 2025' },
      { name: 'federal_distribution_cache', query: 'SELECT COUNT(*) FROM federal_distribution_cache WHERE year = 2025' },
      { name: 'state_distribution_cache', query: 'SELECT COUNT(*) FROM state_distribution_cache WHERE year = 2025' },
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

    console.log('\n✅ Cache population test completed successfully!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

test();
