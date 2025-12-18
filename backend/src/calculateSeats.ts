const dbModule = require('./db');
// support both `export default { pool, db }` and named exports
const pool = dbModule.pool || (dbModule.default && dbModule.default.pool);
const drizzleDb = dbModule.db || (dbModule.default && dbModule.default.db);

// ensure this file is treated as a module by TypeScript
export { };

/**
 * Seat Allocation for German Federal Election (Bundestagswahl)
 * Implements the German electoral system with 2023 reform
 *
 * === 2023 ELECTORAL REFORM (Bundeswahlrechtsreform 2023) ===
 *
 * The 2023 reform fundamentally changed the German electoral system to address
 * the problem of an ever-growing Bundestag. Key changes:
 *
 * 1. FIXED BUNDESTAG SIZE: Exactly 630 seats (previously 598 + overhang + leveling seats)
 *    - The Bundestag had grown to 736 seats in 2021 due to overhang and leveling seats
 *    - Reform caps it at 630 seats regardless of election results
 *
 * 2. ABOLITION OF OVERHANG MANDATES (Überhangmandate):
 *    - OLD: If a party won more constituencies than proportional seats, they kept all
 *    - NEW: "Second-Vote Coverage" (Zweitstimmendeckung) - only the strongest direct
 *      candidates (by first-vote percentage) get seats, up to the party's proportional share
 *    - Weaker direct candidates lose their mandate if party exceeds proportional allocation
 *
 * 3. ABOLITION OF LEVELING SEATS (Ausgleichsmandate):
 *    - OLD: Other parties received additional seats to maintain proportionality
 *    - NEW: Not needed since overhang mandates are eliminated
 *
 * 4. TWO-TIER PROPORTIONAL ALLOCATION:
 *    - Federal level (Oberverteilung): 630 seats allocated by Sainte-Laguë
 *    - State level (Unterverteilung): Each party's seats distributed across states by Sainte-Laguë
 *
 * 5. TIE-BREAKING RULES:
 *    - Primary: Highest quotient (votes / divisor)
 *    - Secondary: Most votes (federal or state level)
 *    - Tertiary: Lower party_id or state_id (deterministic)
 *
 * === ALGORITHM STEPS ===
 *
 * 1. Find winner for each constituency (first votes / Erststimmen)
 * 2. Filter parties by 5% threshold, 3 direct mandates, or minority status
 * 3. Independent candidates and candidates from non-qualified parties get seats directly
 * 4. Federal Distribution (Oberverteilung): Sainte-Laguë at federal level
 *    - Allocate 630 seats minus non-qualified party seats
 *    - Only qualified parties participate
 * 5. State Distribution (Unterverteilung): Sainte-Laguë per party at state level
 *    - Each party's federal seats distributed across states by state list votes
 * 6. Second-Vote Coverage (Zweitstimmendeckung):
 *    - Rank direct candidates by first-vote percentage within each state
 *    - Only top candidates get seats, up to state allocation limit
 *    - Prevents overhang mandates
 * 7. Assign remaining seats to list candidates (excluding seated direct candidates)
 *
 * === REFERENCES ===
 * - Bundeswahlgesetz (BWG) in der Fassung vom 24.03.2023
 * - https://www.bundeswahlleiter.de/en/bundestagswahlen/2025.html
 */

