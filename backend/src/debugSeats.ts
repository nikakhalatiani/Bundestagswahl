// Comprehensive debugging tool for seat allocation algorithm
//
// Usage:
//   npx ts-node src/debugSeats.ts              # Run all checks for 2025
//   npx ts-node src/debugSeats.ts 2021         # Run all checks for 2021
//   npx ts-node src/debugSeats.ts 2025 basic   # Run basic checks only
//   npx ts-node src/debugSeats.ts 2025 party SPD  # Check specific party
//
// Modes:
//   all    - Run all diagnostic checks (default)
//   basic  - Party votes, qualification, and winners
//   ober   - FederalDistribution (federal distribution)
//   unter  - StateDistribution (state distribution)
//   seats  - List seat allocation details
//   party  - Check specific party (requires party name)

import dbModule from './db';
const pool = (dbModule as any).pool || (dbModule as any).default?.pool;

const calculateSeatsFunc = require('./calculateSeats');

interface DebugOptions {
  year: number;
  mode: string;
  partyName?: string;
}

async function getPartyIdByName(partyName: string): Promise<number | null> {
  const result = await pool.query(
    `SELECT id FROM parties WHERE short_name ILIKE $1 OR long_name ILIKE $1 LIMIT 1`,
    [partyName]
  );
  return result.rows.length > 0 ? result.rows[0].id : null;
}

