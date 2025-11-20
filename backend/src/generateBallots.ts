import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

interface BallotGenerationOptions {
  constituencyNumber?: number; // Optional: Generate only for specific constituency
  skipVerification?: boolean; // Skip the verification step for speed
}

/**
 * Generates individual ballots from aggregated vote data using chunked SQL statements.
 * Processes constituencies in batches to provide progress feedback.
 */
async function generateBallots(options: BallotGenerationOptions = {}) {
  const { 
    constituencyNumber, 
    skipVerification = true 
  } = options;

  console.log('Starting ballot generation (Chunked SQL Mode)...\n');

  const startTime = Date.now();

  try {
    // Get list of constituencies to process
    const constituencies = constituencyNumber
      ? [constituencyNumber]
      : (await prisma.constituency.findMany({ 
          select: { number: true },
          orderBy: { number: 'asc' }
        })).map(c => c.number);

    console.log(`Processing ${constituencies.length} constituency/constituencies...\n`);

    // Skip cleanup if processing single constituency
    if (!constituencyNumber) {
      console.log('Preparing Ballot table (dropping and recreating)...');
      
      // Set statement timeout to avoid hanging forever
      await prisma.$executeRawUnsafe(`SET statement_timeout = '30s';`);
      
      // Kill any existing connections/transactions on the Ballot table
      await prisma.$executeRawUnsafe(`
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE pid <> pg_backend_pid() 
        AND datname = current_database()
        AND query ILIKE '%Ballot%';
      `);
      
      // Fastest approach: DROP and recreate the entire table
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "Ballot" CASCADE;`);
      // Use UNLOGGED for speed
      await prisma.$executeRawUnsafe(`
        CREATE UNLOGGED TABLE "Ballot" (
          "id" SERIAL PRIMARY KEY,
          "constituencyNum" INTEGER NOT NULL,
          "voterId" INTEGER NOT NULL,
          "firstVoteCandidateId" INTEGER,
          "secondVoteParty" TEXT,
          "isFirstVoteValid" BOOLEAN NOT NULL DEFAULT true,
          "isSecondVoteValid" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      // Reset timeout
      await prisma.$executeRawUnsafe(`SET statement_timeout = 0;`);
      
      console.log('Table ready (UNLOGGED mode)!\n');
    }

    console.log('\nGenerating ballots...\n');
    
    // Process in chunks for progress feedback
    const chunkSize = 5; // Smaller chunks per thread
    const concurrency = 4; // Parallel threads
    let totalProcessed = 0;

    // Helper to generate SQL for a chunk
    const generateChunkSql = (chunk: number[]) => {
      const whereClause = `WHERE const.number IN (${chunk.join(',')})`;
      return `
        INSERT INTO "Ballot" (
            "constituencyNum",
            "voterId",
            "firstVoteCandidateId",
            "secondVoteParty",
            "isFirstVoteValid",
            "isSecondVoteValid",
            "createdAt"
        )
        WITH constituency_data AS (
            SELECT 
                const.number as const_num,
                const."stateId" as state_id,
                c.id as candidate_id,
                c."firstVotes" as first_votes
            FROM "Constituency" const
            INNER JOIN "Candidate" c ON c."constituencyNum" = const.number
            ${whereClause}
        ),
        first_votes_expanded AS (
            SELECT 
                const_num,
                state_id,
                candidate_id,
                ROW_NUMBER() OVER (PARTITION BY const_num) as ballot_id
            FROM constituency_data
            CROSS JOIN LATERAL generate_series(1, FLOOR(COALESCE(first_votes, 0))::INTEGER)
            WHERE first_votes > 0
        ),
        constituency_vote_counts AS (
            SELECT 
                const_num,
                state_id,
                COUNT(*) as total_ballots
            FROM first_votes_expanded
            GROUP BY const_num, state_id
        ),
        second_votes_calculated AS (
            SELECT 
                cvc.const_num,
                sp."partyShortName",
                FLOOR((sp."secondVotes" / SUM(sp."secondVotes") OVER (PARTITION BY cvc.const_num)) * cvc.total_ballots)::INTEGER as vote_count
            FROM constituency_vote_counts cvc
            INNER JOIN "StateParty" sp ON sp."stateId" = cvc.state_id
        ),
        second_votes_expanded AS (
            SELECT 
                const_num,
                "partyShortName",
                ROW_NUMBER() OVER (PARTITION BY const_num) as ballot_id
            FROM second_votes_calculated
            CROSS JOIN LATERAL generate_series(1, vote_count)
            WHERE vote_count > 0
        )
        SELECT 
            fv.const_num,
            fv.ballot_id,
            fv.candidate_id,
            sv."partyShortName",
            true,
            (sv."partyShortName" IS NOT NULL),
            NOW()
        FROM first_votes_expanded fv
        LEFT JOIN second_votes_expanded sv 
            ON fv.const_num = sv.const_num 
            AND fv.ballot_id = sv.ballot_id
      `;
    };

    for (let i = 0; i < constituencies.length; i += chunkSize * concurrency) {
      const promises = [];
      
      for (let j = 0; j < concurrency; j++) {
        const startIdx = i + (j * chunkSize);
        if (startIdx < constituencies.length) {
          const chunk = constituencies.slice(startIdx, Math.min(startIdx + chunkSize, constituencies.length));
          promises.push(
            (async () => {
              const start = Date.now();
              await prisma.$executeRawUnsafe(generateChunkSql(chunk));
              return { count: chunk.length, duration: Date.now() - start };
            })()
          );
        }
      }

      const results = await Promise.all(promises);
      
      totalProcessed += results.reduce((acc, r) => acc + r.count, 0);
      const batchDuration = Math.max(...results.map(r => r.duration)); // Max duration of the batch
      
      const progress = ((totalProcessed / constituencies.length) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const eta = totalProcessed > 0 
        ? Math.round(((Date.now() - startTime) / totalProcessed) * (constituencies.length - totalProcessed) / 1000)
        : 0;
      
      console.log(`[${progress}%] Processed ${totalProcessed}/${constituencies.length} constituencies (Batch: ${(batchDuration/1000).toFixed(1)}s) | Elapsed: ${elapsed}s | ETA: ${eta}s`);
    }

    // Recreate indexes and constraints
    console.log('\nRecreating indexes and constraints on Ballot table...');
    await prisma.$executeRawUnsafe(`CREATE INDEX "Ballot_constituencyNum_idx" ON "Ballot"("constituencyNum");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX "Ballot_firstVoteCandidateId_idx" ON "Ballot"("firstVoteCandidateId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX "Ballot_secondVoteParty_idx" ON "Ballot"("secondVoteParty");`);
    
    // Add foreign key constraints back
    console.log('Adding foreign key constraints...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Ballot" 
      ADD CONSTRAINT "Ballot_constituencyNum_fkey" 
      FOREIGN KEY ("constituencyNum") REFERENCES "Constituency"("number") ON DELETE RESTRICT ON UPDATE CASCADE;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Ballot" 
      ADD CONSTRAINT "Ballot_firstVoteCandidateId_fkey" 
      FOREIGN KEY ("firstVoteCandidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Generation complete in ${totalDuration}s!`);

    if (!skipVerification && constituencyNumber) {
      console.log('\nVerifying results...');
      await verifyConstituency(constituencyNumber);
    }

  } catch (error) {
    console.error('Error generating ballots:', error);
    throw error;
  }
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

  let isValid = true;
  
  for (const candidate of candidates) {
    const ballotCount = ballotFirstVotes.find(
      (b) => b.firstVoteCandidateId === candidate.id
    )?._count || 0;
    const originalVotes = Math.floor(candidate.firstVotes || 0);
    const match = Math.abs(ballotCount - originalVotes) <= 1; // Allow off-by-one due to rounding
    
    if (!match) {
      isValid = false;
      console.log(
        `    ⚠ ${candidate.firstName} ${candidate.lastName}: Generated ${ballotCount}, Expected ${originalVotes}`
      );
    }
  }

  if (!isValid) {
    console.log(`    ⚠ Verification failed for constituency ${constituencyNum}`);
  } else {
    console.log(`    ✅ Verification passed for constituency ${constituencyNum}`);
  }
}

// Parse command line arguments and run
const args = process.argv.slice(2);
const constituencyArg = args.find(arg => arg.startsWith('--constituency='));
const constituencyNumber = constituencyArg ? parseInt(constituencyArg.split('=')[1]) : undefined;

generateBallots({ 
  constituencyNumber,
  skipVerification: true 
})
.catch(console.error)
.finally(() => prisma.$disconnect());
