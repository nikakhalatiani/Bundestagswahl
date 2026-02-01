import dbModule from "./db"; // must export { pool, disconnect }
const { pool, disconnect } = dbModule;

type CountRow = { cnt: number };
type StateRow = { id: number; abbr: string; name: string };
type PartyRow = { id: number; short_name: string; long_name: string };
type ElectionRow = { year: number; date: string };
type ConstituencyRow = { id: number; number: number; name: string; state: string };
type PersonRow = { id: number; first_name: string; last_name: string; birth_year: number | null; profession: string | null };
type PartyListRow = { id: number; year: number; state: string; party: string };
type DirectCandidacyRow = { person_id: number; first_name: string; last_name: string; party: string; constituency: string; year: number };
type PartyListCandidacyRow = { person_id: number; first_name: string; last_name: string; party: string; list_position: number | null; year: number };
type ConstituencyElectionRow = { bridge_id: number; year: number; constituency: string; eligible_voters: number | null };
type ConstituencyPartyVotesRow = { year: number; state: string; party: string; vote_type: number; votes: number | string };

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
  ];

  // Row counts for all tables
  for (const table of tables) {
    const res = await pool.query<CountRow>(`SELECT COUNT(*)::int AS cnt FROM ${table}`);
    console.log(`✓ ${table.padEnd(28)}: ${res.rows[0].cnt.toLocaleString()}`);
  }

  console.log("\n=== Sample Data Snapshots ===\n");

  // States
  console.log("→ States:");
  const states = await pool.query<StateRow>(`SELECT id, abbr, name FROM states ORDER BY id LIMIT 5`);
  if (states.rowCount === 0) console.log("  (No rows)");
  states.rows.forEach((r) => console.log(`  [${r.id}] ${r.abbr} - ${r.name}`));

  // Parties
  console.log("\n→ Parties:");
  const parties = await pool.query<PartyRow>(`SELECT id, short_name, long_name FROM parties ORDER BY id LIMIT 5`);
  if (parties.rowCount === 0) console.log("  (No rows)");
  parties.rows.forEach((r) => console.log(`  [${r.id}] ${r.short_name}: ${r.long_name}`));

  // Elections
  console.log("\n→ Elections:");
  const elections = await pool.query<ElectionRow>(`SELECT year, date FROM elections ORDER BY year`);
  elections.rows.forEach((r) => console.log(`  ${r.year} (${r.date})`));

  // Constituencies
  console.log("\n→ Constituencies:");
  const constituencies = await pool.query<ConstituencyRow>(`
    SELECT c.id, c.number, c.name, s.abbr AS state
    FROM constituencies c
    JOIN states s ON c.state_id = s.id
    ORDER BY c.number
    LIMIT 5
  `);
  if (constituencies.rowCount === 0) console.log("  (No rows)");
  constituencies.rows.forEach((c) => console.log(`  ${c.number}: ${c.name} [${c.state}]`));

  // Persons (candidates)
  console.log("\n→ Persons:");
  const persons = await pool.query<PersonRow>(`
    SELECT id, first_name, last_name, birth_year, profession
    FROM persons
    ORDER BY id
    LIMIT 5
  `);
  if (persons.rowCount === 0) console.log("  (No rows)");
  persons.rows.forEach((p) =>
    console.log(`  [${p.id}] ${p.first_name} ${p.last_name} (${p.birth_year}) – ${p.profession}`)
  );

  // Party Lists
  console.log("\n→ Party Lists:");
  const partyLists = await pool.query<PartyListRow>(`
    SELECT pl.id, e.year, s.abbr AS state, p.short_name AS party
    FROM party_lists pl
    JOIN parties p ON pl.party_id = p.id
    JOIN states s ON pl.state_id = s.id
    JOIN elections e ON pl.year = e.year
    ORDER BY pl.id
    LIMIT 5
  `);
  if (partyLists.rowCount === 0) console.log("  (No rows)");
  partyLists.rows.forEach((r) =>
    console.log(`  [${r.id}] ${r.year} – ${r.state}/${r.party}`)
  );

  // Direct Candidacy
  console.log("\n→ Direct Candidacy:");
  const direct = await pool.query<DirectCandidacyRow>(`
    SELECT 
      dc.person_id, p.first_name, p.last_name,
      pa.short_name AS party,
      co.name AS constituency,
      ce.year
    FROM direct_candidacy dc
    JOIN constituency_elections ce ON ce.bridge_id = dc.constituency_election_id
    JOIN persons p ON dc.person_id = p.id
    JOIN parties pa ON dc.party_id = pa.id
    JOIN constituencies co ON ce.constituency_id = co.id
    ORDER BY ce.year, ce.constituency_id
    LIMIT 5
  `);
  if (direct.rowCount === 0) console.log("  (No rows)");
  direct.rows.forEach((r) =>
    console.log(
      `  ${r.first_name} ${r.last_name} (${r.party}) – ${r.constituency} ${r.year}`
    )
  );

  // Party List Candidacy
  console.log("\n→ Party List Candidacy:");
  const listCand = await pool.query<PartyListCandidacyRow>(`
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
  listCand.rows.forEach((r) =>
    console.log(
      `  ${r.first_name} ${r.last_name} (${r.party}) ${r.year} at position ${r.list_position}`
    )
  );

  // Constituency Elections
  console.log("\n→ Constituency Elections:");
  const constElect = await pool.query<ConstituencyElectionRow>(`
    SELECT ce.bridge_id, e.year, c.name AS constituency, ce.eligible_voters
    FROM constituency_elections ce
    JOIN constituencies c ON ce.constituency_id = c.id
    JOIN elections e ON ce.year = e.year
    ORDER BY e.year, ce.bridge_id
    LIMIT 5
  `);
  if (constElect.rowCount === 0) console.log("  (No rows)");
  constElect.rows.forEach((r) =>
    console.log(
      `  ${r.year} – ${r.constituency}: eligible voters ${r.eligible_voters ?? '-'}`
    )
  );

  // Constituency Party Votes
  console.log("\n→ Constituency Party Votes:");
  const constVotes = await pool.query<ConstituencyPartyVotesRow>(`
    SELECT 
      e.year, s.abbr AS state, pa.short_name AS party,
      cpv.vote_type, SUM(cpv.votes) AS votes
    FROM mv_01_constituency_party_votes cpv
      JOIN constituencies co ON cpv.constituency_id = co.id
      JOIN states s ON co.state_id = s.id
      JOIN parties pa ON cpv.party_id = pa.id
      JOIN elections e ON cpv.year = e.year
    GROUP BY e.year, s.abbr, pa.short_name, cpv.vote_type
    ORDER BY e.year, s.abbr, pa.short_name, cpv.vote_type
    LIMIT 10
  `);
  if (constVotes.rowCount === 0) console.log("  (No rows)");
  constVotes.rows.forEach((r) =>
    console.log(
      `  ${r.year} ${r.state} – ${r.party} (vote_type ${r.vote_type}): ${Number(
        r.votes
      ).toLocaleString()} votes`
    )
  );
}

main()
  .catch((err) => console.error("Error running DB check:", err))
  .finally(async () => {
    await disconnect();
    console.log("\nDatabase connection closed.");
  });