async function debugBasic(year: number) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`BASIC DIAGNOSTICS FOR ${year}`);
  console.log('='.repeat(60));

  // 1. List all parties with their vote counts
  console.log('\n--- All Parties with Second Votes (from party_lists) ---');
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
  console.log('\n--- Total Second Votes ---');
  console.log(`Total: ${totalRes.rows[0].total_second_votes}`);

  // 3. Check parties with >= 5% threshold
  console.log('\n--- Parties with >= 5% Second Votes ---');
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
      ROUND((pv.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalVotes), 0))::numeric, 2) AS percent
    FROM PartyVotes pv
    WHERE (pv.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalVotes), 0)) >= 5
    ORDER BY percent DESC;
  `, [year]);
  console.table(thresholdRes.rows);

  // 4. Check constituency winners
  console.log('\n--- Constituency Winners by Party ---');
  const winnersRes = await pool.query(`
    WITH ConstituencyWinners AS (
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
      COUNT(*) AS constituencies_won
    FROM ConstituencyWinners wg
    JOIN parties p ON p.id = wg.party_id
    WHERE wg.rank = 1
    GROUP BY p.id, p.short_name
    ORDER BY constituencies_won DESC;
  `, [year]);
  console.table(winnersRes.rows);

  // 5. Qualified parties
  console.log('\n--- Qualified Parties (Pass 5% OR 3 mandates OR minority) ---');
  const qualifiedRes = await pool.query(`
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
            bz.party_id,
            bz.short_name,
            bz.total_second_votes,
            bz.is_minority,
            COALESCE(wg.count, 0) AS direct_mandates,
            ROUND((bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0))::numeric, 2) AS percent
        FROM NationalSecondVotes bz
        LEFT JOIN ConstituencyWinners wg ON wg.party_id = bz.party_id
        WHERE bz.is_minority = TRUE
           OR COALESCE(wg.count, 0) >= 3
           OR (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) >= 5
    )
    SELECT * FROM QualifiedParties
    ORDER BY total_second_votes DESC;
  `, [year]);
  console.table(qualifiedRes.rows);
}

async function debugFederalDistribution(year: number) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`OBERVERTEILUNG (FEDERAL DISTRIBUTION) FOR ${year}`);
  console.log('='.repeat(60));

  const oberRes = await pool.query(`
    WITH RECURSIVE
    NationalSecondVotes AS (
        SELECT p.id AS party_id, p.short_name, p.is_minority,
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
        SELECT bz.party_id, bz.short_name, bz.total_second_votes
        FROM NationalSecondVotes bz
        LEFT JOIN ConstituencyWinners wg ON wg.party_id = bz.party_id
        WHERE bz.is_minority = TRUE
           OR COALESCE(wg.count, 0) >= 3
           OR (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) >= 5
    ),
    Divisors AS (
        SELECT 1 AS divisor
        UNION ALL
        SELECT divisor + 2 FROM Divisors WHERE divisor < 1260
    ),
    Quotients AS (
        SELECT qp.party_id, qp.short_name, qp.total_second_votes, d.divisor,
               (qp.total_second_votes * 1.0 / d.divisor) AS quotient
        FROM QualifiedParties qp
        CROSS JOIN Divisors d
        WHERE qp.total_second_votes > 0
    ),
    RankedSeats AS (
        SELECT party_id, short_name, quotient,
               ROW_NUMBER() OVER (ORDER BY quotient DESC) AS rank
        FROM Quotients
    )
    SELECT short_name, COUNT(*) AS seats_national
    FROM RankedSeats
    WHERE rank <= 630
    GROUP BY party_id, short_name
    ORDER BY seats_national DESC;
  `, [year]);

  console.log('\n--- Seats per Party (Sainte-Laguë Method) ---');
  console.table(oberRes.rows);

  const totalSeats = oberRes.rows.reduce((sum: number, row: any) => sum + parseInt(row.seats_national), 0);
  console.log(`\nTotal Federal Seats Allocated: ${totalSeats}`);
}

async function debugStateDistribution(year: number) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`UNTERVERTEILUNG (STATE DISTRIBUTION) FOR ${year}`);
  console.log('='.repeat(60));

  const unterRes = await pool.query(`
    WITH RECURSIVE
    NationalSecondVotes AS (
        SELECT p.id AS party_id, p.short_name, p.is_minority,
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
        SELECT bz.party_id, bz.short_name, bz.total_second_votes
        FROM NationalSecondVotes bz
        LEFT JOIN ConstituencyWinners wg ON wg.party_id = bz.party_id
        WHERE bz.is_minority = TRUE
           OR COALESCE(wg.count, 0) >= 3
           OR (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) >= 5
    ),
    Divisors AS (
        SELECT 1 AS divisor UNION ALL SELECT divisor + 2 FROM Divisors WHERE divisor < 1260
    ),
    Quotients AS (
        SELECT qp.party_id, qp.short_name, qp.total_second_votes, d.divisor,
               (qp.total_second_votes * 1.0 / d.divisor) AS quotient
        FROM QualifiedParties qp CROSS JOIN Divisors d
        WHERE qp.total_second_votes > 0
    ),
    RankedSeats AS (
        SELECT party_id, short_name, quotient,
               ROW_NUMBER() OVER (ORDER BY quotient DESC) AS rank
        FROM Quotients
    ),
    FederalDistribution AS (
        SELECT party_id, short_name, COUNT(*) AS seats_national
        FROM RankedSeats WHERE rank <= 630
        GROUP BY party_id, short_name
    ),
    StateSecondVotes AS (
        SELECT pl.party_id, pl.state_id, s.name AS state_name, p.short_name, pl.vote_count
        FROM party_lists pl
        JOIN states s ON s.id = pl.state_id
        JOIN parties p ON p.id = pl.party_id
        WHERE pl.year = $1 AND pl.party_id IN (SELECT party_id FROM FederalDistribution)
    ),
    StateQuotients AS (
        SELECT lz.party_id, lz.short_name, lz.state_id, lz.state_name, lz.vote_count,
               d.divisor, (lz.vote_count * 1.0 / d.divisor) AS quotient, o.seats_national
        FROM StateSecondVotes lz
        JOIN FederalDistribution o ON o.party_id = lz.party_id
        CROSS JOIN Divisors d
    ),
    StateRanked AS (
        SELECT party_id, short_name, state_id, state_name, quotient, seats_national,
               ROW_NUMBER() OVER (PARTITION BY party_id ORDER BY quotient DESC) AS rank
        FROM StateQuotients
    )
    SELECT short_name, state_name, COUNT(*) AS seats_state
    FROM StateRanked
    WHERE rank <= seats_national
    GROUP BY party_id, short_name, state_id, state_name
    ORDER BY short_name, seats_state DESC;
  `, [year]);

  console.log('\n--- Seats per Party per State ---');
  console.table(unterRes.rows);
}

async function debugListSeats(year: number) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`LIST SEAT ALLOCATION DETAILS FOR ${year}`);
  console.log('='.repeat(60));

  // Check party_list_candidacy entries
  console.log('\n--- Party List Candidacy Counts ---');
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

  // Available list seats calculation
  console.log('\n--- Available List Seats per Party (Total - Direct Mandates) ---');
  const results = await calculateSeatsFunc(year);
  const seatAllocation = results.seatAllocation || [];

  const partyCounts: Record<string, { direct: number; list: number; other: number }> = {};

  for (const row of seatAllocation) {
    const name = row.party_name || 'Unknown';
    if (!partyCounts[name]) {
      partyCounts[name] = { direct: 0, list: 0, other: 0 };
    }

    const type = row.seat_type || '';
    if (type === 'Direct Mandate') {
      partyCounts[name].direct++;
    } else if (type === 'List Seat') {
      partyCounts[name].list++;
    } else {
      partyCounts[name].other++;
    }
  }

  const summary = Object.entries(partyCounts).map(([party, counts]) => ({
    party,
    direct_mandates: counts.direct,
    list_seats: counts.list,
    other: counts.other,
    total: counts.direct + counts.list + counts.other
  })).sort((a, b) => b.total - a.total);

  console.table(summary);
  console.log(`\nTotal Seats Allocated: ${seatAllocation.length}`);
}

async function debugParty(year: number, partyName: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`DETAILED ANALYSIS FOR ${partyName.toUpperCase()} (${year})`);
  console.log('='.repeat(60));

  // Search for party
  console.log('\n--- Party Search Results ---');
  const partySearchRes = await pool.query(`
    SELECT id, short_name, long_name, is_minority
    FROM parties
    WHERE short_name ILIKE $1 OR long_name ILIKE $1
    LIMIT 5;
  `, [`%${partyName}%`]);

  if (partySearchRes.rows.length === 0) {
    console.log(`No party found matching "${partyName}"`);
    return;
  }

  console.table(partySearchRes.rows);
  const partyId = partySearchRes.rows[0].id;
  const partyShortName = partySearchRes.rows[0].short_name;

  // Party votes
  console.log(`\n--- Second Votes for ${partyShortName} ---`);
  const votesRes = await pool.query(`
    SELECT s.name AS state, pl.vote_count
    FROM party_lists pl
    JOIN states s ON s.id = pl.state_id
    WHERE pl.party_id = $1 AND pl.year = $2
    ORDER BY pl.vote_count DESC;
  `, [partyId, year]);
  console.table(votesRes.rows);

  const totalVotes = votesRes.rows.reduce((sum: number, row: any) => sum + parseFloat(row.vote_count), 0);
  console.log(`Total Second Votes: ${totalVotes}`);

  // Direct mandates
  console.log(`\n--- Direct Mandates for ${partyShortName} ---`);
  const directRes = await pool.query(`
    WITH ConstituencyWinners AS (
        SELECT dc.party_id, dc.person_id, c.state_id, c.name AS constituency_name,
               dc.first_votes
        FROM direct_candidacy dc
        JOIN constituencies c ON c.id = dc.constituency_id
        WHERE dc.year = $2
        AND dc.first_votes = (
            SELECT MAX(dc2.first_votes)
            FROM direct_candidacy dc2
            WHERE dc2.constituency_id = dc.constituency_id AND dc2.year = $2
        )
    )
    SELECT s.name AS state_name, COUNT(*) AS direct_mandates
    FROM ConstituencyWinners wg
    JOIN states s ON s.id = wg.state_id
    WHERE wg.party_id = $1
    GROUP BY wg.state_id, s.name
    ORDER BY direct_mandates DESC;
  `, [partyId, year]);
  console.table(directRes.rows);

  // List candidates
  console.log(`\n--- List Candidates for ${partyShortName} (first 10) ---`);
  const listCandRes = await pool.query(`
    SELECT s.name AS state, plc.list_position, per.first_name, per.last_name
    FROM party_list_candidacy plc
    JOIN party_lists pl ON pl.id = plc.party_list_id
    JOIN states s ON s.id = pl.state_id
    JOIN persons per ON per.id = plc.person_id
    WHERE pl.year = $2 AND pl.party_id = $1
    ORDER BY s.name, plc.list_position
    LIMIT 10;
  `, [partyId, year]);
  console.table(listCandRes.rows);

  // Final seat allocation
  console.log(`\n--- Final Seat Allocation for ${partyShortName} ---`);
  const results = await calculateSeatsFunc(year);
  const partySeats = (results.seatAllocation || []).filter(
    (r: any) => r.party_id === partyId
  );

  const seatsByType = {
    DirectMandate: 0,
    ListSeat: 0,
    Other: 0
  };

  partySeats.forEach((seat: any) => {
    const type = seat.seat_type || 'Other';
    if (type === 'Direct Mandate') seatsByType.DirectMandate++;
    else if (type === 'List Seat') seatsByType.ListSeat++;
    else seatsByType.Other++;
  });

  console.log(`Direct Mandates: ${seatsByType.DirectMandate}`);
  console.log(`List Seats: ${seatsByType.ListSeat}`);
  console.log(`Other: ${seatsByType.Other}`);
  console.log(`Total Seats: ${partySeats.length}`);
}

async function main() {
  const args = process.argv.slice(2);
  const year = args[0] ? parseInt(args[0]) : 2025;
  const mode = args[1] || 'all';
  const partyName = args[2];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`BUNDESTAGSWAHL SEAT ALLOCATION DEBUG TOOL`);
  console.log('='.repeat(60));
  console.log(`Year: ${year}`);
  console.log(`Mode: ${mode}`);
  if (partyName) console.log(`Party: ${partyName}`);
  console.log('='.repeat(60));

  try {
    switch (mode.toLowerCase()) {
      case 'basic':
        await debugBasic(year);
        break;
      case 'ober':
        await debugFederalDistribution(year);
        break;
      case 'unter':
        await debugStateDistribution(year);
        break;
      case 'seats':
        await debugListSeats(year);
        break;
      case 'party':
        if (!partyName) {
          console.error('\nError: Party name required for party mode');
          console.log('Usage: npx ts-node src/debugSeats.ts 2025 party SPD');
          process.exit(1);
        }
        await debugParty(year, partyName);
        break;
      case 'all':
      default:
        await debugBasic(year);
        await debugFederalDistribution(year);
        await debugStateDistribution(year);
        await debugListSeats(year);
        break;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('DEBUG COMPLETE');
    console.log('='.repeat(60) + '\n');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
