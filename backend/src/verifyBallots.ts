import dbModule from "./db";

const { pool, disconnect } = dbModule;

interface VerificationOptions {
  year?: number; // default 2025
  constituencyNumber?: number; // optional filter by constituency.number
  topN?: number; // how many to print per constituency
}

async function verifyBallots(options: VerificationOptions = {}) {
  const year = options.year ?? 2025;
  const topN = options.topN ?? 5;
  const { constituencyNumber } = options;

  console.log("Ballot Verification Report");
  console.log("=".repeat(60));
  console.log(`Year: ${year}\n`);

  // Constituencies to verify
  const constituenciesRes = constituencyNumber
    ? await pool.query("SELECT * FROM constituencies WHERE number = $1", [
        constituencyNumber,
      ])
    : await pool.query("SELECT * FROM constituencies ORDER BY number ASC");

  const constituencies = constituenciesRes.rows;

  if (constituencies.length === 0) {
    console.log("No constituencies found.");
    return;
  }

  // Global totals for the year
  const totalFirstRes = await pool.query(
    `
    SELECT COUNT(*)::bigint AS cnt
    FROM first_votes fv
    WHERE fv.year = $1
  `,
    [year]
  );

  const totalSecondRes = await pool.query(
    `
    SELECT COUNT(*)::bigint AS cnt
    FROM second_votes sv
    JOIN party_lists pl ON pl.id = sv.party_list_id
    WHERE pl.year = $1
  `,
    [year]
  );

  const invalidFirstRes = await pool.query(
    `
    SELECT COUNT(*)::bigint AS cnt
    FROM first_votes
    WHERE year = $1 AND is_valid = false
  `,
    [year]
  );

  const invalidSecondRes = await pool.query(
    `
    SELECT COUNT(*)::bigint AS cnt
    FROM second_votes sv
    JOIN party_lists pl ON pl.id = sv.party_list_id
    WHERE pl.year = $1 AND sv.is_valid = false
  `,
    [year]
  );

  console.log(
    `Total first votes (ballots): ${Number(
      totalFirstRes.rows[0].cnt
    ).toLocaleString()}`
  );
  console.log(
    `Total second votes (ballots): ${Number(
      totalSecondRes.rows[0].cnt
    ).toLocaleString()}`
  );
  console.log(
    `Invalid first votes: ${Number(
      invalidFirstRes.rows[0].cnt
    ).toLocaleString()}`
  );
  console.log(
    `Invalid second votes: ${Number(
      invalidSecondRes.rows[0].cnt
    ).toLocaleString()}`
  );
  console.log("=".repeat(60));

  let totalFirstVoteMismatches = 0;
  let totalSecondVoteMismatches = 0;

  // Precompute: second-vote ballot counts per party (year-filtered)
  // Compare against expected from party_lists (year-filtered)
  const secondBallotsByPartyRes = await pool.query(
    `
    SELECT pl.party_id, COUNT(*)::bigint AS cnt
    FROM second_votes sv
    JOIN party_lists pl ON pl.id = sv.party_list_id
    WHERE pl.year = $1
    GROUP BY pl.party_id
  `,
    [year]
  );

  const expectedSecondByPartyRes = await pool.query(
    `
    SELECT pl.party_id, SUM(pl.vote_count)::bigint AS expected
    FROM party_lists pl
    WHERE pl.year = $1
    GROUP BY pl.party_id
  `,
    [year]
  );

  const secondBallotsByParty = new Map<number, bigint>();
  for (const r of secondBallotsByPartyRes.rows) {
    secondBallotsByParty.set(Number(r.party_id), BigInt(r.cnt));
  }

  const expectedSecondByParty = new Map<number, bigint>();
  for (const r of expectedSecondByPartyRes.rows) {
    expectedSecondByParty.set(Number(r.party_id), BigInt(r.expected));
  }

  // Second-vote global party mismatches
  for (const [partyId, expected] of expectedSecondByParty.entries()) {
    const got = secondBallotsByParty.get(partyId) ?? 0n;
    if (got !== expected) totalSecondVoteMismatches++;
  }

  // Print top parties for second votes (global, year-filtered)
  const topSecondPartiesRes = await pool.query(
    `
    SELECT
      p.short_name,
      pl.party_id,
      SUM(pl.vote_count)::bigint AS expected
    FROM party_lists pl
    JOIN parties p ON p.id = pl.party_id
    WHERE pl.year = $1
    GROUP BY p.short_name, pl.party_id
    ORDER BY expected DESC
    LIMIT $2
  `,
    [year, topN]
  );

  console.log(`\nSecond Votes Verification (global, year=${year}):`);
  console.log(`Top ${topN} parties by expected second votes:`);
  for (const row of topSecondPartiesRes.rows) {
    const partyId = Number(row.party_id);
    const expected = BigInt(row.expected);
    const got = secondBallotsByParty.get(partyId) ?? 0n;
    const ok = got === expected;
    console.log(
      `  ${ok ? "✓" : "✗"} ${row.short_name}: ${Number(got).toLocaleString()} / ${Number(
        expected
      ).toLocaleString()}`
    );
  }

  // Per-constituency first-vote verification
  for (const constituency of constituencies) {
    console.log(
      `\n--- Constituency ${constituency.number}: ${constituency.name} ---`
    );

    // Total first votes for this constituency in this year
    const firstVotesCountRes = await pool.query(
      `
      SELECT COUNT(*)::bigint AS cnt
      FROM first_votes fv
      JOIN direct_candidacy dc
        ON dc.person_id = fv.direct_person_id
       AND dc.year = fv.year
      WHERE dc.constituency_id = $1
        AND fv.year = $2
    `,
      [constituency.id, year]
    );

    const firstVotesCount = BigInt(firstVotesCountRes.rows[0].cnt);

    // If no first votes in this constituency/year, skip detailed checks
    if (firstVotesCount === 0n) {
      console.log("No first-vote ballots for this constituency/year.");
      continue;
    }

    console.log(
      `Total first votes (ballots): ${Number(firstVotesCount).toLocaleString()}`
    );

    // Candidate expected votes for this constituency/year
    // (these are the aggregated counts to match)
    const candidatesRes = await pool.query(
      `
      SELECT
        dc.person_id,
        dc.first_votes::bigint AS expected,
        p.first_name,
        p.last_name,
        pr.short_name AS party_short_name
      FROM direct_candidacy dc
      JOIN persons p ON p.id = dc.person_id
      LEFT JOIN parties pr ON pr.id = dc.party_id
      WHERE dc.constituency_id = $1
        AND dc.year = $2
        AND dc.first_votes IS NOT NULL
        AND dc.first_votes::bigint > 0
      ORDER BY expected DESC
      LIMIT $3
    `,
      [constituency.id, year, topN]
    );

    // Ballots counted for those top candidates only (year + constituency filtered)
    // We do it in one query keyed by person_id so we don't get "0" just because of LIMIT mismatch.
    const ballotCountsRes = await pool.query(
      `
      WITH top_candidates AS (
        SELECT dc.person_id
        FROM direct_candidacy dc
        WHERE dc.constituency_id = $1
          AND dc.year = $2
          AND dc.first_votes IS NOT NULL
          AND dc.first_votes::bigint > 0
        ORDER BY dc.first_votes::bigint DESC
        LIMIT $3
      )
      SELECT
        fv.direct_person_id AS person_id,
        COUNT(*)::bigint AS cnt
      FROM first_votes fv
      JOIN direct_candidacy dc
        ON dc.person_id = fv.direct_person_id
       AND dc.year = fv.year
      JOIN top_candidates tc ON tc.person_id = fv.direct_person_id
      WHERE dc.constituency_id = $1
        AND fv.year = $2
      GROUP BY fv.direct_person_id
    `,
      [constituency.id, year, topN]
    );

    const ballotCounts = new Map<number, bigint>();
    for (const r of ballotCountsRes.rows) {
      ballotCounts.set(Number(r.person_id), BigInt(r.cnt));
    }

    console.log(`\nFirst Votes Verification (Top ${topN} candidates):`);
    let mismatchesHere = 0;

    for (const candidate of candidatesRes.rows) {
      const personId = Number(candidate.person_id);
      const expected = BigInt(candidate.expected);
      const got = ballotCounts.get(personId) ?? 0n;
      const ok = got === expected;
      if (!ok) mismatchesHere++;

      console.log(
        `  ${ok ? "✓" : "✗"} ${candidate.first_name} ${candidate.last_name} (${
          candidate.party_short_name || "Independent"
        }): ${Number(got).toLocaleString()} / ${Number(expected).toLocaleString()}`
      );
    }

    // Full mismatch count for this constituency/year (not limited to topN)
    const fullMismatchRes = await pool.query(
      `
      WITH expected AS (
        SELECT
          dc.person_id,
          dc.first_votes::bigint AS expected
        FROM direct_candidacy dc
        WHERE dc.constituency_id = $1
          AND dc.year = $2
          AND dc.first_votes IS NOT NULL
          AND dc.first_votes::bigint >= 0
      ),
      got AS (
        SELECT
          fv.direct_person_id AS person_id,
          COUNT(*)::bigint AS got
        FROM first_votes fv
        JOIN direct_candidacy dc
          ON dc.person_id = fv.direct_person_id
         AND dc.year = fv.year
        WHERE dc.constituency_id = $1
          AND fv.year = $2
        GROUP BY fv.direct_person_id
      )
      SELECT COUNT(*)::int AS mismatches
      FROM expected e
      LEFT JOIN got g ON g.person_id = e.person_id
      WHERE COALESCE(g.got, 0) <> e.expected;
    `,
      [constituency.id, year]
    );

    const mismatchesFull = Number(fullMismatchRes.rows[0].mismatches);

    if (mismatchesFull > 0) {
      totalFirstVoteMismatches += mismatchesFull;
      console.log(
        `\n⚠ ${mismatchesFull} total first-vote mismatches found in this constituency/year`
      );
    } else {
      console.log("\n✓ All first votes match perfectly in this constituency/year!");
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(
    `First-vote mismatches (total, year=${year}): ${totalFirstVoteMismatches.toLocaleString()}`
  );
  console.log(
    `Second-vote mismatches (total, year=${year}): ${totalSecondVoteMismatches.toLocaleString()}`
  );

  if (totalFirstVoteMismatches === 0 && totalSecondVoteMismatches === 0) {
    console.log("✅ All ballots match the original aggregated data!");
  } else {
    console.log("⚠ Some mismatches found (see above).");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const constituencyArg = args.find((arg) => arg.startsWith("--constituency="));
  const yearArg = args.find((arg) => arg.startsWith("--year="));
  const topArg = args.find((arg) => arg.startsWith("--top="));

  const options: VerificationOptions = {};

  if (constituencyArg) {
    const constituencyNum = parseInt(constituencyArg.split("=")[1], 10);
    if (!isNaN(constituencyNum)) options.constituencyNumber = constituencyNum;
  }

  if (yearArg) {
    const y = parseInt(yearArg.split("=")[1], 10);
    if (!isNaN(y)) options.year = y;
  }

  if (topArg) {
    const n = parseInt(topArg.split("=")[1], 10);
    if (!isNaN(n)) options.topN = n;
  }

  try {
    await verifyBallots(options);
  } catch (error) {
    console.error("Error verifying ballots:", error);
    throw error;
  } finally {
    await disconnect();
  }
}

main();