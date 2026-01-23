// Test and validate seat allocation results
//
// This script validates the seat allocation algorithm by checking:
// 1. Total number of seats equals 630 (or expected amount)
// 2. No duplicate person assignments
// 3. All parties meet qualification criteria
// 4. Federal and state distribution add up correctly
// 5. Direct mandates + list seats = total seats per party
// 6. List candidates who won direct mandates are excluded from list seats

import dbModule from './db';
const { pool } = dbModule;

import type { CalculateSeatsResult, FederalDistributionRow, PartySummaryRow, SeatAllocationRow, StateDistributionRow } from './types/seats';

const calculateSeatsFunc: (year?: number) => Promise<CalculateSeatsResult> = require('./calculateSeats');

interface ValidationResult {
  testName: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  details?: string;
}

class SeatAllocationTester {
  private year: number;
  private results: CalculateSeatsResult | null = null;
  private validationResults: ValidationResult[] = [];

  constructor(year: number) {
    this.year = year;
  }

  async loadResults() {
    console.log(`Loading seat allocation results for ${this.year}...`);
    this.results = await calculateSeatsFunc(this.year);
    console.log(`✓ Results loaded\n`);
  }

  addResult(testName: string, passed: boolean, expected?: unknown, actual?: unknown, details?: string) {
    this.validationResults.push({
      testName,
      passed,
      expected,
      actual,
      details
    });
  }

  async testTotalSeats() {
    if (!this.results) throw new Error('Results not loaded');
    const seatAllocation: SeatAllocationRow[] = this.results.seatAllocation || [];
    const totalSeats = seatAllocation.length;

    // Get number of constituencies to know expected total
    const constituenciesRes = await pool.query(
      `SELECT COUNT(*) as count FROM constituencies`
    );
    const numConstituencies = parseInt(constituenciesRes.rows[0].count);

    // German system should have exactly 630 seats (or more if overhang mandates exist)
    // But with 2023 reform, it should be exactly 630
    const expected = 630;
    const passed = totalSeats === expected;

    this.addResult(
      'Total Seats',
      passed,
      expected,
      totalSeats,
      passed ? 'Correct total' : `Expected ${expected} seats, got ${totalSeats}`
    );
  }

  async testNoDuplicatePersons() {
    if (!this.results) throw new Error('Results not loaded');
    const seatAllocation: SeatAllocationRow[] = this.results.seatAllocation || [];
    const personIds = seatAllocation.map((s) => s.person_id);
    const uniquePersonIds = new Set(personIds);

    const passed = personIds.length === uniquePersonIds.size;
    const duplicates = personIds.length - uniquePersonIds.size;

    this.addResult(
      'No Duplicate Persons',
      passed,
      personIds.length,
      uniquePersonIds.size,
      passed ? 'No duplicates found' : `Found ${duplicates} duplicate person assignments`
    );
  }

  async testQualifiedPartiesOnly() {
    if (!this.results) throw new Error('Results not loaded');
    const seatAllocation: SeatAllocationRow[] = this.results.seatAllocation || [];
    const partyIds = [...new Set(seatAllocation.map((s) => s.party_id))];

    // Check each party meets qualification criteria
    const qualCheckRes = await pool.query(`
      WITH RECURSIVE
      NationalSecondVotes AS (
          SELECT p.id AS party_id, p.short_name, p.is_minority,
                 COALESCE(SUM(pl.second_votes), 0) AS total_second_votes
          FROM parties p
          LEFT JOIN mv_02_party_list_votes pl ON pl.party_id = p.id AND pl.year = $1
          GROUP BY p.id, p.short_name, p.is_minority
      ),
      TotalSecondVotes AS (
          SELECT SUM(total_second_votes) AS total FROM NationalSecondVotes
      ),
      ConstituencyWinners AS (
          SELECT dc.party_id, COUNT(*) AS count
          FROM mv_00_direct_candidacy_votes dc
          WHERE dc.year = $1
          AND dc.first_votes = (
              SELECT MAX(dc2.first_votes)
              FROM mv_00_direct_candidacy_votes dc2
              WHERE dc2.constituency_id = dc.constituency_id AND dc2.year = $1
          )
          GROUP BY dc.party_id
      )
      SELECT
          bz.party_id,
          bz.short_name,
          bz.is_minority,
          COALESCE(wg.count, 0) AS direct_mandates,
          (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) AS percent,
          CASE
              WHEN bz.is_minority THEN TRUE
              WHEN COALESCE(wg.count, 0) >= 3 THEN TRUE
              WHEN (bz.total_second_votes * 100.0 / NULLIF((SELECT total FROM TotalSecondVotes), 0)) >= 5 THEN TRUE
              ELSE FALSE
          END AS qualified
      FROM NationalSecondVotes bz
      LEFT JOIN ConstituencyWinners wg ON wg.party_id = bz.party_id
      WHERE bz.party_id = ANY($2)
    `, [this.year, partyIds]);

    const unqualifiedParties = qualCheckRes.rows.filter((r: { qualified: boolean }) => !r.qualified);
    const passed = unqualifiedParties.length === 0;

    this.addResult(
      'Only Qualified Parties Have Seats',
      passed,
      0,
      unqualifiedParties.length,
      passed
        ? 'All parties meet qualification criteria'
        : `Unqualified parties with seats: ${unqualifiedParties.map((p: { short_name: string }) => p.short_name).join(', ')}`
    );
  }

