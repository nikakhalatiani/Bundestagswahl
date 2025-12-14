// npx ts-node src/debugSeats3.ts
// Final debug: check each part of the main seatAllocation query

import dbModule from './db';
const pool = (dbModule as any).pool || (dbModule as any).default?.pool;

async function debugSeats3(year: number = 2025) {
  console.log(`\n=== DEBUG PART 3: Trace seatAllocation query ===\n`);

  // Check what WahlkreisGewinnerQualifiziert returns for GRÜNE
  console.log('--- 1. WahlkreisGewinnerQualifiziert (Direktmandate from qualified parties) ---');
  const direktRes = await pool.query(`
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
               (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) AS prozent_zweitstimmen,
               CASE 
                   WHEN bz.is_minority THEN TRUE
                   WHEN COALESCE(wgp.anzahl_gewinner, 0) >= 3 THEN TRUE
                   WHEN (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) >= 5 THEN TRUE
                   ELSE FALSE
               END AS ist_qualifiziert
        FROM BundesweiteZweitstimmen bz
        LEFT JOIN WahlkreisGewinnerProPartei wgp ON wgp.party_id = bz.party_id
    ),
    WahlkreisGewinnerQualifiziert AS (
        SELECT wg.person_id, wg.constituency_id, wg.constituency_name, wg.party_id,
               wg.first_votes, wg.state_id, p.short_name AS party_name,
               (wg.first_votes * 100.0 / NULLIF(ce.valid_first, 0)) AS prozent_erststimmen
        FROM WahlkreisGewinner wg
        JOIN parties p ON p.id = wg.party_id
        JOIN QualifizierteParteien qp ON qp.party_id = wg.party_id AND qp.ist_qualifiziert = TRUE
        JOIN constituency_elections ce ON ce.constituency_id = wg.constituency_id AND ce.year = $1
    )
    SELECT party_name, COUNT(*) AS direktmandate
    FROM WahlkreisGewinnerQualifiziert
    GROUP BY party_id, party_name
    ORDER BY direktmandate DESC;
  `, [year]);
  console.table(direktRes.rows);

  // Check ListensitzeProParteiLand
  console.log('\n--- 2. ListensitzeProParteiLand (available list seats per party per state) ---');
  const listSitzeRes = await pool.query(`
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
    WahlkreisGewinner AS (SELECT * FROM WahlkreisErststimmen WHERE rank = 1),
    BundesweiteZweitstimmen AS (
        SELECT p.id AS party_id, p.short_name, p.is_minority,
               COALESCE(SUM(pl.vote_count), 0) AS total_second_votes
        FROM parties p LEFT JOIN party_lists pl ON pl.party_id = p.id AND pl.year = $1
        GROUP BY p.id, p.short_name, p.is_minority
    ),
    GesamtZweitstimmen AS (SELECT SUM(total_second_votes) AS total FROM BundesweiteZweitstimmen),
    WahlkreisGewinnerProPartei AS (SELECT party_id, COUNT(*) AS anzahl_gewinner FROM WahlkreisGewinner GROUP BY party_id),
    QualifizierteParteien AS (
        SELECT bz.party_id, bz.short_name, bz.total_second_votes,
               COALESCE(wgp.anzahl_gewinner, 0) AS anzahl_direktmandate, bz.is_minority,
               CASE WHEN bz.is_minority THEN TRUE
                    WHEN COALESCE(wgp.anzahl_gewinner, 0) >= 3 THEN TRUE
                    WHEN (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) >= 5 THEN TRUE
                    ELSE FALSE END AS ist_qualifiziert
        FROM BundesweiteZweitstimmen bz
        LEFT JOIN WahlkreisGewinnerProPartei wgp ON wgp.party_id = bz.party_id
    ),
    DirekteSitzeOhnePartei AS (
        SELECT wg.person_id FROM WahlkreisGewinner wg
        JOIN QualifizierteParteien qp ON qp.party_id = wg.party_id WHERE qp.ist_qualifiziert = FALSE
    ),
    AnzahlDirekteSitzeOhnePartei AS (SELECT COUNT(*) AS anzahl FROM DirekteSitzeOhnePartei),
    VerfuegbareSitze AS (SELECT 630 - (SELECT anzahl FROM AnzahlDirekteSitzeOhnePartei) AS sitze),
    QualifizierteZweitstimmen AS (
        SELECT party_id, short_name, total_second_votes FROM QualifizierteParteien
        WHERE ist_qualifiziert = TRUE AND total_second_votes > 0
    ),
    Divisoren AS (SELECT 1 AS divisor UNION ALL SELECT divisor + 2 FROM Divisoren WHERE divisor < 1260),
    OberverteilungQuotienten AS (
        SELECT qz.party_id, qz.short_name, qz.total_second_votes, d.divisor,
               (qz.total_second_votes * 1.0 / d.divisor) AS quotient
        FROM QualifizierteZweitstimmen qz CROSS JOIN Divisoren d
    ),
    OberverteilungRanked AS (
        SELECT party_id, short_name, quotient,
               ROW_NUMBER() OVER (ORDER BY quotient DESC) AS sitz_nummer
        FROM OberverteilungQuotienten
    ),
    Oberverteilung AS (
        SELECT party_id, short_name, COUNT(*) AS sitze_bundesweit
        FROM OberverteilungRanked WHERE sitz_nummer <= (SELECT sitze FROM VerfuegbareSitze)
        GROUP BY party_id, short_name
    ),
    LandeslistenZweitstimmen AS (
        SELECT pl.party_id, pl.state_id, s.name AS state_name, p.short_name AS party_name, pl.vote_count AS zweitstimmen_land
        FROM party_lists pl
        JOIN states s ON s.id = pl.state_id JOIN parties p ON p.id = pl.party_id
        WHERE pl.year = $1 AND pl.party_id IN (SELECT party_id FROM Oberverteilung)
    ),
    UnterverteilungQuotienten AS (
        SELECT lz.party_id, lz.party_name, lz.state_id, lz.state_name, lz.zweitstimmen_land,
               d.divisor, (lz.zweitstimmen_land * 1.0 / d.divisor) AS quotient, o.sitze_bundesweit
        FROM LandeslistenZweitstimmen lz
        JOIN Oberverteilung o ON o.party_id = lz.party_id CROSS JOIN Divisoren d
    ),
    UnterverteilungRanked AS (
        SELECT party_id, party_name, state_id, state_name, zweitstimmen_land, quotient, sitze_bundesweit,
               ROW_NUMBER() OVER (PARTITION BY party_id ORDER BY quotient DESC) AS sitz_nummer
        FROM UnterverteilungQuotienten
    ),
    Unterverteilung AS (
        SELECT party_id, party_name, state_id, state_name, COUNT(*) AS sitze_land
        FROM UnterverteilungRanked ur WHERE sitz_nummer <= sitze_bundesweit
        GROUP BY party_id, party_name, state_id, state_name
    ),
    WahlkreisGewinnerQualifiziert AS (
        SELECT wg.person_id, wg.constituency_id, wg.party_id, wg.state_id
        FROM WahlkreisGewinner wg
        JOIN QualifizierteParteien qp ON qp.party_id = wg.party_id AND qp.ist_qualifiziert = TRUE
    ),
    DirektmandateProParteiLand AS (
        SELECT party_id, state_id, COUNT(*) AS anzahl_direktmandate
        FROM WahlkreisGewinnerQualifiziert GROUP BY party_id, state_id
    ),
    ListensitzeProParteiLand AS (
        SELECT u.party_id, u.party_name, u.state_id, u.state_name, u.sitze_land,
               COALESCE(d.anzahl_direktmandate, 0) AS direktmandate,
               GREATEST(0, u.sitze_land - COALESCE(d.anzahl_direktmandate, 0)) AS listensitze
        FROM Unterverteilung u
        LEFT JOIN DirektmandateProParteiLand d ON d.party_id = u.party_id AND d.state_id = u.state_id
    )
    SELECT party_name, SUM(sitze_land) AS total_sitze, SUM(direktmandate) AS total_direkt, SUM(listensitze) AS total_list
    FROM ListensitzeProParteiLand
    GROUP BY party_id, party_name
    ORDER BY total_sitze DESC;
  `, [year]);
  console.table(listSitzeRes.rows);

  // Check ListenkandidatenRanked count per party
  console.log('\n--- 3. ListenkandidatenRanked count (candidates eligible for list seats) ---');
  const listKandRes = await pool.query(`
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
    WahlkreisGewinner AS (SELECT * FROM WahlkreisErststimmen WHERE rank = 1),
    BundesweiteZweitstimmen AS (
        SELECT p.id AS party_id, p.short_name, p.is_minority,
               COALESCE(SUM(pl.vote_count), 0) AS total_second_votes
        FROM parties p LEFT JOIN party_lists pl ON pl.party_id = p.id AND pl.year = $1
        GROUP BY p.id, p.short_name, p.is_minority
    ),
    GesamtZweitstimmen AS (SELECT SUM(total_second_votes) AS total FROM BundesweiteZweitstimmen),
    WahlkreisGewinnerProPartei AS (SELECT party_id, COUNT(*) AS anzahl_gewinner FROM WahlkreisGewinner GROUP BY party_id),
    QualifizierteParteien AS (
        SELECT bz.party_id, bz.short_name, bz.total_second_votes,
               COALESCE(wgp.anzahl_gewinner, 0) AS anzahl_direktmandate, bz.is_minority,
               CASE WHEN bz.is_minority THEN TRUE
                    WHEN COALESCE(wgp.anzahl_gewinner, 0) >= 3 THEN TRUE
                    WHEN (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) >= 5 THEN TRUE
                    ELSE FALSE END AS ist_qualifiziert
        FROM BundesweiteZweitstimmen bz
        LEFT JOIN WahlkreisGewinnerProPartei wgp ON wgp.party_id = bz.party_id
    ),
    DirekteSitzeOhnePartei AS (
        SELECT wg.person_id FROM WahlkreisGewinner wg
        JOIN QualifizierteParteien qp ON qp.party_id = wg.party_id WHERE qp.ist_qualifiziert = FALSE
    ),
    AnzahlDirekteSitzeOhnePartei AS (SELECT COUNT(*) AS anzahl FROM DirekteSitzeOhnePartei),
    VerfuegbareSitze AS (SELECT 630 - (SELECT anzahl FROM AnzahlDirekteSitzeOhnePartei) AS sitze),
    QualifizierteZweitstimmen AS (
        SELECT party_id, short_name, total_second_votes FROM QualifizierteParteien
        WHERE ist_qualifiziert = TRUE AND total_second_votes > 0
    ),
    Divisoren AS (SELECT 1 AS divisor UNION ALL SELECT divisor + 2 FROM Divisoren WHERE divisor < 1260),
    OberverteilungQuotienten AS (
        SELECT qz.party_id, qz.short_name, qz.total_second_votes, d.divisor,
               (qz.total_second_votes * 1.0 / d.divisor) AS quotient
        FROM QualifizierteZweitstimmen qz CROSS JOIN Divisoren d
    ),
    OberverteilungRanked AS (
        SELECT party_id, short_name, quotient, ROW_NUMBER() OVER (ORDER BY quotient DESC) AS sitz_nummer
        FROM OberverteilungQuotienten
    ),
    Oberverteilung AS (
        SELECT party_id, short_name, COUNT(*) AS sitze_bundesweit
        FROM OberverteilungRanked WHERE sitz_nummer <= (SELECT sitze FROM VerfuegbareSitze)
        GROUP BY party_id, short_name
    ),
    WahlkreisGewinnerQualifiziert AS (
        SELECT wg.person_id, wg.constituency_id, wg.party_id, wg.state_id
        FROM WahlkreisGewinner wg
        JOIN QualifizierteParteien qp ON qp.party_id = wg.party_id AND qp.ist_qualifiziert = TRUE
    ),
    ListenkandidatenRanked AS (
        SELECT plc.person_id, plc.party_list_id, plc.list_position, pl.party_id, pl.state_id,
               p.short_name AS party_name, s.name AS state_name, per.first_name, per.last_name,
               ROW_NUMBER() OVER (PARTITION BY pl.party_id, pl.state_id ORDER BY plc.list_position ASC) AS rang
        FROM party_list_candidacy plc
        JOIN party_lists pl ON pl.id = plc.party_list_id AND pl.year = $1
        JOIN parties p ON p.id = pl.party_id
        JOIN states s ON s.id = pl.state_id
        JOIN persons per ON per.id = plc.person_id
        WHERE plc.person_id NOT IN (SELECT person_id FROM WahlkreisGewinnerQualifiziert)
        AND pl.party_id IN (SELECT party_id FROM Oberverteilung)
    )
    SELECT party_name, COUNT(*) AS eligible_list_candidates
    FROM ListenkandidatenRanked
    GROUP BY party_id, party_name
    ORDER BY eligible_list_candidates DESC;
  `, [year]);
  console.table(listKandRes.rows);

  // Check actual ListensitzGewinner count
  console.log('\n--- 4. ListensitzGewinner count (actual list seat winners) ---');
  const listWinnerRes = await pool.query(`
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
    WahlkreisGewinner AS (SELECT * FROM WahlkreisErststimmen WHERE rank = 1),
    BundesweiteZweitstimmen AS (
        SELECT p.id AS party_id, p.short_name, p.is_minority,
               COALESCE(SUM(pl.vote_count), 0) AS total_second_votes
        FROM parties p LEFT JOIN party_lists pl ON pl.party_id = p.id AND pl.year = $1
        GROUP BY p.id, p.short_name, p.is_minority
    ),
    GesamtZweitstimmen AS (SELECT SUM(total_second_votes) AS total FROM BundesweiteZweitstimmen),
    WahlkreisGewinnerProPartei AS (SELECT party_id, COUNT(*) AS anzahl_gewinner FROM WahlkreisGewinner GROUP BY party_id),
    QualifizierteParteien AS (
        SELECT bz.party_id, bz.short_name, bz.total_second_votes,
               COALESCE(wgp.anzahl_gewinner, 0) AS anzahl_direktmandate, bz.is_minority,
               CASE WHEN bz.is_minority THEN TRUE
                    WHEN COALESCE(wgp.anzahl_gewinner, 0) >= 3 THEN TRUE
                    WHEN (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) >= 5 THEN TRUE
                    ELSE FALSE END AS ist_qualifiziert
        FROM BundesweiteZweitstimmen bz
        LEFT JOIN WahlkreisGewinnerProPartei wgp ON wgp.party_id = bz.party_id
    ),
    DirekteSitzeOhnePartei AS (
        SELECT wg.person_id FROM WahlkreisGewinner wg
        JOIN QualifizierteParteien qp ON qp.party_id = wg.party_id WHERE qp.ist_qualifiziert = FALSE
    ),
    AnzahlDirekteSitzeOhnePartei AS (SELECT COUNT(*) AS anzahl FROM DirekteSitzeOhnePartei),
    VerfuegbareSitze AS (SELECT 630 - (SELECT anzahl FROM AnzahlDirekteSitzeOhnePartei) AS sitze),
    QualifizierteZweitstimmen AS (
        SELECT party_id, short_name, total_second_votes FROM QualifizierteParteien
        WHERE ist_qualifiziert = TRUE AND total_second_votes > 0
    ),
    Divisoren AS (SELECT 1 AS divisor UNION ALL SELECT divisor + 2 FROM Divisoren WHERE divisor < 1260),
    OberverteilungQuotienten AS (
        SELECT qz.party_id, qz.short_name, qz.total_second_votes, d.divisor,
               (qz.total_second_votes * 1.0 / d.divisor) AS quotient
        FROM QualifizierteZweitstimmen qz CROSS JOIN Divisoren d
    ),
    OberverteilungRanked AS (
        SELECT party_id, short_name, quotient, ROW_NUMBER() OVER (ORDER BY quotient DESC) AS sitz_nummer
        FROM OberverteilungQuotienten
    ),
    Oberverteilung AS (
        SELECT party_id, short_name, COUNT(*) AS sitze_bundesweit
        FROM OberverteilungRanked WHERE sitz_nummer <= (SELECT sitze FROM VerfuegbareSitze)
        GROUP BY party_id, short_name
    ),
    LandeslistenZweitstimmen AS (
        SELECT pl.party_id, pl.state_id, s.name AS state_name, p.short_name AS party_name, pl.vote_count AS zweitstimmen_land
        FROM party_lists pl
        JOIN states s ON s.id = pl.state_id JOIN parties p ON p.id = pl.party_id
        WHERE pl.year = $1 AND pl.party_id IN (SELECT party_id FROM Oberverteilung)
    ),
    UnterverteilungQuotienten AS (
        SELECT lz.party_id, lz.party_name, lz.state_id, lz.state_name, lz.zweitstimmen_land,
               d.divisor, (lz.zweitstimmen_land * 1.0 / d.divisor) AS quotient, o.sitze_bundesweit
        FROM LandeslistenZweitstimmen lz
        JOIN Oberverteilung o ON o.party_id = lz.party_id CROSS JOIN Divisoren d
    ),
    UnterverteilungRanked AS (
        SELECT party_id, party_name, state_id, state_name, zweitstimmen_land, quotient, sitze_bundesweit,
               ROW_NUMBER() OVER (PARTITION BY party_id ORDER BY quotient DESC) AS sitz_nummer
        FROM UnterverteilungQuotienten
    ),
    Unterverteilung AS (
        SELECT party_id, party_name, state_id, state_name, COUNT(*) AS sitze_land
        FROM UnterverteilungRanked ur WHERE sitz_nummer <= sitze_bundesweit
        GROUP BY party_id, party_name, state_id, state_name
    ),
    WahlkreisGewinnerQualifiziert AS (
        SELECT wg.person_id, wg.constituency_id, wg.party_id, wg.state_id
        FROM WahlkreisGewinner wg
        JOIN QualifizierteParteien qp ON qp.party_id = wg.party_id AND qp.ist_qualifiziert = TRUE
    ),
    DirektmandateProParteiLand AS (
        SELECT party_id, state_id, COUNT(*) AS anzahl_direktmandate
        FROM WahlkreisGewinnerQualifiziert GROUP BY party_id, state_id
    ),
    ListensitzeProParteiLand AS (
        SELECT u.party_id, u.party_name, u.state_id, u.state_name, u.sitze_land,
               COALESCE(d.anzahl_direktmandate, 0) AS direktmandate,
               GREATEST(0, u.sitze_land - COALESCE(d.anzahl_direktmandate, 0)) AS listensitze
        FROM Unterverteilung u
        LEFT JOIN DirektmandateProParteiLand d ON d.party_id = u.party_id AND d.state_id = u.state_id
    ),
    ListenkandidatenRanked AS (
        SELECT plc.person_id, plc.party_list_id, plc.list_position, pl.party_id, pl.state_id,
               p.short_name AS party_name, s.name AS state_name, per.first_name, per.last_name,
               ROW_NUMBER() OVER (PARTITION BY pl.party_id, pl.state_id ORDER BY plc.list_position ASC) AS rang
        FROM party_list_candidacy plc
        JOIN party_lists pl ON pl.id = plc.party_list_id AND pl.year = $1
        JOIN parties p ON p.id = pl.party_id
        JOIN states s ON s.id = pl.state_id
        JOIN persons per ON per.id = plc.person_id
        WHERE plc.person_id NOT IN (SELECT person_id FROM WahlkreisGewinnerQualifiziert)
        AND pl.party_id IN (SELECT party_id FROM Oberverteilung)
    ),
    ListensitzGewinner AS (
        SELECT lk.person_id, lk.party_id, lk.state_id, lk.party_name, lk.state_name,
               lk.first_name, lk.last_name, lk.list_position, 'Listensitz' AS sitz_typ
        FROM ListenkandidatenRanked lk
        JOIN ListensitzeProParteiLand lp ON lp.party_id = lk.party_id AND lp.state_id = lk.state_id
        WHERE lk.rang <= lp.listensitze
    )
    SELECT party_name, COUNT(*) AS list_seats
    FROM ListensitzGewinner
    GROUP BY party_id, party_name
    ORDER BY list_seats DESC;
  `, [year]);
  console.table(listWinnerRes.rows);

  process.exit(0);
}

debugSeats3(2025).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
