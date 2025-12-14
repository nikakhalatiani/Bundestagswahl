// npx ts-node src/debugSeats2.ts
// Deep debug to find why list seats aren't being allocated

import dbModule from './db';
const pool = (dbModule as any).pool || (dbModule as any).default?.pool;

async function debugSeats2(year: number = 2025) {
  console.log(`\n=== DEEP DEBUG: List Seat Allocation for ${year} ===\n`);

  // 1. Check Oberverteilung (federal seats per party)
  console.log('--- Oberverteilung (federal seats per party via Sainte-Laguë) ---');
  const oberRes = await pool.query(`
    WITH RECURSIVE
    BundesweiteZweitstimmen AS (
        SELECT p.id AS party_id, p.short_name, p.is_minority,
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
        SELECT bz.party_id, bz.short_name, bz.total_second_votes
        FROM BundesweiteZweitstimmen bz
        LEFT JOIN WahlkreisGewinner wg ON wg.party_id = bz.party_id
        WHERE bz.is_minority = TRUE
           OR COALESCE(wg.anzahl, 0) >= 3
           OR (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) >= 5
    ),
    Divisoren AS (
        SELECT 1 AS divisor
        UNION ALL
        SELECT divisor + 2 FROM Divisoren WHERE divisor < 1260
    ),
    Quotienten AS (
        SELECT qp.party_id, qp.short_name, qp.total_second_votes, d.divisor,
               (qp.total_second_votes * 1.0 / d.divisor) AS quotient
        FROM QualifizierteParteien qp
        CROSS JOIN Divisoren d
        WHERE qp.total_second_votes > 0
    ),
    RankedSeats AS (
        SELECT party_id, short_name, quotient,
               ROW_NUMBER() OVER (ORDER BY quotient DESC) AS rang
        FROM Quotienten
    )
    SELECT short_name, COUNT(*) AS sitze_bundesweit
    FROM RankedSeats
    WHERE rang <= 630
    GROUP BY party_id, short_name
    ORDER BY sitze_bundesweit DESC;
  `, [year]);
  console.table(oberRes.rows);

  // 2. Check party_list_candidacy entries for qualified parties
  console.log('\n--- Party list candidacy counts per party ---');
  const plcCountRes = await pool.query(`
    SELECT p.short_name, COUNT(*) AS list_candidates
    FROM party_list_candidacy plc
    JOIN party_lists pl ON pl.id = plc.party_list_id
    JOIN parties p ON p.id = pl.party_id
    WHERE pl.year = $1
    GROUP BY p.id, p.short_name
    ORDER BY list_candidates DESC
    LIMIT 15;
  `, [year]);
  console.table(plcCountRes.rows);

  // 3. Check GRÜNE specifically - do they have list candidates?
  console.log('\n--- GRÜNE list candidates (first 10) ---');
  const grueneListCandRes = await pool.query(`
    SELECT plc.person_id, plc.list_position, pl.state_id, s.name AS state_name,
           per.first_name, per.last_name
    FROM party_list_candidacy plc
    JOIN party_lists pl ON pl.id = plc.party_list_id
    JOIN states s ON s.id = pl.state_id
    JOIN persons per ON per.id = plc.person_id
    WHERE pl.year = $1 AND pl.party_id = 245
    ORDER BY pl.state_id, plc.list_position
    LIMIT 10;
  `, [year]);
  console.table(grueneListCandRes.rows);

  // 4. Check Unterverteilung for GRÜNE
  console.log('\n--- Unterverteilung for GRÜNE (seats per state) ---');
  const unterGrueneRes = await pool.query(`
    WITH RECURSIVE
    BundesweiteZweitstimmen AS (
        SELECT p.id AS party_id, p.short_name, p.is_minority,
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
        SELECT bz.party_id, bz.short_name, bz.total_second_votes
        FROM BundesweiteZweitstimmen bz
        LEFT JOIN WahlkreisGewinner wg ON wg.party_id = bz.party_id
        WHERE bz.is_minority = TRUE
           OR COALESCE(wg.anzahl, 0) >= 3
           OR (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) >= 5
    ),
    Divisoren AS (
        SELECT 1 AS divisor UNION ALL SELECT divisor + 2 FROM Divisoren WHERE divisor < 1260
    ),
    Quotienten AS (
        SELECT qp.party_id, qp.short_name, qp.total_second_votes, d.divisor,
               (qp.total_second_votes * 1.0 / d.divisor) AS quotient
        FROM QualifizierteParteien qp CROSS JOIN Divisoren d
        WHERE qp.total_second_votes > 0
    ),
    RankedSeats AS (
        SELECT party_id, short_name, quotient,
               ROW_NUMBER() OVER (ORDER BY quotient DESC) AS rang
        FROM Quotienten
    ),
    Oberverteilung AS (
        SELECT party_id, short_name, COUNT(*) AS sitze_bundesweit
        FROM RankedSeats WHERE rang <= 630
        GROUP BY party_id, short_name
    ),
    LandesZweitstimmen AS (
        SELECT pl.party_id, pl.state_id, s.name AS state_name, p.short_name, pl.vote_count
        FROM party_lists pl
        JOIN states s ON s.id = pl.state_id
        JOIN parties p ON p.id = pl.party_id
        WHERE pl.year = $1 AND pl.party_id IN (SELECT party_id FROM Oberverteilung)
    ),
    UnterQuotienten AS (
        SELECT lz.party_id, lz.short_name, lz.state_id, lz.state_name, lz.vote_count,
               d.divisor, (lz.vote_count * 1.0 / d.divisor) AS quotient, o.sitze_bundesweit
        FROM LandesZweitstimmen lz
        JOIN Oberverteilung o ON o.party_id = lz.party_id
        CROSS JOIN Divisoren d
    ),
    UnterRanked AS (
        SELECT party_id, short_name, state_id, state_name, quotient, sitze_bundesweit,
               ROW_NUMBER() OVER (PARTITION BY party_id ORDER BY quotient DESC) AS rang
        FROM UnterQuotienten
    )
    SELECT short_name, state_name, COUNT(*) AS sitze_land
    FROM UnterRanked
    WHERE rang <= sitze_bundesweit AND party_id = 245
    GROUP BY party_id, short_name, state_id, state_name
    ORDER BY sitze_land DESC;
  `, [year]);
  console.table(unterGrueneRes.rows);

  // 5. Check how many Direktmandate GRÜNE has per state
  console.log('\n--- GRÜNE Direktmandate per state ---');
  const grueneDirektRes = await pool.query(`
    WITH WahlkreisGewinner AS (
        SELECT dc.party_id, dc.person_id, c.state_id
        FROM direct_candidacy dc
        JOIN constituencies c ON c.id = dc.constituency_id
        WHERE dc.year = $1
        AND dc.first_votes = (
            SELECT MAX(dc2.first_votes)
            FROM direct_candidacy dc2
            WHERE dc2.constituency_id = dc.constituency_id AND dc2.year = $1
        )
    )
    SELECT s.name AS state_name, COUNT(*) AS direktmandate
    FROM WahlkreisGewinner wg
    JOIN states s ON s.id = wg.state_id
    WHERE wg.party_id = 245
    GROUP BY wg.state_id, s.name
    ORDER BY direktmandate DESC;
  `, [year]);
  console.table(grueneDirektRes.rows);

  // 6. Check the final seat allocation breakdown
  console.log('\n--- Final seat allocation by party and type ---');
  const finalRes = await pool.query(`
    WITH RECURSIVE
    WahlkreisErststimmen AS (
        SELECT ce.constituency_id, ce.year, dc.person_id, dc.party_id, dc.first_votes,
               c.name AS constituency_name, c.state_id,
               ROW_NUMBER() OVER (PARTITION BY ce.constituency_id, ce.year ORDER BY dc.first_votes DESC) AS rank
        FROM constituency_elections ce
        JOIN constituencies c ON ce.constituency_id = c.id
        JOIN direct_candidacy dc ON dc.constituency_id = c.id AND dc.year = ce.year
        WHERE ce.year = $1
    ),
    WahlkreisGewinner AS (
        SELECT * FROM WahlkreisErststimmen WHERE rank = 1
    ),
    BundesweiteZweitstimmen AS (
        SELECT p.id AS party_id, p.short_name, p.is_minority,
               COALESCE(SUM(pl.vote_count), 0) AS total_second_votes
        FROM parties p
        LEFT JOIN party_lists pl ON pl.party_id = p.id AND pl.year = $1
        GROUP BY p.id, p.short_name, p.is_minority
    ),
    GesamtZweitstimmen AS (
        SELECT SUM(total_second_votes) AS total FROM BundesweiteZweitstimmen
    ),
    WahlkreisGewinnerProPartei AS (
        SELECT party_id, COUNT(*) AS anzahl_gewinner FROM WahlkreisGewinner GROUP BY party_id
    ),
    QualifizierteParteien AS (
        SELECT bz.party_id, bz.short_name, bz.total_second_votes,
               COALESCE(wgp.anzahl_gewinner, 0) AS anzahl_direktmandate, bz.is_minority,
               CASE 
                   WHEN bz.is_minority THEN TRUE
                   WHEN COALESCE(wgp.anzahl_gewinner, 0) >= 3 THEN TRUE
                   WHEN (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) >= 5 THEN TRUE
                   ELSE FALSE
               END AS ist_qualifiziert
        FROM BundesweiteZweitstimmen bz
        LEFT JOIN WahlkreisGewinnerProPartei wgp ON wgp.party_id = bz.party_id
    ),
    -- Count Direktmandate from qualified parties
    DirektmandateQualifiziert AS (
        SELECT p.short_name, COUNT(*) AS direktmandate
        FROM WahlkreisGewinner wg
        JOIN parties p ON p.id = wg.party_id
        JOIN QualifizierteParteien qp ON qp.party_id = wg.party_id AND qp.ist_qualifiziert = TRUE
        GROUP BY p.id, p.short_name
    )
    SELECT * FROM DirektmandateQualifiziert ORDER BY direktmandate DESC;
  `, [year]);
  console.table(finalRes.rows);

  // 7. Key check: are there party_list_candidacy records at all?
  console.log('\n--- Total party_list_candidacy records for 2025 ---');
  const totalPlcRes = await pool.query(`
    SELECT COUNT(*) AS total_list_candidates
    FROM party_list_candidacy plc
    JOIN party_lists pl ON pl.id = plc.party_list_id
    WHERE pl.year = $1;
  `, [year]);
  console.log(totalPlcRes.rows[0]);

  process.exit(0);
}

debugSeats2(2025).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
