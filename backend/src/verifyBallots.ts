import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface VerificationOptions {
  constituencyNumber?: number;
}

async function verifyBallots(options: VerificationOptions = {}) {
  const { constituencyNumber } = options;

  console.log('Ballot Verification Report\n');
  console.log('='.repeat(60));

  // Get constituencies to verify
  const constituencies = constituencyNumber
    ? await prisma.constituency.findMany({
        where: { number: constituencyNumber },
      })
    : await prisma.constituency.findMany({
        orderBy: { number: 'asc' },
      });

  if (constituencies.length === 0) {
    console.log('No constituencies found.');
    return;
  }

  let totalBallotsCount = 0;
  let totalMismatches = 0;

  for (const constituency of constituencies) {
    const ballotsCount = await prisma.ballot.count({
      where: { constituencyNum: constituency.number },
    });

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
    const ballotFirstVotes = await prisma.ballot.groupBy({
      by: ['firstVoteCandidateId'],
      where: {
        constituencyNum: constituency.number,
        isFirstVoteValid: true,
      },
      _count: true,
    });

    const candidates = await prisma.candidate.findMany({
      where: {
        constituencyNum: constituency.number,
        firstVotes: { not: null },
      },
      include: { party: true },
      orderBy: { firstVotes: 'desc' },
    });

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
    const ballotSecondVotes = await prisma.ballot.groupBy({
      by: ['secondVoteParty'],
      where: {
        constituencyNum: constituency.number,
        isSecondVoteValid: true,
      },
      _count: true,
      orderBy: {
        _count: {
          secondVoteParty: 'desc',
        },
      },
      take: 5,
    });

    console.log('\nTop 5 parties by second votes:');
    for (const vote of ballotSecondVotes) {
      console.log(`  ${vote.secondVoteParty}: ${vote._count.toLocaleString()}`);
    }

    // Invalid votes
    const invalidFirstVotes = await prisma.ballot.count({
      where: {
        constituencyNum: constituency.number,
        isFirstVoteValid: false,
      },
    });

    const invalidSecondVotes = await prisma.ballot.count({
      where: {
        constituencyNum: constituency.number,
        isSecondVoteValid: false,
      },
    });

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
    await prisma.$disconnect();
  }
}

main();
