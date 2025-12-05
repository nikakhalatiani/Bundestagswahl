import dbModule from './db';
const { pool, disconnect } = dbModule;

async function main() {
  console.log('Database Statistics:\n');

  const stateCountRes = await pool.query('SELECT COUNT(*)::int as cnt FROM states');
  console.log(`✓ States: ${stateCountRes.rows[0].cnt}`);

  const partyCountRes = await pool.query('SELECT COUNT(*)::int as cnt FROM parties');
  console.log(`✓ Parties: ${partyCountRes.rows[0].cnt}`);

  const constituencyCountRes = await pool.query('SELECT COUNT(*)::int as cnt FROM constituencies');
  console.log(`✓ Constituencies: ${constituencyCountRes.rows[0].cnt}`);

  const candidateCountRes = await pool.query('SELECT COUNT(*)::int as cnt FROM candidates');
  console.log(`✓ Candidates: ${candidateCountRes.rows[0].cnt}`);

  const statePartyCountRes = await pool.query('SELECT COUNT(*)::int as cnt FROM state_parties');
  console.log(`✓ State Party Results: ${statePartyCountRes.rows[0].cnt}`);

  console.log('\n--- Sample Data ---\n');

  // Sample states
  const states = await pool.query('SELECT id, name FROM states LIMIT 3');
  console.log('Sample States:');
  states.rows.forEach((s: any) => console.log(`  ${s.id}: ${s.name}`));

  // Sample parties
  const parties = await pool.query('SELECT id, short_name, long_name FROM parties ORDER BY id ASC LIMIT 5');
  console.log('\nSample Parties:');
  parties.rows.forEach((p: any) => console.log(`  ${p.short_name}: ${p.long_name}`));

  // Sample candidates with party info
  const candidates = await pool.query(`
    SELECT c.*, p.short_name as party_short_name, s.name as state_name
    FROM candidates c
    LEFT JOIN parties p ON p.short_name = c.party_short_name
    LEFT JOIN states s ON s.id = c.state_id
    WHERE c.party_short_name IS NOT NULL
    LIMIT 3
  `);
  console.log('\nSample Candidates:');
  candidates.rows.forEach((c: any) =>
    console.log(`  ${c.first_name} ${c.last_name} (${c.party_short_name}) - ${c.state_name}`)
  );

  // Top parties by second votes
  const topParties = await pool.query(`
    SELECT party_short_name, SUM(second_votes)::int as total
    FROM state_parties
    GROUP BY party_short_name
    ORDER BY total DESC
    LIMIT 5
  `);
  console.log('\nTop 5 Parties by Second Votes:');
  topParties.rows.forEach((p: any) =>
    console.log(`  ${p.party_short_name}: ${p.total.toLocaleString()} votes`)
  );
}

main()
  .catch(console.error)
  .finally(async () => {
    await disconnect();
  });