async function calculateSeats(electionYear: number = 2025) {
    try {
        const seatAllocationQuery = `
WITH RECURSIVE

-- ============================================================
-- STEP 1: Winners for each constituency (first votes)
-- ============================================================
ConstituencyFirstVotes AS (
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
            ORDER BY dc.first_votes DESC, dc.person_id ASC
        ) AS rank
    FROM constituency_elections ce
    JOIN constituencies c ON ce.constituency_id = c.id
    JOIN direct_candidacy dc ON dc.constituency_id = c.id AND dc.year = ce.year
    WHERE ce.year = $1
),

ConstituencyWinners AS (
    SELECT
        constituency_id,
        year,
        person_id,
        party_id,
        first_votes,
        constituency_name,
        state_id
    FROM ConstituencyFirstVotes
    WHERE rank = 1
),

-- ============================================================
-- STEP 2: Total second votes per party (nationwide)
-- ============================================================
NationalSecondVotes AS (
    SELECT
        p.id AS party_id,
        p.short_name,
        p.is_minority,
        COALESCE(SUM(pl.vote_count), 0) AS total_second_votes
    FROM parties p
    LEFT JOIN party_lists pl ON pl.party_id = p.id AND pl.year = $1
    GROUP BY p.id, p.short_name, p.is_minority
),

TotalSecondVotes AS (
    SELECT SUM(total_second_votes) AS total FROM NationalSecondVotes
),

-- Number of constituency winners per party
ConstituencyWinnersPerParty AS (
    SELECT
        party_id,
        COUNT(*) AS num_winners
    FROM ConstituencyWinners
    GROUP BY party_id
),

-- ============================================================
-- STEP 3: Parties that pass the threshold
-- Criteria: Minority party OR >= 3 direct mandates OR >= 5% second votes
-- ============================================================
QualifiedParties AS (
    SELECT
        nsv.party_id,
        nsv.short_name,
        nsv.total_second_votes,
        COALESCE(cwp.num_winners, 0) AS num_direct_mandates,
        nsv.is_minority,
        (nsv.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) AS percent_second_votes,
        CASE
            WHEN nsv.is_minority THEN TRUE
            WHEN COALESCE(cwp.num_winners, 0) >= 3 THEN TRUE
            WHEN (nsv.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) >= 5 THEN TRUE
            ELSE FALSE
        END AS is_qualified
    FROM NationalSecondVotes nsv
    LEFT JOIN ConstituencyWinnersPerParty cwp ON cwp.party_id = nsv.party_id
),

-- ============================================================
-- STEP 4: Independent candidates and candidates from non-qualified parties
-- These get direct seats
-- ============================================================
DirectSeatsNonQualified AS (
    SELECT
        cw.person_id,
        cw.constituency_id,
        cw.constituency_name,
        cw.party_id,
        cw.first_votes,
        cw.state_id,
        p.short_name AS party_name,
        'Direct Mandate (Non-Qualified Party)' AS seat_type
    FROM ConstituencyWinners cw
    JOIN parties p ON p.id = cw.party_id
    JOIN QualifiedParties qp ON qp.party_id = cw.party_id
    WHERE qp.is_qualified = FALSE
),

NumDirectSeatsNonQualified AS (
    SELECT COUNT(*) AS count FROM DirectSeatsNonQualified
),

-- ============================================================
-- STEP 5: Federal Distribution (Oberverteilung) with Sainte-Laguë
-- 630 seats minus independent candidates/non-qualified parties
-- ============================================================
AvailableSeats AS (
    SELECT 630 - (SELECT count FROM NumDirectSeatsNonQualified) AS seats
),

-- Only qualified parties for federal distribution
QualifiedSecondVotes AS (
    SELECT
        party_id,
        short_name,
        total_second_votes
    FROM QualifiedParties
    WHERE is_qualified = TRUE AND total_second_votes > 0
),

-- Sainte-Laguë divisors (1, 3, 5, 7, ...)
Divisors AS (
    SELECT 1 AS divisor
    UNION ALL
    SELECT divisor + 2
    FROM Divisors
    WHERE divisor < 1260  -- Enough divisors for all possible seats (double for safety)
),

-- Highest quotients for federal distribution
FederalDistributionQuotients AS (
    SELECT
        qsv.party_id,
        qsv.short_name,
        qsv.total_second_votes,
        d.divisor,
        (qsv.total_second_votes * 1.0 / d.divisor) AS quotient
    FROM QualifiedSecondVotes qsv
    CROSS JOIN Divisors d
),

-- Allocate seats by highest quotient method
-- Tie-breaking: quotient DESC, total_second_votes DESC, party_id ASC
FederalDistributionRanked AS (
    SELECT
        party_id,
        short_name,
        quotient,
        total_second_votes,
        ROW_NUMBER() OVER (ORDER BY quotient DESC, total_second_votes DESC, party_id ASC) AS seat_number
    FROM FederalDistributionQuotients
),

FederalDistribution AS (
    SELECT
        party_id,
        short_name,
        COUNT(*) AS seats_national
    FROM FederalDistributionRanked
    WHERE seat_number <= (SELECT seats FROM AvailableSeats)
    GROUP BY party_id, short_name
),

-- ============================================================
-- STEP 6: State Distribution (Unterverteilung) - Seats per state per party
-- ============================================================
StateListSecondVotes AS (
    SELECT
        pl.party_id,
        pl.state_id,
        s.name AS state_name,
        p.short_name AS party_name,
        pl.vote_count AS state_second_votes
    FROM party_lists pl
    JOIN states s ON s.id = pl.state_id
    JOIN parties p ON p.id = pl.party_id
    WHERE pl.year = $1
    AND pl.party_id IN (SELECT party_id FROM FederalDistribution)
),

-- For each party: distribute seats to federal states
StateDistributionQuotients AS (
    SELECT
        slsv.party_id,
        slsv.party_name,
        slsv.state_id,
        slsv.state_name,
        slsv.state_second_votes,
        d.divisor,
        (slsv.state_second_votes * 1.0 / d.divisor) AS quotient,
        fd.seats_national
    FROM StateListSecondVotes slsv
    JOIN FederalDistribution fd ON fd.party_id = slsv.party_id
    CROSS JOIN Divisors d
),

StateDistributionRanked AS (
    SELECT
        party_id,
        party_name,
        state_id,
        state_name,
        state_second_votes,
        quotient,
        seats_national,
        ROW_NUMBER() OVER (
            PARTITION BY party_id
            ORDER BY quotient DESC, state_second_votes DESC, state_id ASC
        ) AS seat_number
    FROM StateDistributionQuotients
),

StateDistribution AS (
    SELECT
        party_id,
        party_name,
        state_id,
        state_name,
        COUNT(*) AS seats_state
    FROM StateDistributionRanked sdr
    WHERE seat_number <= seats_national
    GROUP BY party_id, party_name, state_id, state_name
),

-- ============================================================
-- STEP 7: Constituency winners from qualified parties
-- Ranked by first-vote percentage (for second-vote coverage / Zweitstimmendeckung)
-- ============================================================
QualifiedConstituencyWinners AS (
    SELECT
        cw.person_id,
        cw.constituency_id,
        cw.constituency_name,
        cw.party_id,
        cw.first_votes,
        cw.state_id,
        p.short_name AS party_name,
        -- Percentage of first votes in constituency
        (cw.first_votes * 100.0 / NULLIF(ce.valid_first, 0)) AS percent_first_votes
    FROM ConstituencyWinners cw
    JOIN parties p ON p.id = cw.party_id
    JOIN QualifiedParties qp ON qp.party_id = cw.party_id AND qp.is_qualified = TRUE
    JOIN constituency_elections ce ON ce.constituency_id = cw.constituency_id AND ce.year = $1
),

-- ============================================================
-- STEP 8: Second-Vote Coverage / Zweitstimmendeckung (2023 Reform)
-- ============================================================
-- This is the CORE of the 2023 reform that eliminates overhang mandates.
--
-- PROBLEM BEFORE REFORM:
-- If a party won 40 constituencies but only deserved 35 seats proportionally,
-- they kept all 40 (overhang mandates), and other parties got leveling seats.
-- This caused the Bundestag to grow from 598 to 736 seats by 2021.
--
-- SOLUTION AFTER REFORM:
-- 1. Each party gets a fixed number of seats per state (from state distribution)
-- 2. Direct candidates are ranked by first-vote percentage WITHIN each state
-- 3. Only the STRONGEST direct candidates get seats (up to the state limit)
-- 4. Weaker direct candidates LOSE their mandate despite winning their constituency
-- 5. Remaining seats filled by list candidates
--
-- EXAMPLE:
-- Party wins 10 constituencies in Bavaria but only gets 8 seats allocated
-- → Rank all 10 candidates by first-vote percentage in Bavaria
-- → Top 8 get direct mandates
-- → Bottom 2 lose despite winning (no seat!)
-- → No additional list seats since all 8 are filled
-- ============================================================

-- Rank direct candidates per party AND STATE by first-vote percentage
DirectMandatesRankedPerState AS (
    SELECT
        qcw.*,
        ROW_NUMBER() OVER (
            PARTITION BY qcw.party_id, qcw.state_id
            ORDER BY qcw.percent_first_votes DESC, qcw.first_votes DESC, qcw.person_id ASC
        ) AS rank_in_state
    FROM QualifiedConstituencyWinners qcw
),

-- Only direct candidates who actually get a seat
-- (up to the state distribution limit per state)
DirectMandatesWithSeat AS (
    SELECT
        dmr.person_id,
        dmr.constituency_id,
        dmr.constituency_name,
        dmr.party_id,
        dmr.first_votes,
        dmr.state_id,
        dmr.party_name,
        dmr.percent_first_votes,
        dmr.rank_in_state
    FROM DirectMandatesRankedPerState dmr
    JOIN StateDistribution sd ON sd.party_id = dmr.party_id AND sd.state_id = dmr.state_id
    WHERE dmr.rank_in_state <= sd.seats_state
),

-- Number of allocated direct mandates per party per state
DirectMandatesPerPartyState AS (
    SELECT
        party_id,
        state_id,
        COUNT(*) AS num_direct_mandates
    FROM DirectMandatesWithSeat
    GROUP BY party_id, state_id
),

-- ============================================================
-- STEP 9: Allocate list seats
-- Available list seats = State distribution - allocated direct mandates
-- ============================================================
ListSeatsPerPartyState AS (
    SELECT
        sd.party_id,
        sd.party_name,
        sd.state_id,
        sd.state_name,
        sd.seats_state,
        COALESCE(dmps.num_direct_mandates, 0) AS direct_mandates,
        GREATEST(0, sd.seats_state - COALESCE(dmps.num_direct_mandates, 0)) AS list_seats
    FROM StateDistribution sd
    LEFT JOIN DirectMandatesPerPartyState dmps
        ON dmps.party_id = sd.party_id AND dmps.state_id = sd.state_id
),

-- List candidates who get seats (sorted by list position)
-- Excluded: Candidates who already got a direct mandate WITH seat
ListCandidatesRanked AS (
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
        ) AS rank
    FROM party_list_candidacy plc
    JOIN party_lists pl ON pl.id = plc.party_list_id AND pl.year = $1
    JOIN parties p ON p.id = pl.party_id
    JOIN states s ON s.id = pl.state_id
    JOIN persons per ON per.id = plc.person_id
    -- Exclude candidates who already got a direct mandate WITH seat
    WHERE plc.person_id NOT IN (
        SELECT person_id FROM DirectMandatesWithSeat
    )
    AND pl.party_id IN (SELECT party_id FROM FederalDistribution)
),

ListSeatWinners AS (
    SELECT
        lcr.person_id,
        lcr.party_id,
        lcr.state_id,
        lcr.party_name,
        lcr.state_name,
        lcr.first_name,
        lcr.last_name,
        lcr.list_position,
        'List Seat' AS seat_type
    FROM ListCandidatesRanked lcr
    JOIN ListSeatsPerPartyState lspps
        ON lspps.party_id = lcr.party_id AND lspps.state_id = lcr.state_id
    WHERE lcr.rank <= lspps.list_seats
)

-- ============================================================
-- FINAL OUTPUT: All seat winners
-- ============================================================
SELECT
    person_id,
    party_id,
    party_name,
    state_id,
    constituency_name AS constituency,
    NULL AS list_position,
    'Direct Mandate' AS seat_type,
    percent_first_votes
FROM DirectMandatesWithSeat

UNION ALL

SELECT
    person_id,
    party_id,
    party_name,
    state_id,
    NULL AS constituency,
    list_position,
    seat_type,
    NULL AS percent_first_votes
FROM ListSeatWinners

UNION ALL

SELECT
    person_id,
    party_id,
    party_name,
    state_id,
    constituency_name AS constituency,
    NULL AS list_position,
    seat_type,
    NULL AS percent_first_votes
FROM DirectSeatsNonQualified

ORDER BY party_name, seat_type, constituency NULLS LAST, list_position NULLS LAST;
`;

        // Summary of seat distribution per party
        const summaryQuery = `
WITH RECURSIVE

-- Base CTEs (same as above, shortened for overview)
NationalSecondVotes AS (
    SELECT
        p.id AS party_id,
        p.short_name,
        p.is_minority,
        COALESCE(SUM(pl.vote_count), 0) AS total_second_votes
    FROM parties p
    LEFT JOIN party_lists pl ON pl.party_id = p.id AND pl.year = $1
    GROUP BY p.id, p.short_name, p.is_minority
),

TotalSecondVotes AS (
    SELECT SUM(total_second_votes) AS total FROM NationalSecondVotes
),

ConstituencyWinners AS (
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

ConstituencyWinnersPerParty AS (
    SELECT party_id, COUNT(*) AS count
    FROM ConstituencyWinners WHERE rank = 1
    GROUP BY party_id
),

QualifiedParties AS (
    SELECT
        nsv.party_id,
        nsv.short_name,
        nsv.total_second_votes,
        COALESCE(cwp.count, 0) AS direct_mandates,
        nsv.is_minority,
        (nsv.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) AS percent,
        CASE
            WHEN nsv.is_minority THEN TRUE
            WHEN COALESCE(cwp.count, 0) >= 3 THEN TRUE
            WHEN (nsv.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) >= 5 THEN TRUE
            ELSE FALSE
        END AS qualified
    FROM NationalSecondVotes nsv
    LEFT JOIN ConstituencyWinnersPerParty cwp ON cwp.party_id = nsv.party_id
)

SELECT
    short_name AS party,
    total_second_votes AS second_votes,
    ROUND(CAST(percent AS numeric), 2) AS percent_second_votes,
    direct_mandates,
    is_minority AS minority_party,
    qualified AS in_bundestag
FROM QualifiedParties
WHERE total_second_votes > 0
ORDER BY total_second_votes DESC;
`;

        // Federal Distribution (seats per party nationwide)
        const federalDistributionQuery = `
WITH RECURSIVE

NationalSecondVotes AS (
    SELECT
        p.id AS party_id,
        p.short_name,
        p.is_minority,
        COALESCE(SUM(pl.vote_count), 0) AS total_second_votes
    FROM parties p
    LEFT JOIN party_lists pl ON pl.party_id = p.id AND pl.year = $1
    GROUP BY p.id, p.short_name, p.is_minority
),

TotalSecondVotes AS (
    SELECT SUM(total_second_votes) AS total FROM NationalSecondVotes
),

ConstituencyWinners AS (
    SELECT dc.party_id, COUNT(*) AS count
    FROM direct_candidacy dc
    WHERE dc.year = $1
    AND dc.first_votes = (
        SELECT MAX(dc2.first_votes)
        FROM direct_candidacy dc2
        WHERE dc2.constituency_id = dc.constituency_id AND dc2.year = $1
    )
    GROUP BY dc.party_id
),

QualifiedParties AS (
    SELECT
        nsv.party_id,
        nsv.short_name,
        nsv.total_second_votes
    FROM NationalSecondVotes nsv
    LEFT JOIN ConstituencyWinners cw ON cw.party_id = nsv.party_id
    WHERE nsv.is_minority = TRUE
       OR COALESCE(cw.count, 0) >= 3
       OR (nsv.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) >= 5
),

Divisors AS (
    SELECT 1 AS divisor
    UNION ALL
    SELECT divisor + 2 FROM Divisors WHERE divisor < 1260
),

Quotients AS (
    SELECT
        qp.party_id,
        qp.short_name,
        qp.total_second_votes,
        d.divisor,
        (qp.total_second_votes * 1.0 / d.divisor) AS quotient
    FROM QualifiedParties qp
    CROSS JOIN Divisors d
    WHERE qp.total_second_votes > 0
),

RankedSeats AS (
    SELECT
        party_id,
        short_name,
        quotient,
        total_second_votes,
        ROW_NUMBER() OVER (ORDER BY quotient DESC, total_second_votes DESC, party_id ASC) AS rank
    FROM Quotients
)

SELECT
    short_name AS party,
    COUNT(*) AS seats
FROM RankedSeats
WHERE rank <= 630
GROUP BY party_id, short_name
ORDER BY seats DESC;
`;

        // State Distribution (seats per state per party)
        const stateDistributionQuery = `
WITH RECURSIVE

NationalSecondVotes AS (
    SELECT
        p.id AS party_id,
        p.short_name,
        p.is_minority,
        COALESCE(SUM(pl.vote_count), 0) AS total_second_votes
    FROM parties p
    LEFT JOIN party_lists pl ON pl.party_id = p.id AND pl.year = $1
    GROUP BY p.id, p.short_name, p.is_minority
),

TotalSecondVotes AS (
    SELECT SUM(total_second_votes) AS total FROM NationalSecondVotes
),

ConstituencyWinners AS (
    SELECT dc.party_id, COUNT(*) AS count
    FROM direct_candidacy dc
    WHERE dc.year = $1
    AND dc.first_votes = (
        SELECT MAX(dc2.first_votes)
        FROM direct_candidacy dc2
        WHERE dc2.constituency_id = dc.constituency_id AND dc2.year = $1
    )
    GROUP BY dc.party_id
),

QualifiedParties AS (
    SELECT nsv.party_id, nsv.short_name, nsv.total_second_votes
    FROM NationalSecondVotes nsv
    LEFT JOIN ConstituencyWinners cw ON cw.party_id = nsv.party_id
    WHERE nsv.is_minority = TRUE
       OR COALESCE(cw.count, 0) >= 3
       OR (nsv.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) >= 5
),

Divisors AS (
    SELECT 1 AS divisor
    UNION ALL
    SELECT divisor + 2 FROM Divisors WHERE divisor < 1260
),

-- Federal Distribution
FederalQuotients AS (
    SELECT
        qp.party_id, qp.short_name, qp.total_second_votes, d.divisor,
        (qp.total_second_votes * 1.0 / d.divisor) AS quotient
    FROM QualifiedParties qp
    CROSS JOIN Divisors d
    WHERE qp.total_second_votes > 0
),

FederalRanked AS (
    SELECT party_id, short_name, quotient, total_second_votes,
        ROW_NUMBER() OVER (ORDER BY quotient DESC, total_second_votes DESC, party_id ASC) AS rank
    FROM FederalQuotients
),

FederalDistribution AS (
    SELECT party_id, short_name, COUNT(*) AS seats_national
    FROM FederalRanked WHERE rank <= 630
    GROUP BY party_id, short_name
),

-- State Distribution
StateSecondVotes AS (
    SELECT pl.party_id, pl.state_id, s.name AS state_name, p.short_name, pl.vote_count
    FROM party_lists pl
    JOIN states s ON s.id = pl.state_id
    JOIN parties p ON p.id = pl.party_id
    WHERE pl.year = $1 AND pl.party_id IN (SELECT party_id FROM FederalDistribution)
),

StateQuotients AS (
    SELECT
        ssv.party_id, ssv.short_name, ssv.state_id, ssv.state_name, ssv.vote_count,
        d.divisor, (ssv.vote_count * 1.0 / d.divisor) AS quotient,
        fd.seats_national
    FROM StateSecondVotes ssv
    JOIN FederalDistribution fd ON fd.party_id = ssv.party_id
    CROSS JOIN Divisors d
),

StateRanked AS (
    SELECT
        party_id, short_name, state_id, state_name, quotient, vote_count, seats_national,
        ROW_NUMBER() OVER (PARTITION BY party_id ORDER BY quotient DESC, vote_count DESC, state_id ASC) AS rank
    FROM StateQuotients
)

SELECT
    short_name AS party,
    state_name AS state,
    COUNT(*) AS seats
FROM StateRanked
WHERE rank <= seats_national
GROUP BY party_id, short_name, state_id, state_name
ORDER BY short_name, seats DESC;
`;

        const seatAllocationRes = await pool.query(seatAllocationQuery, [electionYear]);
        const summaryRes = await pool.query(summaryQuery, [electionYear]);
        const federalRes = await pool.query(federalDistributionQuery, [electionYear]);
        const stateRes = await pool.query(stateDistributionQuery, [electionYear]);

        const results = {
            seatAllocation: seatAllocationRes.rows,
            summary: summaryRes.rows,
            federalDistribution: federalRes.rows,
            stateDistribution: stateRes.rows
        };

        return results;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

module.exports = calculateSeats;