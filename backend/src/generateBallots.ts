import dbModule from "./db";
const { pool, disconnect } = dbModule;

interface BallotGenerationOptions {
  constituencyNumber?: number; // Optional: limit generation to one constituency
  batchSize?: number; // Number of ballots inserted per DB batch
}

async function insertBallotsBatch(batch: any[]) {
  // Inserts a batch of ballots in one SQL statement (very fast)
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const placeholders = batch
      .map(
        (_, i) =>
          `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`
      )
      .join(",");

    const values = batch.flatMap((b) => [
      b.constituencyNum,
      b.voterId,
      b.firstVoteCandidateId,
      b.secondVoteParty,
      b.isFirstVoteValid,
      b.isSecondVoteValid,
    ]);

    await client.query(
      `INSERT INTO ballots
       (constituency_num, voter_id, first_vote_candidate_id, second_vote_party, 
        is_first_vote_valid, is_second_vote_valid)
       VALUES ${placeholders}`,
      values
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("⚠ Batch insert failed:", err);
  } finally {
    client.release();
  }
}

/**
 * Generates individual ballots that statistically reflect aggregated results.
 * Uses batched inserts for speed.
 */
async function generateBallots(options: BallotGenerationOptions = {}) {
  const { constituencyNumber, batchSize = 5000 } = options;

  console.log("Starting ballot generation...\n");

  const constituenciesRes = constituencyNumber
    ? await pool.query("SELECT * FROM constituencies WHERE number = $1", [
        constituencyNumber,
      ])
    : await pool.query("SELECT * FROM constituencies ORDER BY number ASC");

  const constituencies = constituenciesRes.rows;

  if (constituencies.length === 0) {
    console.log("No constituencies found — exiting.");
    return;
  }

  console.log(`Processing ${constituencies.length} constituency/constituencies...\n`);

  let totalBallotsGenerated = 0;

  for (const constituency of constituencies) {
    console.log(`\n--- Constituency ${constituency.number}: ${constituency.name} ---`);

    await pool.query("DELETE FROM ballots WHERE constituency_num = $1", [
      constituency.number,
    ]);

    const candidatesRes = await pool.query(
      `SELECT c.*, p.short_name AS party_short_name
       FROM candidates c
       LEFT JOIN parties p ON p.short_name = c.party_short_name
       WHERE c.constituency_num = $1 AND c.first_votes IS NOT NULL
       ORDER BY c.id ASC`,
      [constituency.number]
    );
    const candidates = candidatesRes.rows;

    if (candidates.length === 0) {
      console.log("No candidates with first votes found.");
      continue;
    }

    // --- Compute distributions ---
    const totalFirstVotes = candidates.reduce(
      (sum, c) => sum + (Number(c.first_votes) || 0),
      0
    );
    console.log(`Total first votes to generate: ${totalFirstVotes.toLocaleString()}`);

    const statePartiesRes = await pool.query(
      `SELECT sp.*, p.short_name AS party_short_name
       FROM state_parties sp
       LEFT JOIN parties p ON p.short_name = sp.party_short_name
       WHERE sp.state_id = $1`,
      [constituency.state_id || constituency.stateId]
    );
    const stateParties = statePartiesRes.rows;
    const totalSecondVotesInState = stateParties.reduce(
      (sum, sp) => sum + (Number(sp.second_votes) || 0),
      0
    );

    const targetBallotCount = Math.floor(totalFirstVotes);
    console.log(`Target ballot count: ${targetBallotCount.toLocaleString()}`);

    // Build weighted arrays for randomization
    const firstVoteDistribution: Array<{ candidateId: number; party: string | null }> =
      [];
    candidates.forEach((c) => {
      const votes = Math.floor(c.first_votes || 0);
      for (let i = 0; i < votes; i++) {
        firstVoteDistribution.push({
          candidateId: c.id,
          party: c.party_short_name,
        });
      }
    });

    shuffleArray(firstVoteDistribution);

    const secondVoteDistribution: Array<string | null> = [];
    stateParties.forEach((sp) => {
      const proportion = sp.second_votes / totalSecondVotesInState;
      const votesForThisConstituency = Math.floor(
        proportion * targetBallotCount
      );
      for (let i = 0; i < votesForThisConstituency; i++) {
        secondVoteDistribution.push(sp.party_short_name);
      }
    });

    while (secondVoteDistribution.length < firstVoteDistribution.length) {
      secondVoteDistribution.push(null);
    }
    shuffleArray(secondVoteDistribution);

    // --- Ballot generation + batched insert ---
    const ballots: any[] = [];
    const maxBallots = Math.min(
      firstVoteDistribution.length,
      targetBallotCount
    );

    for (let i = 0; i < maxBallots; i++) {
      const firstVote = firstVoteDistribution[i];
      const secondVoteParty = secondVoteDistribution[i] || null;

      ballots.push({
        constituencyNum: constituency.number,
        voterId: i + 1,
        firstVoteCandidateId: firstVote.candidateId,
        secondVoteParty,
        isFirstVoteValid: true,
        isSecondVoteValid: secondVoteParty !== null,
      });

      if (ballots.length >= batchSize) {
        await insertBallotsBatch(ballots);
        totalBallotsGenerated += ballots.length;
        ballots.length = 0;
        process.stdout.write(
          `\r  Inserted ${totalBallotsGenerated.toLocaleString()} ballots`
        );
      }
    }

    if (ballots.length > 0) {
      await insertBallotsBatch(ballots);
      totalBallotsGenerated += ballots.length;
    }

    console.log(
      `\n  ✓ Generated ${maxBallots.toLocaleString()} ballots for constituency ${constituency.number}`
    );

    await verifyConstituency(constituency.number);
  }

  console.log(`\n\n✅ Total ballots generated: ${totalBallotsGenerated.toLocaleString()}`);
}

