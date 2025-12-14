const dbModule = require('./db');
// support both `export default { pool, db }` and named exports
const pool = dbModule.pool || (dbModule.default && dbModule.default.pool);
const drizzleDb = dbModule.db || (dbModule.default && dbModule.default.db);

// ensure this file is treated as a module by TypeScript
export {};

/**
 * Sitzverteilung Bundestagswahl nach dem deutschen Wahlrecht
 * 
 * Algorithmus:
 * 1. Finde Gewinner für jeden Wahlkreis (Erststimmen)
 * 2. Filtere Parteien nach 5%-Hürde, 3 Direktmandate, oder Minderheitenstatus
 * 3. Einzelbewerber und Kandidaten von Parteien unter der Hürde bekommen direkt Sitze
 * 4. Oberverteilung: Sainte-Laguë auf Bundesebene
 * 5. Unterverteilung: Sainte-Laguë pro Partei auf Landesebene
 * 6. Sitze zuerst an Wahlkreisgewinner
 * 7. Übrige Sitze an Listenplätze
 */

async function calculateSeats(electionYear: number = 2025) {
    try {
        const seatAllocationQuery = `
WITH RECURSIVE

-- ============================================================
-- SCHRITT 1: Gewinner für jeden Wahlkreis (Erststimmen)
-- ============================================================
WahlkreisErststimmen AS (
    SELECT 
        ce.constituency_id,
        ce.year,
        dc.person_id,
        dc.party_id,
        dc.first_votes,
        c.name AS constituency_name,
        c.state_id,
        ROW_NUMBER() OVER (
            PARTITION BY ce.constituency_id, ce.year 
            ORDER BY dc.first_votes DESC
        ) AS rank
    FROM constituency_elections ce
    JOIN constituencies c ON ce.constituency_id = c.id
    JOIN direct_candidacy dc ON dc.constituency_id = c.id AND dc.year = ce.year
    WHERE ce.year = $1
),

WahlkreisGewinner AS (
    SELECT 
        constituency_id,
        year,
        person_id,
        party_id,
        first_votes,
        constituency_name,
        state_id
    FROM WahlkreisErststimmen
    WHERE rank = 1
),

-- ============================================================
-- SCHRITT 2: Gesamte Zweitstimmen pro Partei (bundesweit)
-- ============================================================
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

-- Anzahl Wahlkreisgewinner pro Partei
WahlkreisGewinnerProPartei AS (
    SELECT 
        party_id,
        COUNT(*) AS anzahl_gewinner
    FROM WahlkreisGewinner
    GROUP BY party_id
),

-- ============================================================
-- SCHRITT 2: Parteien die die Hürde überspringen
-- Kriterien: Minderheitspartei ODER >= 3 Direktmandate ODER >= 5% Zweitstimmen
-- ============================================================
QualifizierteParteien AS (
    SELECT 
        bz.party_id,
        bz.short_name,
        bz.total_second_votes,
        COALESCE(wgp.anzahl_gewinner, 0) AS anzahl_direktmandate,
        bz.is_minority,
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

-- ============================================================
-- SCHRITT 3: Einzelbewerber und Kandidaten nicht-qualifizierter Parteien
-- Diese bekommen direkt einen Sitz
-- ============================================================
DirekteSitzeOhnePartei AS (
    SELECT 
        wg.person_id,
        wg.constituency_id,
        wg.constituency_name,
        wg.party_id,
        wg.first_votes,
        wg.state_id,
        p.short_name AS party_name,
        'Direktmandat (Partei ohne Qualifikation)' AS sitz_typ
    FROM WahlkreisGewinner wg
    JOIN parties p ON p.id = wg.party_id
    JOIN QualifizierteParteien qp ON qp.party_id = wg.party_id
    WHERE qp.ist_qualifiziert = FALSE
),

AnzahlDirekteSitzeOhnePartei AS (
    SELECT COUNT(*) AS anzahl FROM DirekteSitzeOhnePartei
),

-- ============================================================
-- SCHRITT 4: Oberverteilung mit Sainte-Laguë
-- 630 Sitze minus Einzelbewerber/nicht-qualifizierte Parteien
-- ============================================================
VerfuegbareSitze AS (
    SELECT 630 - (SELECT anzahl FROM AnzahlDirekteSitzeOhnePartei) AS sitze
),

-- Nur qualifizierte Parteien für die Oberverteilung
QualifizierteZweitstimmen AS (
    SELECT 
        party_id,
        short_name,
        total_second_votes
    FROM QualifizierteParteien
    WHERE ist_qualifiziert = TRUE AND total_second_votes > 0
),

-- Sainte-Laguë Divisoren (1, 3, 5, 7, ...)
Divisoren AS (
    SELECT 1 AS divisor
    UNION ALL
    SELECT divisor + 2
    FROM Divisoren
    WHERE divisor < 630  -- Genug Divisoren für alle möglichen Sitze
),

-- Höchstzahlen für Oberverteilung
OberverteilungQuotienten AS (
    SELECT 
        qz.party_id,
        qz.short_name,
        qz.total_second_votes,
        d.divisor,
        (qz.total_second_votes * 1.0 / d.divisor) AS quotient
    FROM QualifizierteZweitstimmen qz
    CROSS JOIN Divisoren d
),

-- Sitze nach Höchstzahlverfahren vergeben
OberverteilungRanked AS (
    SELECT 
        party_id,
        short_name,
        quotient,
        ROW_NUMBER() OVER (ORDER BY quotient DESC) AS sitz_nummer
    FROM OberverteilungQuotienten
),

Oberverteilung AS (
    SELECT 
        party_id,
        short_name,
        COUNT(*) AS sitze_bundesweit
    FROM OberverteilungRanked
    WHERE sitz_nummer <= (SELECT sitze FROM VerfuegbareSitze)
    GROUP BY party_id, short_name
),

-- ============================================================
-- SCHRITT 5: Unterverteilung - Sitze pro Bundesland pro Partei
-- ============================================================
LandeslistenZweitstimmen AS (
    SELECT 
        pl.party_id,
        pl.state_id,
        s.name AS state_name,
        p.short_name AS party_name,
        pl.vote_count AS zweitstimmen_land
    FROM party_lists pl
    JOIN states s ON s.id = pl.state_id
    JOIN parties p ON p.id = pl.party_id
    WHERE pl.year = $1
    AND pl.party_id IN (SELECT party_id FROM Oberverteilung)
),

-- Für jede Partei: Unterverteilung der Sitze auf Bundesländer
UnterverteilungQuotienten AS (
    SELECT 
        lz.party_id,
        lz.party_name,
        lz.state_id,
        lz.state_name,
        lz.zweitstimmen_land,
        d.divisor,
        (lz.zweitstimmen_land * 1.0 / d.divisor) AS quotient,
        o.sitze_bundesweit
    FROM LandeslistenZweitstimmen lz
    JOIN Oberverteilung o ON o.party_id = lz.party_id
    CROSS JOIN Divisoren d
),

UnterverteilungRanked AS (
    SELECT 
        party_id,
        party_name,
        state_id,
        state_name,
        zweitstimmen_land,
        quotient,
        sitze_bundesweit,
        ROW_NUMBER() OVER (
            PARTITION BY party_id 
            ORDER BY quotient DESC
        ) AS sitz_nummer
    FROM UnterverteilungQuotienten
),

Unterverteilung AS (
    SELECT 
        party_id,
        party_name,
        state_id,
        state_name,
        COUNT(*) AS sitze_land
    FROM UnterverteilungRanked ur
    WHERE sitz_nummer <= sitze_bundesweit
    GROUP BY party_id, party_name, state_id, state_name
),

-- ============================================================
-- SCHRITT 6: Wahlkreisgewinner qualifizierter Parteien
-- Mit Ranking nach Erststimmen-Prozent (für Zweitstimmendeckung)
-- ============================================================
WahlkreisGewinnerQualifiziert AS (
    SELECT 
        wg.person_id,
        wg.constituency_id,
        wg.constituency_name,
        wg.party_id,
        wg.first_votes,
        wg.state_id,
        p.short_name AS party_name,
        -- Prozentualer Anteil der Erststimmen im Wahlkreis
        (wg.first_votes * 100.0 / NULLIF(ce.valid_first, 0)) AS prozent_erststimmen
    FROM WahlkreisGewinner wg
    JOIN parties p ON p.id = wg.party_id
    JOIN QualifizierteParteien qp ON qp.party_id = wg.party_id AND qp.ist_qualifiziert = TRUE
    JOIN constituency_elections ce ON ce.constituency_id = wg.constituency_id AND ce.year = $1
),

-- ============================================================
-- SCHRITT 6b: Zweitstimmendeckung (2023 Reform)
-- Pro Bundesland: Nur die stärksten Direktkandidaten bekommen Sitze,
-- bis zur Anzahl der Sitze laut Unterverteilung für dieses Land
-- ============================================================

-- Ranking der Direktkandidaten pro Partei UND BUNDESLAND nach Erststimmen-Prozent
DirektmandateRankedProLand AS (
    SELECT 
        wgq.*,
        ROW_NUMBER() OVER (
            PARTITION BY wgq.party_id, wgq.state_id
            ORDER BY wgq.prozent_erststimmen DESC
        ) AS rang_im_land
    FROM WahlkreisGewinnerQualifiziert wgq
),

-- Nur Direktkandidaten die einen Sitz bekommen 
-- (bis zur Unterverteilung-Grenze pro Bundesland)
DirektmandateMitSitz AS (
    SELECT 
        dr.person_id,
        dr.constituency_id,
        dr.constituency_name,
        dr.party_id,
        dr.first_votes,
        dr.state_id,
        dr.party_name,
        dr.prozent_erststimmen,
        dr.rang_im_land
    FROM DirektmandateRankedProLand dr
    JOIN Unterverteilung u ON u.party_id = dr.party_id AND u.state_id = dr.state_id
    WHERE dr.rang_im_land <= u.sitze_land
),

-- Anzahl vergebene Direktmandate pro Partei pro Land
DirektmandateProParteiLand AS (
    SELECT 
        party_id,
        state_id,
        COUNT(*) AS anzahl_direktmandate
    FROM DirektmandateMitSitz
    GROUP BY party_id, state_id
),

-- ============================================================
-- SCHRITT 7: Listensitze vergeben
-- Verfügbare Listensitze = Unterverteilung - vergebene Direktmandate
-- ============================================================
ListensitzeProParteiLand AS (
    SELECT 
        u.party_id,
        u.party_name,
        u.state_id,
        u.state_name,
        u.sitze_land,
        COALESCE(d.anzahl_direktmandate, 0) AS direktmandate,
        GREATEST(0, u.sitze_land - COALESCE(d.anzahl_direktmandate, 0)) AS listensitze
    FROM Unterverteilung u
    LEFT JOIN DirektmandateProParteiLand d 
        ON d.party_id = u.party_id AND d.state_id = u.state_id
),

-- Listenkandidaten die Sitze bekommen (sortiert nach Listenplatz)
-- Ausgeschlossen: Kandidaten die bereits ein Direktmandat MIT Sitz haben
ListenkandidatenRanked AS (
    SELECT 
        plc.person_id,
        plc.party_list_id,
        plc.list_position,
        pl.party_id,
        pl.state_id,
        p.short_name AS party_name,
        s.name AS state_name,
        per.first_name,
        per.last_name,
        ROW_NUMBER() OVER (
            PARTITION BY pl.party_id, pl.state_id 
            ORDER BY plc.list_position ASC
        ) AS rang
    FROM party_list_candidacy plc
    JOIN party_lists pl ON pl.id = plc.party_list_id AND pl.year = $1
    JOIN parties p ON p.id = pl.party_id
    JOIN states s ON s.id = pl.state_id
    JOIN persons per ON per.id = plc.person_id
    -- Kandidaten die bereits Direktmandat MIT SITZ haben, ausschließen
    WHERE plc.person_id NOT IN (
        SELECT person_id FROM DirektmandateMitSitz
    )
    AND pl.party_id IN (SELECT party_id FROM Oberverteilung)
),

ListensitzGewinner AS (
    SELECT 
        lk.person_id,
        lk.party_id,
        lk.state_id,
        lk.party_name,
        lk.state_name,
        lk.first_name,
        lk.last_name,
        lk.list_position,
        'Listensitz' AS sitz_typ
    FROM ListenkandidatenRanked lk
    JOIN ListensitzeProParteiLand lp 
        ON lp.party_id = lk.party_id AND lp.state_id = lk.state_id
    WHERE lk.rang <= lp.listensitze
)

-- ============================================================
-- FINALE AUSGABE: Alle Sitzgewinner
-- ============================================================
SELECT 
    person_id,
    party_id,
    party_name,
    state_id,
    constituency_name AS wahlkreis,
    NULL AS list_position,
    'Direktmandat' AS sitz_typ,
    prozent_erststimmen
FROM DirektmandateMitSitz

UNION ALL

SELECT 
    person_id,
    party_id,
    party_name,
    state_id,
    NULL AS wahlkreis,
    list_position,
    sitz_typ,
    NULL AS prozent_erststimmen
FROM ListensitzGewinner

UNION ALL

SELECT 
    person_id,
    party_id,
    party_name,
    state_id,
    constituency_name AS wahlkreis,
    NULL AS list_position,
    sitz_typ,
    NULL AS prozent_erststimmen
FROM DirekteSitzeOhnePartei

ORDER BY party_name, sitz_typ, wahlkreis NULLS LAST, list_position NULLS LAST;
`;

        // Zusammenfassung der Sitzverteilung pro Partei
        const summaryQuery = `
WITH RECURSIVE

-- Basis-CTEs (gleich wie oben, gekürzt für Übersicht)
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
    SELECT 
        dc.party_id,
        dc.person_id,
        dc.constituency_id,
        dc.first_votes,
        ROW_NUMBER() OVER (
            PARTITION BY dc.constituency_id 
            ORDER BY dc.first_votes DESC
        ) AS rank
    FROM direct_candidacy dc
    WHERE dc.year = $1
),

WahlkreisGewinnerProPartei AS (
    SELECT party_id, COUNT(*) AS anzahl
    FROM WahlkreisGewinner WHERE rank = 1
    GROUP BY party_id
),

QualifizierteParteien AS (
    SELECT 
        bz.party_id,
        bz.short_name,
        bz.total_second_votes,
        COALESCE(wgp.anzahl, 0) AS direktmandate,
        bz.is_minority,
        (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) AS prozent,
        CASE 
            WHEN bz.is_minority THEN TRUE
            WHEN COALESCE(wgp.anzahl, 0) >= 3 THEN TRUE
            WHEN (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) >= 5 THEN TRUE
            ELSE FALSE
        END AS qualifiziert
    FROM BundesweiteZweitstimmen bz
    LEFT JOIN WahlkreisGewinnerProPartei wgp ON wgp.party_id = bz.party_id
)

SELECT 
    short_name AS partei,
    total_second_votes AS zweitstimmen,
    ROUND(CAST(prozent AS numeric), 2) AS prozent_zweitstimmen,
    direktmandate,
    is_minority AS minderheitspartei,
    qualifiziert AS im_bundestag
FROM QualifizierteParteien
WHERE total_second_votes > 0
ORDER BY total_second_votes DESC;
`;

        // Oberverteilung (Sitze pro Partei bundesweit)
        const oberverteilungQuery = `
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
        bz.total_second_votes
    FROM BundesweiteZweitstimmen bz
    LEFT JOIN WahlkreisGewinner wg ON wg.party_id = bz.party_id
    WHERE bz.is_minority = TRUE
       OR COALESCE(wg.anzahl, 0) >= 3
       OR (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM GesamtZweitstimmen), 0)) >= 5
),

Divisoren AS (
    SELECT 1 AS divisor
    UNION ALL
    SELECT divisor + 2 FROM Divisoren WHERE divisor < 630
),

Quotienten AS (
    SELECT 
        qp.party_id,
        qp.short_name,
        qp.total_second_votes,
        d.divisor,
        (qp.total_second_votes * 1.0 / d.divisor) AS quotient
    FROM QualifizierteParteien qp
    CROSS JOIN Divisoren d
    WHERE qp.total_second_votes > 0
),

RankedSeats AS (
    SELECT 
        party_id,
        short_name,
        quotient,
        ROW_NUMBER() OVER (ORDER BY quotient DESC) AS rang
    FROM Quotienten
)

SELECT 
    short_name AS partei,
    COUNT(*) AS sitze
FROM RankedSeats
WHERE rang <= 630
GROUP BY party_id, short_name
ORDER BY sitze DESC;
`;

        // Unterverteilung (Sitze pro Bundesland pro Partei)
        const unterverteilungQuery = `
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
    SELECT divisor + 2 FROM Divisoren WHERE divisor < 630
),

-- Oberverteilung
OberQuotienten AS (
    SELECT 
        qp.party_id, qp.short_name, qp.total_second_votes, d.divisor,
        (qp.total_second_votes * 1.0 / d.divisor) AS quotient
    FROM QualifizierteParteien qp
    CROSS JOIN Divisoren d
    WHERE qp.total_second_votes > 0
),

OberRanked AS (
    SELECT party_id, short_name, quotient,
        ROW_NUMBER() OVER (ORDER BY quotient DESC) AS rang
    FROM OberQuotienten
),

Oberverteilung AS (
    SELECT party_id, short_name, COUNT(*) AS sitze_bundesweit
    FROM OberRanked WHERE rang <= 630
    GROUP BY party_id, short_name
),

-- Unterverteilung
LandesZweitstimmen AS (
    SELECT pl.party_id, pl.state_id, s.name AS state_name, p.short_name, pl.vote_count
    FROM party_lists pl
    JOIN states s ON s.id = pl.state_id
    JOIN parties p ON p.id = pl.party_id
    WHERE pl.year = $1 AND pl.party_id IN (SELECT party_id FROM Oberverteilung)
),

UnterQuotienten AS (
    SELECT 
        lz.party_id, lz.short_name, lz.state_id, lz.state_name, lz.vote_count,
        d.divisor, (lz.vote_count * 1.0 / d.divisor) AS quotient,
        o.sitze_bundesweit
    FROM LandesZweitstimmen lz
    JOIN Oberverteilung o ON o.party_id = lz.party_id
    CROSS JOIN Divisoren d
),

UnterRanked AS (
    SELECT 
        party_id, short_name, state_id, state_name, quotient, sitze_bundesweit,
        ROW_NUMBER() OVER (PARTITION BY party_id ORDER BY quotient DESC) AS rang
    FROM UnterQuotienten
)

SELECT 
    short_name AS partei,
    state_name AS bundesland,
    COUNT(*) AS sitze
FROM UnterRanked
WHERE rang <= sitze_bundesweit
GROUP BY party_id, short_name, state_id, state_name
ORDER BY short_name, sitze DESC;
`;

        const seatAllocationRes = await pool.query(seatAllocationQuery, [electionYear]);
        const summaryRes = await pool.query(summaryQuery, [electionYear]);
        const oberRes = await pool.query(oberverteilungQuery, [electionYear]);
        const unterRes = await pool.query(unterverteilungQuery, [electionYear]);

        const results = {
            seatAllocation: seatAllocationRes.rows,
            summary: summaryRes.rows,
            oberverteilung: oberRes.rows,
            unterverteilung: unterRes.rows
        };
        
        return results;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

module.exports = calculateSeats;