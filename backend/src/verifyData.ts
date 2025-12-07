import dbModule from "./db"; // must export { pool, disconnect }
const { pool, disconnect } = dbModule;

async function main() {
  console.log("=== DATABASE OVERVIEW (Counts + Samples) ===\n");

  const tables = [
    "states",
    "parties",
    "elections",
    "constituencies",
    "persons",
    "party_lists",
    "direct_candidacy",
    "party_list_candidacy",
    "constituency_elections",
    "constituency_party_votes",
  ];

  // 1️⃣ Row counts for all tables
  for (const table of tables) {
    const res = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${table}`);
    console.log(`✓ ${table.padEnd(28)}: ${res.rows[0].cnt.toLocaleString()}`);
  }

  console.log("\n=== Sample Data Snapshots ===\n");

  // 2️⃣ States
  console.log("→ States:");
  const states = await pool.query(`SELECT id, abbr, name FROM states ORDER BY id LIMIT 5`);
  if (states.rowCount === 0) console.log("  (No rows)");
  states.rows.forEach((r: any) => console.log(`  [${r.id}] ${r.abbr} - ${r.name}`));

  // 3️⃣ Parties
  console.log("\n→ Parties:");
  const parties = await pool.query(`SELECT id, short_name, long_name FROM parties ORDER BY id LIMIT 5`);
  if (parties.rowCount === 0) console.log("  (No rows)");
  parties.rows.forEach((r: any) => console.log(`  [${r.id}] ${r.short_name}: ${r.long_name}`));

  // 4️⃣ Elections
  console.log("\n→ Elections:");
  const elections = await pool.query(`SELECT year, date FROM elections ORDER BY year`);
  elections.rows.forEach((r: any) =>
    console.log(`  🗳 ${r.year} (${r.date})`)
  );

  // 5️⃣ Constituencies
  console.log("\n→ Constituencies:");
  const constituencies = await pool.query(`
    SELECT c.id, c.number, c.name, s.abbr AS state
    FROM constituencies c
    JOIN states s ON c.state_id = s.id
    ORDER BY c.number
    LIMIT 5
  `);
  if (constituencies.rowCount === 0) console.log("  (No rows)");
  constituencies.rows.forEach((c: any) =>
    console.log(`  ${c.number}: ${c.name} [${c.state}]`)
  );

  // 6️⃣ Persons (candidates)
  console.log("\n→ Persons:");
  const persons = await pool.query(`
    SELECT id, first_name, last_name, birth_year, profession
    FROM persons
    ORDER BY id
    LIMIT 5
  `);
  if (persons.rowCount === 0) console.log("  (No rows)");
  persons.rows.forEach((p: any) =>
    console.log(`  [${p.id}] ${p.first_name} ${p.last_name} (${p.birth_year}) – ${p.profession}`)
  );

  // 7️⃣ Party Lists
  console.log("\n→ Party Lists:");
  const partyLists = await pool.query(`
    SELECT pl.id, e.year, s.abbr AS state, p.short_name AS party, pl.vote_count
    FROM party_lists pl
    JOIN parties p ON pl.party_id = p.id
    JOIN states s ON pl.state_id = s.id
    JOIN elections e ON pl.year = e.year
    ORDER BY pl.id
    LIMIT 5
  `);
  if (partyLists.rowCount === 0) console.log("  (No rows)");
  partyLists.rows.forEach((r: any) =>
    console.log(`  [${r.id}] ${r.year} – ${r.state}/${r.party} = ${r.vote_count}`)
  );

  // 8️⃣ Direct Candidacy
  console.log("\n→ Direct Candidacy:");
  const direct = await pool.query(`
    SELECT 
      dc.person_id, p.first_name, p.last_name,
      pa.short_name AS party,
      co.name AS constituency,
      e.year, dc.first_votes
    FROM direct_candidacy dc
    JOIN persons p ON dc.person_id = p.id
    JOIN parties pa ON dc.party_id = pa.id
    JOIN constituencies co ON dc.constituency_id = co.id
    JOIN elections e ON dc.year = e.year
    ORDER BY e.year, dc.constituency_id
    LIMIT 5
  `);
  if (direct.rowCount === 0) console.log("  (No rows)");
  direct.rows.forEach((r: any) =>
    console.log(
      `  ${r.first_name} ${r.last_name} (${r.party}) – ${r.constituency} ${r.year}: ${r.first_votes}`
    )
  );

  // 9️⃣ Party List Candidacy
  console.log("\n→ Party List Candidacy:");
  const listCand = await pool.query(`
    SELECT
      plc.person_id, p.first_name, p.last_name,
      pa.short_name AS party,
      plc.list_position, e.year
    FROM party_list_candidacy plc
    JOIN persons p ON plc.person_id = p.id
    JOIN party_lists pl ON plc.party_list_id = pl.id
    JOIN elections e ON pl.year = e.year
    JOIN parties pa ON pl.party_id = pa.id
    ORDER BY e.year, list_position
    LIMIT 5
  `);
  if (listCand.rowCount === 0) console.log("  (No rows)");
  listCand.rows.forEach((r: any) =>
    console.log(
      `  ${r.first_name} ${r.last_name} (${r.party}) ${r.year} at position ${r.list_position}`
    )
  );

  // 🔟 Constituency Elections
  console.log("\n→ Constituency Elections:");
  const constElect = await pool.query(`
    SELECT ce.bridge_id, e.year, c.name AS constituency, ce.eligible_voters, ce.total_voters
    FROM constituency_elections ce
    JOIN constituencies c ON ce.constituency_id = c.id
    JOIN elections e ON ce.year = e.year
    ORDER BY e.year, ce.bridge_id
    LIMIT 5
  `);
  if (constElect.rowCount === 0) console.log("  (No rows)");
  constElect.rows.forEach((r: any) =>
    console.log(
      `  ${r.year} – ${r.constituency}: ${r.total_voters}/${r.eligible_voters} voters`
    )
  );

  // 1️⃣1️⃣ Constituency Party Votes
  console.log("\n→ Constituency Party Votes:");
  const constVotes = await pool.query(`
    SELECT 
      e.year, s.abbr AS state, pa.short_name AS party,
      cpv.vote_type, SUM(cpv.votes) AS votes
    FROM constituency_party_votes cpv
      JOIN constituency_elections ce ON cpv.bridge_id = ce.bridge_id
      JOIN constituencies co ON ce.constituency_id = co.id
      JOIN states s ON co.state_id = s.id
      JOIN parties pa ON cpv.party_id = pa.id
      JOIN elections e ON ce.year = e.year
    GROUP BY e.year, s.abbr, pa.short_name, cpv.vote_type
    ORDER BY e.year, s.abbr, pa.short_name, cpv.vote_type
    LIMIT 10
  `);
  if (constVotes.rowCount === 0) console.log("  (No rows)");
  constVotes.rows.forEach((r: any) =>
    console.log(
      `  ${r.year} ${r.state} – ${r.party} (vote_type ${r.vote_type}): ${Number(
        r.votes
      ).toLocaleString()} votes`
    )
  );
}

main()
  .catch((err) => console.error("❌ Error running DB check:", err))
  .finally(async () => {
    await disconnect();
    console.log("\nDatabase connection closed.");
  });