  async testFederalDistributionMatchesTotal() {
    if (!this.results) throw new Error('Results not loaded');
    const federalDistribution: FederalDistributionRow[] = this.results.federalDistribution || [];
    const totalFromFederal = federalDistribution.reduce((sum, r) => sum + Number(r.seats), 0);

    const seatAllocation: SeatAllocationRow[] = this.results.seatAllocation || [];
    const totalSeats = seatAllocation.length;

    const passed = totalFromFederal === totalSeats;

    this.addResult(
      'Federal Distribution Matches Total',
      passed,
      totalSeats,
      totalFromFederal,
      passed
        ? 'Federal distribution matches total seats'
        : `Federal distribution total (${totalFromFederal}) does not match seat allocation (${totalSeats})`
    );
  }

  async testStateDistributionMatchesFederal() {
    if (!this.results) throw new Error('Results not loaded');
    const federalDistribution: FederalDistributionRow[] = this.results.federalDistribution || [];
    const stateDistribution: StateDistributionRow[] = this.results.stateDistribution || [];

    // Sum state distribution per party
    const stateByParty: Record<string, number> = {};
    for (const row of stateDistribution) {
      const party = row.party;
      stateByParty[party] = (stateByParty[party] || 0) + Number(row.seats);
    }

    // Compare with federal distribution
    const mismatches: string[] = [];
    for (const row of federalDistribution) {
      const party = row.party;
      const federalSeats = Number(row.seats);
      const stateSeats = stateByParty[party] || 0;

      if (federalSeats !== stateSeats) {
        mismatches.push(`${party}: Federal=${federalSeats}, State=${stateSeats}`);
      }
    }

    const passed = mismatches.length === 0;

    this.addResult(
      'State Distribution Matches Federal',
      passed,
      'All parties match',
      mismatches.length === 0 ? 'All match' : mismatches.join('; '),
      passed
        ? 'State distribution matches federal distribution for all parties'
        : `Mismatches found: ${mismatches.join('; ')}`
    );
  }

  async testSeatTypeBreakdown() {
    if (!this.results) throw new Error('Results not loaded');
    const seatAllocation: SeatAllocationRow[] = this.results.seatAllocation || [];

    // Count by party and seat type
    const partyBreakdown: Record<string, { direct: number; list: number; other: number }> = {};

    for (const seat of seatAllocation) {
      const party = seat.party_name || 'Unknown';
      if (!partyBreakdown[party]) {
        partyBreakdown[party] = { direct: 0, list: 0, other: 0 };
      }

      const typ = seat.seat_type || '';
      if (typ === 'Direct Mandate') {
        partyBreakdown[party].direct++;
      } else if (typ === 'List Seat') {
        partyBreakdown[party].list++;
      } else {
        partyBreakdown[party].other++;
      }
    }

    // Verify against federal distribution
    const federalDistribution: FederalDistributionRow[] = this.results.federalDistribution || [];
    const mismatches: string[] = [];

    for (const row of federalDistribution) {
      const party = row.party;
      const expectedTotal = Number(row.seats);
      const breakdown = partyBreakdown[party] || { direct: 0, list: 0, other: 0 };
      const actualTotal = breakdown.direct + breakdown.list + breakdown.other;

      if (expectedTotal !== actualTotal) {
        mismatches.push(
          `${party}: Expected=${expectedTotal}, Actual=${actualTotal} (D:${breakdown.direct} L:${breakdown.list} O:${breakdown.other})`
        );
      }
    }

    const passed = mismatches.length === 0;

    this.addResult(
      'Seat Type Breakdown Correct',
      passed,
      'All match',
      mismatches.length === 0 ? 'All match' : mismatches.join('; '),
      passed
        ? 'Direct + List seats equal total for all parties'
        : `Mismatches: ${mismatches.join('; ')}`
    );
  }

  async testDirectMandateWinnersExcludedFromLists() {
    if (!this.results) throw new Error('Results not loaded');
    const seatAllocation: SeatAllocationRow[] = this.results.seatAllocation || [];

    const directMandatePersons = new Set(
      seatAllocation
        .filter((s) => s.seat_type === 'Direct Mandate')
        .map((s) => Number(s.person_id))
    );

    const listSeatPersons = seatAllocation
      .filter((s) => s.seat_type === 'List Seat')
      .map((s) => Number(s.person_id));

    const overlaps = listSeatPersons.filter((pid: number) => directMandatePersons.has(pid));
    const passed = overlaps.length === 0;

    this.addResult(
      'Direct Mandate Winners Excluded From Lists',
      passed,
      0,
      overlaps.length,
      passed
        ? 'No person has both direct mandate and list seat'
        : `${overlaps.length} persons have both seat types (person IDs: ${overlaps.join(', ')})`
    );
  }

