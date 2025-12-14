// npx ts-node src/debugSeats.ts
// Diagnostic script to find why parties are missing from seat allocation

import dbModule from './db';
const pool = (dbModule as any).pool || (dbModule as any).default?.pool;

async function debugSeats(year: number = 2025) {
  console.log(`\n=== DEBUG: Seat Allocation for ${year} ===\n`);

  // 1. List all parties with their vote counts
  console.log('--- All parties with second votes (from party_lists) ---');
  const partyVotesRes = await pool.query(`
    SELECT 
      p.id AS party_id,
      p.short_name,
      p.long_name,
      p.is_minority,
      COALESCE(SUM(pl.vote_count), 0) AS total_second_votes
    FROM parties p
    LEFT JOIN party_lists pl ON pl.party_id = p.id AND pl.year = $1
    GROUP BY p.id, p.short_name, p.long_name, p.is_minority
    HAVING COALESCE(SUM(pl.vote_count), 0) > 0
    ORDER BY total_second_votes DESC
    LIMIT 20;
  `, [year]);
  console.table(partyVotesRes.rows);

  // 2. Check total second votes
  const totalRes = await pool.query(`
    SELECT SUM(vote_count) AS total_second_votes
    FROM party_lists
    WHERE year = $1;
  `, [year]);
  console.log('\n--- Total second votes ---');
  console.log(totalRes.rows[0]);

  // 3. Check parties with >= 5% threshold
  console.log('\n--- Parties with >= 5% second votes ---');
  const thresholdRes = await pool.query(`
    WITH PartyVotes AS (
      SELECT 
        p.id AS party_id,
        p.short_name,
        COALESCE(SUM(pl.vote_count), 0) AS total_second_votes
      FROM parties p
      LEFT JOIN party_lists pl ON pl.party_id = p.id AND pl.year = $1
      GROUP BY p.id, p.short_name
    ),
    TotalVotes AS (
      SELECT SUM(total_second_votes) AS total FROM PartyVotes
    )
    SELECT 
      pv.party_id,
      pv.short_name,
      pv.total_second_votes,
      (pv.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalVotes), 0)) AS percent
    FROM PartyVotes pv
    WHERE (pv.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalVotes), 0)) >= 5
    ORDER BY percent DESC;
  `, [year]);
  console.table(thresholdRes.rows);

  // 4. Check constituency winners
  console.log('\n--- Constituency winners by party (top 10) ---');
  const winnersRes = await pool.query(`
    WITH WahlkreisGewinner AS (
      SELECT 
        dc.party_id,
        dc.constituency_id,
        dc.first_votes,
        ROW_NUMBER() OVER (
          PARTITION BY dc.constituency_id 
          ORDER BY dc.first_votes DESC
        ) AS rank
      FROM direct_candidacy dc
      WHERE dc.year = $1
    )
    SELECT 
      p.short_name,
      COUNT(*) AS wahlkreis_gewonnen
    FROM WahlkreisGewinner wg
    JOIN parties p ON p.id = wg.party_id
    WHERE wg.rank = 1
    GROUP BY p.id, p.short_name
    ORDER BY wahlkreis_gewonnen DESC
    LIMIT 10;
  `, [year]);
  console.table(winnersRes.rows);

  // 5. Search for GRÜNE specifically
  console.log('\n--- Search for GRÜNE/Grüne/Green parties ---');
  const grueneRes = await pool.query(`
    SELECT id, short_name, long_name, is_minority
    FROM parties
    WHERE short_name ILIKE '%grün%' 
       OR short_name ILIKE '%green%'
       OR long_name ILIKE '%grün%'
       OR short_name ILIKE '%90%'
    LIMIT 10;
  `);
  console.table(grueneRes.rows);

  // 6. Check if GRÜNE has party_lists entries
  console.log('\n--- Party lists for GRÜNE-like parties ---');
  const grueneListsRes = await pool.query(`
    SELECT 
      pl.id, pl.year, pl.state_id, pl.party_id, pl.vote_count,
      p.short_name
    FROM party_lists pl
    JOIN parties p ON p.id = pl.party_id
    WHERE (p.short_name ILIKE '%grün%' OR p.short_name ILIKE '%90%')
      AND pl.year = $1
    LIMIT 20;
  `, [year]);
  console.table(grueneListsRes.rows);

  // 7. Check what the oberverteilung query returns
  console.log('\n--- Oberverteilung result (seats per party) ---');
  const oberRes = await pool.query(`
    WITH RECURSIVE
    BundesweiteZweitstimmen AS (
        SELECT 
            p.id AS party_id,
            p.short_name,
            p.is_minority,
            COALESCE(SUM(pl.vote_count), 0) AS total_second_votes
        FROM parties p
        LEFT JOIN party_lists pl ON pl.party_id = p.id AND pl.year = $1
        GROUP BY p.id, p.short_name, p.is_minority
    ),
    GesamtZweitstimmen AS (
        SELECT SUM(total_second_votes) AS total FROM BundesweiteZweitstimmen
    ),
    WahlkreisGewinner AS (
        SELECT dc.party_id, COUNT(*) AS anzahl
        FROM direct_candidacy dc
        WHERE dc.year = $1
        AND dc.first_votes = (
            SELECT MAX(dc2.first_votes) 
            FROM direct_candidacy dc2 
            WHERE dc2.constituency_id = dc.constituency_id AND dc2.year = $1
        )
        GROUP BY dc.party_id
    ),
    QualifizierteParteien AS (
        SELECT 
            bz.party_id,
            bz.short_name,
            bz.total_second_votes,
            bz.is_minority,
            COALESCE(wg.anzahl, 0) AS direktmandate,
            (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) AS prozent
        FROM BundesweiteZweitstimmen bz
        LEFT JOIN WahlkreisGewinner wg ON wg.party_id = bz.party_id
        WHERE bz.is_minority = TRUE
           OR COALESCE(wg.anzahl, 0) >= 3
           OR (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) >= 5
    )
    SELECT * FROM QualifizierteParteien
    ORDER BY total_second_votes DESC;
  `, [year]);
  console.table(oberRes.rows);

  process.exit(0);
}

debugSeats(2025).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
