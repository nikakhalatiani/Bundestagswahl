import dbModule from './db';
import type {
    CalculateSeatsResult,
    FederalDistributionRow,
    PartySummaryRow,
    SeatAllocationRow,
    StateDistributionRow,
} from './types/seats';

const { pool } = dbModule;

/**
 * Seat allocation for the German federal election
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
 * 2. ABOLITION OF OVERHANG MANDATES:
 *    - OLD: If a party won more constituencies than proportional seats, they kept all
 *    - NEW: Second-vote coverage - only the strongest direct
 *      candidates (by first-vote percentage) get seats, up to the party's proportional share
 *    - Weaker direct candidates lose their mandate if party exceeds proportional allocation
 *
 * 3. ABOLITION OF LEVELING SEATS:
 *    - OLD: Other parties received additional seats to maintain proportionality
 *    - NEW: Not needed since overhang mandates are eliminated
 *
 * 4. TWO-TIER PROPORTIONAL ALLOCATION:
 *    - Federal level: 630 seats allocated by Sainte-Laguë
 *    - State level: Each party's seats distributed across states by Sainte-Laguë
 *
 * 5. TIE-BREAKING RULES:
 *    - Primary: Highest quotient (votes / divisor)
 *    - Secondary: Most votes (federal or state level)
 *    - Tertiary: Lower party_id or state_id (deterministic)
 *
 * === ALGORITHM STEPS ===
 *
 * 1. Find winner for each constituency (first votes)
 * 2. Filter parties by 5% threshold, 3 direct mandates, or minority status
 * 3. Independent candidates and candidates from non-qualified parties get seats directly
 * 4. Federal distribution: Sainte-Laguë at federal level
 *    - Allocate 630 seats minus non-qualified party seats
 *    - Only qualified parties participate
 * 5. State distribution: Sainte-Laguë per party at state level
 *    - Each party's federal seats distributed across states by state list votes
 * 6. Second-vote coverage:
 *    - Rank direct candidates by first-vote percentage within each state
 *    - Only top candidates get seats, up to state allocation limit
 *    - Prevents overhang mandates
 * 7. Assign remaining seats to list candidates (excluding seated direct candidates)
 *
 * === REFERENCES ===
 * - Federal Electoral Act (Bundeswahlgesetz, BWG) as amended 2023-03-24
 * - https://www.bundeswahlleiter.de/en/bundestagswahlen/2025.html
 */