// --- Helpers -----------------------------

async function verifyConstituency(constituencyNum: number) {
  const ballotFirstVotesRes = await pool.query(
    `SELECT first_vote_candidate_id, COUNT(*)::int AS cnt
     FROM ballots
     WHERE constituency_num = $1 AND is_first_vote_valid = true
     GROUP BY first_vote_candidate_id`,
    [constituencyNum]
  );
  const ballotFirstVotes = ballotFirstVotesRes.rows;

  const candidatesRes = await pool.query(
    `SELECT id, first_name, last_name, first_votes
     FROM candidates
     WHERE constituency_num = $1 AND first_votes IS NOT NULL`,
    [constituencyNum]
  );
  const candidates = candidatesRes.rows;

  let valid = true;
  for (const c of candidates) {
    const ballotsCount =
      ballotFirstVotes.find((b) => b.first_vote_candidate_id === c.id)?.cnt ||
      0;
    const expected = Math.floor(c.first_votes || 0);
    if (ballotsCount !== expected) {
      valid = false;
      console.log(
        `    ⚠ ${c.first_name} ${c.last_name}: Generated ${ballotsCount}, Expected ${expected}`
      );
    }
  }
  if (valid) {
    console.log("    ✓ First vote counts verified");
  }
}

// Fisher–Yates shuffle
function shuffleArray<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// --- Entry Point -------------------------

async function main() {
  const args = process.argv.slice(2);
  const constituencyArg = args.find((a) => a.startsWith("--constituency="));
  const options: BallotGenerationOptions = {};

  if (constituencyArg) {
    const num = parseInt(constituencyArg.split("=")[1]);
    if (!isNaN(num)) {
      options.constituencyNumber = num;
      console.log(`Generating ballots only for constituency ${num}`);
    }
  }

  try {
    await generateBallots(options);
  } catch (err) {
    console.error("Error generating ballots:", err);
  } finally {
    await disconnect();
  }
}

main();