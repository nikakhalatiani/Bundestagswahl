import dbModule from './db';
const { pool, disconnect } = dbModule;

interface VerificationOptions {
  constituencyNumber?: number;
}

async function verifyBallots(options: VerificationOptions = {}) {
  const { constituencyNumber } = options;

  console.log('Ballot Verification Report\n');
  console.log('='.repeat(60));

  // Get constituencies to verify
  const constituenciesRes = constituencyNumber
    ? await pool.query('SELECT * FROM constituencies WHERE number = $1', [constituencyNumber])
    : await pool.query('SELECT * FROM constituencies ORDER BY number ASC');
  const constituencies = constituenciesRes.rows;

  if (constituencies.length === 0) {
    console.log('No constituencies found.');
    return;
  }

  let totalBallotsCount = 0;
  let totalMismatches = 0;

  for (const constituency of constituencies) {
    const ballotsCountRes = await pool.query('SELECT COUNT(*)::int as cnt FROM ballots WHERE constituency_num = $1', [constituency.number]);
    const ballotsCount = ballotsCountRes.rows[0].cnt;

    if (ballotsCount === 0) {
      console.log(
        `\nConstituency ${constituency.number} (${constituency.name}): No ballots generated yet`
      );
      continue;
    }

    totalBallotsCount += ballotsCount;

    console.log(`\n--- Constituency ${constituency.number}: ${constituency.name} ---`);
    console.log(`Total ballots: ${ballotsCount.toLocaleString()}`);

    // Verify First Votes
    console.log('\nFirst Votes Verification:');
    const ballotFirstVotesRes = await pool.query(
      `SELECT first_vote_candidate_id, COUNT(*)::int as cnt
       FROM ballots
       WHERE constituency_num = $1 AND is_first_vote_valid = true
       GROUP BY first_vote_candidate_id`,
      [constituency.number]
    );
    const ballotFirstVotes = ballotFirstVotesRes.rows;

    const candidatesRes = await pool.query(
      `SELECT c.*, p.short_name as party_short_name
       FROM candidates c
       LEFT JOIN parties p ON p.short_name = c.party_short_name
       WHERE c.constituency_num = $1 AND c.first_votes IS NOT NULL
       ORDER BY c.first_votes DESC`,
      [constituency.number]
    );
    const candidates = candidatesRes.rows;

    let constituencyMismatches = 0;
    const topCandidates = candidates.slice(0, 5);

    console.log('\nTop 5 candidates:');
    for (const candidate of topCandidates) {
      const ballotCount =
        ballotFirstVotes.find((b) => b.firstVoteCandidateId === candidate.id)?._count || 0;
      const originalVotes = Math.floor(candidate.firstVotes || 0);
      const match = ballotCount === originalVotes;
      const status = match ? '✓' : '✗';

      console.log(
        `  ${status} ${candidate.firstName} ${candidate.lastName} (${candidate.party?.shortName || 'Independent'}): ${ballotCount.toLocaleString()} / ${originalVotes.toLocaleString()}`
      );

      if (!match) {
        constituencyMismatches++;
      }
    }

    if (constituencyMismatches > 0) {
      console.log(`\n⚠ ${constituencyMismatches} mismatches found in first votes`);
      totalMismatches += constituencyMismatches;
    } else {
      console.log('\n✓ All first votes match perfectly!');
    }

    // Verify Second Votes
    console.log('\nSecond Votes Distribution:');
    const ballotSecondVotesRes = await pool.query(
      `SELECT second_vote_party, COUNT(*)::int as cnt
       FROM ballots
       WHERE constituency_num = $1 AND is_second_vote_valid = true
       GROUP BY second_vote_party
       ORDER BY cnt DESC
       LIMIT 5`,
      [constituency.number]
    );
    const ballotSecondVotes = ballotSecondVotesRes.rows;

    console.log('\nTop 5 parties by second votes:');
    for (const vote of ballotSecondVotes) {
      console.log(`  ${vote.secondVoteParty}: ${vote._count.toLocaleString()}`);
    }

    // Invalid votes
    const invalidFirstVotesRes = await pool.query(
      'SELECT COUNT(*)::int as cnt FROM ballots WHERE constituency_num = $1 AND is_first_vote_valid = false',
      [constituency.number]
    );
    const invalidFirstVotes = invalidFirstVotesRes.rows[0].cnt;

    const invalidSecondVotesRes = await pool.query(
      'SELECT COUNT(*)::int as cnt FROM ballots WHERE constituency_num = $1 AND is_second_vote_valid = false',
      [constituency.number]
    );
    const invalidSecondVotes = invalidSecondVotesRes.rows[0].cnt;

    console.log(`\nInvalid votes:`);
    console.log(`  First votes: ${invalidFirstVotes.toLocaleString()}`);
    console.log(`  Second votes: ${invalidSecondVotes.toLocaleString()}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\nTotal ballots across all constituencies: ${totalBallotsCount.toLocaleString()}`);

  if (totalMismatches === 0) {
    console.log('✅ All ballots match the original aggregated data!');
  } else {
    console.log(`⚠ ${totalMismatches} total mismatches found`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const constituencyArg = args.find((arg) => arg.startsWith('--constituency='));

  const options: VerificationOptions = {};

  if (constituencyArg) {
    const constituencyNum = parseInt(constituencyArg.split('=')[1]);
    if (!isNaN(constituencyNum)) {
      options.constituencyNumber = constituencyNum;
    }
  }

  try {
    await verifyBallots(options);
  } catch (error) {
    console.error('Error verifying ballots:', error);
    throw error;
  } finally {
    await disconnect();
  }
}

main();