  async testSecondVoteCoverage() {
    // Test that no party gets more direct mandates in a state than their state allocation allows
    if (!this.results) throw new Error('Results not loaded');
    const seatAllocation: SeatAllocationRow[] = this.results.seatAllocation || [];
    const stateDistribution: StateDistributionRow[] = this.results.stateDistribution || [];

    // Build map of seats per party per state from State Distribution
    const stateSeatsMap: Record<string, number> = {};
    for (const row of stateDistribution) {
      const key = `${row.party}::${row.state}`;
      stateSeatsMap[key] = Number(row.seats);
    }

    // Count direct mandates per party per state
    const directByPartyState: Record<string, number> = {};
    for (const seat of seatAllocation) {
      if (seat.seat_type === 'Direct Mandate') {
        // Get state from constituency
        const stateRes = await pool.query(
          `SELECT s.name FROM constituencies c
           JOIN states s ON s.id = c.state_id
           WHERE c.name = $1`,
          [seat.constituency]
        );
        if (stateRes.rows.length > 0) {
          const state = stateRes.rows[0].name;
          const key = `${seat.party_name}::${state}`;
          directByPartyState[key] = (directByPartyState[key] || 0) + 1;
        }
      }
    }

    // Check if any party has more direct mandates than state distribution allows
    const violations: string[] = [];
    for (const [key, directCount] of Object.entries(directByPartyState)) {
      const [party, state] = key.split('::');
      const allowedSeats = stateSeatsMap[key] || 0;

      if (directCount > allowedSeats) {
        violations.push(`${party} in ${state}: ${directCount} direct mandates > ${allowedSeats} allowed`);
      }
    }

    const passed = violations.length === 0;

    this.addResult(
      'Second-vote coverage (2023 reform)',
      passed,
      'No violations',
      violations.length === 0 ? 'Compliant' : violations.join('; '),
      passed
        ? 'All parties respect state allocation limits per state'
        : `Violations found: ${violations.join('; ')}`
    );
  }

  async testSummaryDataConsistency() {
    if (!this.results) throw new Error('Results not loaded');
    const summary: PartySummaryRow[] = this.results.summary || [];
    const federalDistribution: FederalDistributionRow[] = this.results.federalDistribution || [];

    // Check that qualified parties in summary match those in federal distribution
    const qualifiedInSummary = summary.filter((s) => s.in_bundestag).map((s) => s.party);
    const partiesInFederal = federalDistribution.map((o) => o.party);

    const missingInFederal = qualifiedInSummary.filter((p: string) => !partiesInFederal.includes(p));
    const extraInFederal = partiesInFederal.filter((p: string) => !qualifiedInSummary.includes(p));

    const passed = missingInFederal.length === 0 && extraInFederal.length === 0;

    this.addResult(
      'Summary Data Consistency',
      passed,
      'Match',
      passed ? 'Match' : 'Mismatch',
      passed
        ? 'Qualified parties in summary match federal distribution'
        : `Missing in Federal: ${missingInFederal.join(', ')}; Extra in Federal: ${extraInFederal.join(', ')}`
    );
  }

  printResults() {
    console.log('\n' + '='.repeat(70));
    console.log('TEST RESULTS SUMMARY');
    console.log('='.repeat(70) + '\n');

    const passed = this.validationResults.filter(r => r.passed).length;
    const failed = this.validationResults.filter(r => !r.passed).length;
    const total = this.validationResults.length;

    for (const result of this.validationResults) {
      const icon = result.passed ? '✓' : '✗';
      const status = result.passed ? 'PASS' : 'FAIL';
      console.log(`${icon} [${status}] ${result.testName}`);

      if (!result.passed) {
        if (result.expected !== undefined && result.actual !== undefined) {
          console.log(`    Expected: ${JSON.stringify(result.expected)}`);
          console.log(`    Actual:   ${JSON.stringify(result.actual)}`);
        }
        if (result.details) {
          console.log(`    Details:  ${result.details}`);
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log(`TOTAL: ${passed}/${total} tests passed (${failed} failed)`);
    console.log('='.repeat(70) + '\n');

    return failed === 0;
  }

  async runAllTests() {
    await this.loadResults();

    console.log('Running validation tests...\n');

    await this.testTotalSeats();
    await this.testNoDuplicatePersons();
    await this.testQualifiedPartiesOnly();
    await this.testFederalDistributionMatchesTotal();
    await this.testStateDistributionMatchesFederal();
    await this.testSeatTypeBreakdown();
    await this.testDirectMandateWinnersExcludedFromLists();
    await this.testSecondVoteCoverage();
    await this.testSummaryDataConsistency();

    return this.printResults();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const year = args[0] ? parseInt(args[0]) : 2025;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`SEAT ALLOCATION VALIDATION TEST SUITE`);
  console.log('='.repeat(70));
  console.log(`Year: ${year}`);
  console.log('='.repeat(70) + '\n');

  try {
    const tester = new SeatAllocationTester(year);
    const allPassed = await tester.runAllTests();

    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('Error running tests:', err);
    process.exit(1);
  }
}

main();