async function calculateSeats(electionYear: number = 2025): Promise<CalculateSeatsResult> {
    try {
        const seatAllocationQuery = `
WITH RECURSIVE
DirectCandidacyVotes AS (
    SELECT
        person_id,
        year,
        constituency_id,
        party_id,
        first_votes
    FROM mv_direct_candidacy_votes
    WHERE year = $1
),
PartyListVotes AS (
    SELECT
        party_list_id,
        party_id,
        state_id,
        year,
        second_votes
    FROM mv_party_list_votes
    WHERE year = $1
),
ConstituencyStats AS (
    SELECT
        constituency_id,
        year,
        COALESCE(valid_first, 0) AS valid_first
    FROM mv_constituency_elections
    WHERE year = $1
),

-- ============================================================
-- STEP 1: Winners for each constituency (first votes)
-- ============================================================
ConstituencyFirstVotes AS (
    SELECT
        ce.constituency_id,
        ce.year,
        dcv.person_id,
        dcv.party_id,
        dcv.first_votes,
        c.name AS constituency_name,
        c.state_id,
        ROW_NUMBER() OVER (
            PARTITION BY ce.constituency_id, ce.year
            ORDER BY dcv.first_votes DESC, dcv.person_id ASC
        ) AS rank
    FROM constituency_elections ce
    JOIN constituencies c ON ce.constituency_id = c.id
    JOIN DirectCandidacyVotes dcv
      ON dcv.constituency_id = c.id
     AND dcv.year = ce.year
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
        COALESCE(SUM(plv.second_votes), 0) AS total_second_votes
    FROM parties p
    LEFT JOIN PartyListVotes plv ON plv.party_id = p.id
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

AvailableSeats AS (
    SELECT 630 - COALESCE((SELECT count FROM NumDirectSeatsNonQualified), 0) AS seats
),

-- ============================================================
-- STEP 5: Federal distribution (Sainte-Laguë)
-- ============================================================
QualifiedSecondVotes AS (
    SELECT
        party_id,
        short_name,
        total_second_votes
    FROM QualifiedParties
    WHERE is_qualified = TRUE AND total_second_votes > 0
),

Divisors AS (
    SELECT 1 AS divisor
    UNION ALL
    SELECT divisor + 2 FROM Divisors WHERE divisor < 1260
),

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

FederalDistributionRanked AS (
    SELECT
        party_id,
        short_name,
        quotient,
        total_second_votes,
        ROW_NUMBER() OVER (
            ORDER BY quotient DESC, total_second_votes DESC, party_id ASC
        ) AS seat_number
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
-- STEP 6: State distribution (Sainte-Laguë per party)
-- ============================================================
StateListSecondVotes AS (
    SELECT
        plv.party_id,
        plv.state_id,
        s.name AS state_name,
        p.short_name AS party_name,
        plv.second_votes AS state_second_votes
    FROM PartyListVotes plv
    JOIN states s ON s.id = plv.state_id
    JOIN parties p ON p.id = plv.party_id
    WHERE plv.party_id IN (SELECT party_id FROM FederalDistribution)
),

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
-- Ranked by first-vote percentage (for second-vote coverage)
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
        (cw.first_votes * 100.0 / NULLIF(cs.valid_first, 0)) AS percent_first_votes
    FROM ConstituencyWinners cw
    JOIN parties p ON p.id = cw.party_id
    JOIN QualifiedParties qp ON qp.party_id = cw.party_id AND qp.is_qualified = TRUE
    JOIN ConstituencyStats cs ON cs.constituency_id = cw.constituency_id AND cs.year = cw.year
),

-- ============================================================
-- STEP 8: Second-vote coverage (2023 reform)
-- ============================================================
DirectMandatesRankedPerState AS (
    SELECT
        qcw.*,
        ROW_NUMBER() OVER (
            PARTITION BY qcw.party_id, qcw.state_id
            ORDER BY qcw.percent_first_votes DESC, qcw.first_votes DESC, qcw.person_id ASC
        ) AS rank_in_state
    FROM QualifiedConstituencyWinners qcw
),

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

        const summaryQuery = `
WITH RECURSIVE
DirectCandidacyVotes AS (
    SELECT
        person_id,
        year,
        constituency_id,
        party_id,
        first_votes
    FROM mv_direct_candidacy_votes
    WHERE year = $1
),
PartyListVotes AS (
    SELECT
        party_list_id,
        party_id,
        state_id,
        year,
        second_votes
    FROM mv_party_list_votes
    WHERE year = $1
),
NationalSecondVotes AS (
    SELECT
        p.id AS party_id,
        p.short_name,
        p.is_minority,
        COALESCE(SUM(plv.second_votes), 0) AS total_second_votes
    FROM parties p
    LEFT JOIN PartyListVotes plv ON plv.party_id = p.id
    GROUP BY p.id, p.short_name, p.is_minority
),

TotalSecondVotes AS (
    SELECT SUM(total_second_votes) AS total FROM NationalSecondVotes
),

ConstituencyWinners AS (
    SELECT
        dcv.party_id,
        dcv.person_id,
        dcv.constituency_id,
        dcv.first_votes,
        ROW_NUMBER() OVER (
            PARTITION BY dcv.constituency_id
            ORDER BY dcv.first_votes DESC, dcv.person_id ASC
        ) AS rank
    FROM DirectCandidacyVotes dcv
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

        const federalDistributionQuery = `
WITH RECURSIVE
DirectCandidacyVotes AS (
    SELECT
        person_id,
        year,
        constituency_id,
        party_id,
        first_votes
    FROM mv_direct_candidacy_votes
    WHERE year = $1
),
PartyListVotes AS (
    SELECT
        party_list_id,
        party_id,
        state_id,
        year,
        second_votes
    FROM mv_party_list_votes
    WHERE year = $1
),
NationalSecondVotes AS (
    SELECT
        p.id AS party_id,
        p.short_name,
        p.is_minority,
        COALESCE(SUM(plv.second_votes), 0) AS total_second_votes
    FROM parties p
    LEFT JOIN PartyListVotes plv ON plv.party_id = p.id
    GROUP BY p.id, p.short_name, p.is_minority
),

TotalSecondVotes AS (
    SELECT SUM(total_second_votes) AS total FROM NationalSecondVotes
),

ConstituencyWinners AS (
    SELECT
        dcv.party_id,
        dcv.person_id,
        dcv.constituency_id,
        dcv.first_votes,
        ROW_NUMBER() OVER (
            PARTITION BY dcv.constituency_id
            ORDER BY dcv.first_votes DESC, dcv.person_id ASC
        ) AS rank
    FROM DirectCandidacyVotes dcv
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
        nsv.total_second_votes
    FROM NationalSecondVotes nsv
    LEFT JOIN ConstituencyWinnersPerParty cwp ON cwp.party_id = nsv.party_id
    WHERE nsv.is_minority = TRUE
       OR COALESCE(cwp.count, 0) >= 3
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

        const stateDistributionQuery = `
WITH RECURSIVE
DirectCandidacyVotes AS (
    SELECT
        person_id,
        year,
        constituency_id,
        party_id,
        first_votes
    FROM mv_direct_candidacy_votes
    WHERE year = $1
),
PartyListVotes AS (
    SELECT
        party_list_id,
        party_id,
        state_id,
        year,
        second_votes
    FROM mv_party_list_votes
    WHERE year = $1
),
NationalSecondVotes AS (
    SELECT
        p.id AS party_id,
        p.short_name,
        p.is_minority,
        COALESCE(SUM(plv.second_votes), 0) AS total_second_votes
    FROM parties p
    LEFT JOIN PartyListVotes plv ON plv.party_id = p.id
    GROUP BY p.id, p.short_name, p.is_minority
),

TotalSecondVotes AS (
    SELECT SUM(total_second_votes) AS total FROM NationalSecondVotes
),

ConstituencyWinners AS (
    SELECT
        dcv.party_id,
        dcv.person_id,
        dcv.constituency_id,
        dcv.first_votes,
        ROW_NUMBER() OVER (
            PARTITION BY dcv.constituency_id
            ORDER BY dcv.first_votes DESC, dcv.person_id ASC
        ) AS rank
    FROM DirectCandidacyVotes dcv
),

ConstituencyWinnersPerParty AS (
    SELECT party_id, COUNT(*) AS count
    FROM ConstituencyWinners WHERE rank = 1
    GROUP BY party_id
),

QualifiedParties AS (
    SELECT nsv.party_id, nsv.short_name, nsv.total_second_votes
    FROM NationalSecondVotes nsv
    LEFT JOIN ConstituencyWinnersPerParty cwp ON cwp.party_id = nsv.party_id
    WHERE nsv.is_minority = TRUE
       OR COALESCE(cwp.count, 0) >= 3
       OR (nsv.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) >= 5
),

Divisors AS (
    SELECT 1 AS divisor
    UNION ALL
    SELECT divisor + 2 FROM Divisors WHERE divisor < 1260
),

FederalQuotients AS (
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

FederalRanked AS (
    SELECT
        party_id,
        short_name,
        quotient,
        total_second_votes,
        ROW_NUMBER() OVER (ORDER BY quotient DESC, total_second_votes DESC, party_id ASC) AS rank
    FROM FederalQuotients
),

FederalDistribution AS (
    SELECT
        party_id,
        short_name,
        COUNT(*) AS seats_national
    FROM FederalRanked
    WHERE rank <= 630
    GROUP BY party_id, short_name
),

StateSecondVotes AS (
    SELECT
        plv.party_id,
        plv.state_id,
        s.name AS state_name,
        p.short_name,
        plv.second_votes
    FROM PartyListVotes plv
    JOIN states s ON s.id = plv.state_id
    JOIN parties p ON p.id = plv.party_id
    WHERE plv.party_id IN (SELECT party_id FROM FederalDistribution)
),

StateQuotients AS (
    SELECT
        ssv.party_id,
        ssv.short_name,
        ssv.state_id,
        ssv.state_name,
        ssv.second_votes,
        d.divisor,
        (ssv.second_votes * 1.0 / d.divisor) AS quotient,
        fd.seats_national
    FROM StateSecondVotes ssv
    JOIN FederalDistribution fd ON fd.party_id = ssv.party_id
    CROSS JOIN Divisors d
),

StateRanked AS (
    SELECT
        party_id,
        short_name,
        state_id,
        state_name,
        quotient,
        second_votes,
        seats_national,
        ROW_NUMBER() OVER (
            PARTITION BY party_id
            ORDER BY quotient DESC, second_votes DESC, state_id ASC
        ) AS rank
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

        const seatAllocationRes = await pool.query<SeatAllocationRow>(seatAllocationQuery, [electionYear]);
        const summaryRes = await pool.query<PartySummaryRow>(summaryQuery, [electionYear]);
        const federalRes = await pool.query<FederalDistributionRow>(federalDistributionQuery, [electionYear]);
        const stateRes = await pool.query<StateDistributionRow>(stateDistributionQuery, [electionYear]);

        return {
            seatAllocation: seatAllocationRes.rows,
            summary: summaryRes.rows,
            federalDistribution: federalRes.rows,
            stateDistribution: stateRes.rows,
        };
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

module.exports = calculateSeats;
