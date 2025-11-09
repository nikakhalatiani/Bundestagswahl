import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface BallotGenerationOptions {
  constituencyNumber?: number; // Optional: Generate only for specific constituency
  batchSize?: number; // Number of ballots to insert at once
}

/**
 * Generates individual ballots from aggregated vote data.
 * The generated ballots, when counted, will match the original aggregated results.
 */
async function generateBallots(options: BallotGenerationOptions = {}) {
  const { constituencyNumber, batchSize = 5000 } = options;

  console.log('Starting ballot generation...\n');

  // Get constituencies to process
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

  console.log(`Processing ${constituencies.length} constituency/constituencies...\n`);

  let totalBallotsGenerated = 0;

  for (const constituency of constituencies) {
    console.log(`\n--- Constituency ${constituency.number}: ${constituency.name} ---`);

    // Delete existing ballots for this constituency
    const deleted = await prisma.ballot.deleteMany({
      where: { constituencyNum: constituency.number },
    });
    console.log(`Deleted ${deleted.count} existing ballots`);

    // Get all candidates in this constituency with their first votes
    const candidates = await prisma.candidate.findMany({
      where: {
        constituencyNum: constituency.number,
        firstVotes: { not: null },
      },
      include: {
        party: true,
      },
      orderBy: { id: 'asc' },
    });

    if (candidates.length === 0) {
      console.log('No candidates with first votes found.');
      continue;
    }

    console.log(`Found ${candidates.length} candidates with first votes`);

    // Calculate total first votes
    const totalFirstVotes = candidates.reduce(
      (sum, c) => sum + (c.firstVotes || 0),
      0
    );
    console.log(`Total first votes to generate: ${totalFirstVotes}`);

    // Get second vote distribution for this constituency's state
    const stateParties = await prisma.stateParty.findMany({
      where: { stateId: constituency.stateId },
      include: { party: true },
    });

    // Calculate total second votes (using proportional distribution based on state totals)
    const totalSecondVotesInState = stateParties.reduce(
      (sum, sp) => sum + sp.secondVotes,
      0
    );

    // We'll generate approximately the same number of ballots as first votes
    // and distribute second votes proportionally
    const targetBallotCount = Math.floor(totalFirstVotes);
    console.log(`Target ballot count: ${targetBallotCount}`);

    // Create weighted arrays for sampling
    const firstVoteDistribution: Array<{ candidateId: number; party: string | null }> = [];
    candidates.forEach((candidate) => {
      const votes = Math.floor(candidate.firstVotes || 0);
      for (let i = 0; i < votes; i++) {
        firstVoteDistribution.push({
          candidateId: candidate.id,
          party: candidate.partyShortName,
        });
      }
    });

    // Shuffle the first vote distribution for randomization
    shuffleArray(firstVoteDistribution);

    // Create second vote distribution based on state-level results
    const secondVoteDistribution: Array<string | null> = [];
    stateParties.forEach((stateParty) => {
      const proportion = stateParty.secondVotes / totalSecondVotesInState;
      const votesForThisConstituency = Math.floor(proportion * targetBallotCount);
      
      for (let i = 0; i < votesForThisConstituency; i++) {
        secondVoteDistribution.push(stateParty.partyShortName);
      }
    });

    // Fill remaining ballots with null (invalid votes) if needed
    while (secondVoteDistribution.length < firstVoteDistribution.length) {
      secondVoteDistribution.push(null);
    }

    // Shuffle the second vote distribution
    shuffleArray(secondVoteDistribution);

    // Generate ballots in batches
    const ballots = [];
    const maxBallots = Math.min(firstVoteDistribution.length, targetBallotCount);

    for (let i = 0; i < maxBallots; i++) {
      const firstVote = firstVoteDistribution[i];
      const secondVoteParty = secondVoteDistribution[i] || null;

      ballots.push({
        constituencyNum: constituency.number,
        voterId: i + 1,
        firstVoteCandidateId: firstVote.candidateId,
        secondVoteParty: secondVoteParty,
        isFirstVoteValid: true,
        isSecondVoteValid: secondVoteParty !== null,
      });

      // Insert in batches
      if (ballots.length >= batchSize) {
        await prisma.ballot.createMany({
          data: ballots,
        });
        totalBallotsGenerated += ballots.length;
        ballots.length = 0; // Clear the array
        process.stdout.write(`\r  Generated ${totalBallotsGenerated} ballots...`);
      }
    }

    // Insert remaining ballots
    if (ballots.length > 0) {
      await prisma.ballot.createMany({
        data: ballots,
      });
      totalBallotsGenerated += ballots.length;
    }

    console.log(`\n  ✓ Generated ${maxBallots} ballots for constituency ${constituency.number}`);

    // Verify the results
    await verifyConstituency(constituency.number);
  }

  console.log(`\n\n✅ Total ballots generated: ${totalBallotsGenerated}`);
}

/**
 * Verifies that the generated ballots match the original aggregated data
 */
async function verifyConstituency(constituencyNum: number) {
  // Count first votes from ballots
  const ballotFirstVotes = await prisma.ballot.groupBy({
    by: ['firstVoteCandidateId'],
    where: {
      constituencyNum,
      isFirstVoteValid: true,
    },
    _count: true,
  });

  // Get original first votes
  const candidates = await prisma.candidate.findMany({
    where: {
      constituencyNum,
      firstVotes: { not: null },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      firstVotes: true,
    },
  });

  console.log('\n  Verification (First Votes):');
  let isValid = true;
  
  for (const candidate of candidates) {
    const ballotCount = ballotFirstVotes.find(
      (b) => b.firstVoteCandidateId === candidate.id
    )?._count || 0;
    const originalVotes = Math.floor(candidate.firstVotes || 0);
    const match = ballotCount === originalVotes;
    
    if (!match) {
      isValid = false;
      console.log(
        `    ⚠ ${candidate.firstName} ${candidate.lastName}: Generated ${ballotCount}, Expected ${originalVotes}`
      );
    }
  }

  if (isValid) {
    console.log('    ✓ All first votes match!');
  }
}

/**
 * Fisher-Yates shuffle algorithm
 */
function shuffleArray<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const constituencyArg = args.find((arg) => arg.startsWith('--constituency='));
  
  const options: BallotGenerationOptions = {};

  if (constituencyArg) {
    const constituencyNum = parseInt(constituencyArg.split('=')[1]);
    if (!isNaN(constituencyNum)) {
      options.constituencyNumber = constituencyNum;
      console.log(`Generating ballots only for constituency ${constituencyNum}\n`);
    }
  }

  try {
    await generateBallots(options);
  } catch (error) {
    console.error('Error generating ballots:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
