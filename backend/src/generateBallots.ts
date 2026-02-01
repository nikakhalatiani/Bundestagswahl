/**
 * Ballot Generator
 *
 * Generates individual ballot records (first_votes and second_votes) from
 * pre-aggregated election data in CSVs, ensuring that counts match exactly.
 *
 * USAGE:
 *
 * 1. Generate all ballots for all years (default):
 *    npx ts-node src/generateBallots.ts
 *
 * 2. Generate ballots for specific year only:
 *    npx ts-node src/generateBallots.ts --year=2025
 *
 * 3. Generate ballots for specific constituency (by NUMBER, not database ID):
 *    npx ts-node src/generateBallots.ts --year=2025 --constituency=63
 *
 * 4. Generate ballots for multiple constituencies (by NUMBER):
 *    npx ts-node src/generateBallots.ts --year=2025 --constituencies=56,57,58
 *
 * 5. Generate ballots for specific state(s):
 *    npx ts-node src/generateBallots.ts --year=2025 --state=1,5,9
 *
 * 6. Regenerate without dropping tables (keeps indexes/constraints):
 *    npx ts-node src/generateBallots.ts --year=2025 --constituency=9 --no-drop
 *
 * 7. Enable verification after generation:
 *    npx ts-node src/generateBallots.ts --verify
 *
 * 8. Use logged tables (slower, but safer):
 *    npx ts-node src/generateBallots.ts --logged
 *
 * OPTIONS:
 *   --year=YYYY              Filter by election year
 *   --constituency=N         Single constituency NUMBER (e.g., 63, not database ID)
 *   --constituencies=N,N,N   Multiple constituency NUMBERS (comma-separated)
 *   --state=N,N,N            State IDs (comma-separated)
 *   --no-drop                Keep indexes/constraints (slower inserts)
 *   --verify                 Run verification after generation
 *   --logged                 Create logged tables (default: unlogged for speed)
 */

import * as dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "..", "data");
const DATA_DIR_CANDIDATES = [
  process.env.DATA_DIR?.trim(),
  DEFAULT_DATA_DIR,
  path.join(process.cwd(), "data"),
  "/data",
].filter(Boolean) as string[];
const DATA_DIR = DATA_DIR_CANDIDATES.find((dir) => fs.existsSync(dir)) ?? DEFAULT_DATA_DIR;

if (!fs.existsSync(DATA_DIR)) {
  throw new Error(
    `Data directory not found. Set DATA_DIR or mount ./data (tried: ${DATA_DIR_CANDIDATES.join(", ")}).`
  );
}

type CsvRow = Record<string, string>;

interface GenerationOptions {
  useUnloggedTables?: boolean;
  dropAndRecreateTables?: boolean;
  skipVerification?: boolean;
  year?: number; // Filter by election year (default: all years)
  constituencyNumbers?: number[]; // Filter by constituency NUMBERS (56, 57, 58...) - USER-FACING
  stateIds?: number[]; // Filter by specific state IDs (default: all)
}

type ConstituencyMappingRow = { id: number; number: number; name: string; year: number; bridge_id: number };

type FirstVoteCount = {
  person_id: number;
  year: number;
  constituency_id: number;
  votes: number;
};

type SecondVoteCount = {
  constituency_id: number;
  year: number;
  party_id: number;
  votes: number;
};

type InvalidVoteCount = {
  constituency_id: number;
  year: number;
  votes: number;
};

function readCsv<T>(filePath: string): T[] {
  const csv = fs.readFileSync(filePath, "utf-8");
  return parse(csv, {
    columns: true,
    delimiter: ";",
    trim: true,
    skip_empty_lines: true,
    bom: true,
  });
}

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function toCount(value: string | number | null | undefined): number {
  const n = num(value);
  if (n === null) return 0;
  return Math.trunc(n);
}

const FAST_SESSION_SETTINGS = [
  "SET synchronous_commit = 'off'",
  "SET maintenance_work_mem = '1GB'",
  "SET max_parallel_workers_per_gather = 4",
];

async function applyFastSessionSettings(client: PoolClient) {
  for (const stmt of FAST_SESSION_SETTINGS) {
    await client.query(stmt);
  }
}

async function resetSessionSettings(client: PoolClient) {
  await client.query("RESET ALL");
}

async function main() {
  const args = process.argv.slice(2);
  const options: GenerationOptions = {
    useUnloggedTables: true,
    dropAndRecreateTables: true,
    skipVerification: true,
  };

  for (const arg of args) {
    if (arg.startsWith("--year=")) {
      options.year = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--constituency=")) {
      options.constituencyNumbers = arg.split("=")[1].split(",").map(Number);
    } else if (arg.startsWith("--constituencies=")) {
      options.constituencyNumbers = arg.split("=")[1].split(",").map(Number);
    } else if (arg.startsWith("--state=")) {
      options.stateIds = arg.split("=")[1].split(",").map(Number);
    } else if (arg === "--no-drop") {
      options.dropAndRecreateTables = false;
    } else if (arg === "--verify") {
      options.skipVerification = false;
    } else if (arg === "--logged") {
      options.useUnloggedTables = false;
    }
  }

  await generateBallots(options);
  await pool.end();
}

async function generateBallots(options: GenerationOptions) {
  const {
    useUnloggedTables = true,
    dropAndRecreateTables = true,
    skipVerification = true,
    year,
    constituencyNumbers,
    stateIds,
  } = options;

  let constituencyIds: number[] | undefined;
  if (constituencyNumbers && constituencyNumbers.length > 0) {
    let mappingQuery: string;
    let queryParams: Array<number | number[]>;

    if (year !== undefined) {
      mappingQuery = `
        SELECT ce.bridge_id, ce.year, c.id, c.number, c.name
        FROM constituency_elections ce
        JOIN constituencies c ON c.id = ce.constituency_id
        WHERE c.number = ANY($1) AND ce.year = $2
        ORDER BY c.number
      `;
      queryParams = [constituencyNumbers, year];
    } else {
      mappingQuery = `
        SELECT ce.bridge_id, ce.year, c.id, c.number, c.name
        FROM constituency_elections ce
        JOIN constituencies c ON c.id = ce.constituency_id
        WHERE c.number = ANY($1)
        ORDER BY c.number, ce.year
      `;
      queryParams = [constituencyNumbers];
    }

    const mappingRes = await pool.query<ConstituencyMappingRow>(mappingQuery, queryParams);

    if (mappingRes.rows.length === 0) {
      console.error(`Error: No constituencies found with numbers: ${constituencyNumbers.join(", ")}${year ? ` for year ${year}` : ""}`);
      console.error(`   Valid constituency numbers range from 1-299 (use the "Number" column, not the database ID)`);
      if (!year) {
        console.error(`   Tip: Specify --year=YYYY to avoid ambiguity with constituency numbers that changed between elections`);
      }
      process.exit(1);
    }

    if (mappingRes.rows.length < constituencyNumbers.length) {
      const foundNumbers = mappingRes.rows.map((r) => r.number);
      const missingNumbers = constituencyNumbers.filter((n) => !foundNumbers.includes(n));
      console.warn(`Warning: Some constituency numbers not found: ${missingNumbers.join(", ")}${year ? ` for year ${year}` : ""}`);
      console.warn(`   Will generate ballots for: ${foundNumbers.join(", ")}`);
    }

    const numberCounts = new Map<number, number>();
    for (const row of mappingRes.rows) {
      const count = numberCounts.get(row.number) || 0;
      numberCounts.set(row.number, count + 1);
    }
    const duplicates = Array.from(numberCounts.entries()).filter(([_, count]) => count > 1);

    if (duplicates.length > 0 && !year) {
      const dupNumbers = duplicates.map(([num]) => num);
      console.warn(`Warning: Constituency numbers ${dupNumbers.join(", ")} exist in multiple election years`);
      console.warn(`   Generating ballots for ALL matching constituencies. Specify --year=YYYY to disambiguate.`);
      mappingRes.rows.forEach((r) => {
        console.warn(`     - Constituency ${r.number}: "${r.name}" (year=${r.year}, id=${r.id}, bridge_id=${r.bridge_id})`);
      });
    }

    constituencyIds = mappingRes.rows.map((r) => r.id);
    console.log(`✓ Mapped constituency numbers ${constituencyNumbers.join(",")} → database IDs ${constituencyIds.join(",")}${year ? ` (year ${year})` : ""}`);
  }

  let filterDesc = "";
  if (year) filterDesc += ` year=${year}`;
  if (constituencyNumbers) filterDesc += ` constituencies=${constituencyNumbers.join(",")}`;
  if (stateIds) filterDesc += ` states=${stateIds.join(",")}`;

  console.log(`Starting ballot generation${filterDesc || " (all data)"}...`);
  const start = Date.now();

  console.log("Preparing database session settings for bulk inserts...");

  if (dropAndRecreateTables) {
    console.log("Preparing vote tables (preserving materialized views)...");
    await ensureVoteTablesExist();
    await prepareVoteTables(useUnloggedTables);
  } else {
    console.log("Truncating existing first_votes and second_votes...");
    await ensureVoteTablesExist();
    await pool.query("TRUNCATE TABLE first_votes, second_votes RESTART IDENTITY CASCADE;");
  }

  const constituencyStateMap = await loadConstituencyStateMap();

  const firstVoteCounts = loadFirstVoteCounts({ year, constituencyIds, stateIds, constituencyStateMap });
  const secondVoteCounts = loadSecondVoteCounts({ year, constituencyIds, stateIds, constituencyStateMap });
  const invalidCounts = loadInvalidVoteCounts({ year, constituencyIds, stateIds, constituencyStateMap });

  console.log("\nGenerating first_votes and second_votes (parallel)...");
  const startVotes = Date.now();

  await Promise.all([
    insertFirstVotes(firstVoteCounts, invalidCounts.invalidFirst, { year, skipVerification }),
    insertSecondVotes(secondVoteCounts, invalidCounts.invalidSecond, { year, skipVerification })
  ]);

  const votesDur = ((Date.now() - startVotes) / 1000).toFixed(1);
  console.log(`Both vote types generated in ${votesDur}s (parallel execution)`);

  console.log("\nRecreating indexes and foreign keys...");
  await recreateIndexesAndFKs();

  const total = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Ballot generation complete in ${total}s`);
}

async function ensureVoteTablesExist() {
  const res = await pool.query<{
    first_votes: string | null;
    second_votes: string | null;
  }>(
    "SELECT to_regclass('public.first_votes') AS first_votes, to_regclass('public.second_votes') AS second_votes"
  );
  const row = res.rows[0];
  if (!row?.first_votes || !row?.second_votes) {
    throw new Error("first_votes/second_votes tables are missing. Run migrations first.");
  }
}

async function prepareVoteTables(unlogged: boolean) {
  const target = unlogged ? "UNLOGGED" : "LOGGED";
  await Promise.all([
    pool.query(`ALTER TABLE first_votes SET ${target};`),
    pool.query(`ALTER TABLE second_votes SET ${target};`)
  ]);
  await dropIndexesAndFKs();
  await pool.query("TRUNCATE TABLE first_votes, second_votes RESTART IDENTITY;");
}

async function loadConstituencyStateMap(): Promise<Map<number, number>> {
  const res = await pool.query<{ id: number; state_id: number }>(
    "SELECT id, state_id FROM constituencies"
  );
  const map = new Map<number, number>();
  for (const row of res.rows) {
    map.set(row.id, row.state_id);
  }
  return map;
}

type FilterContext = {
  year?: number;
  constituencyIds?: number[];
  stateIds?: number[];
  constituencyStateMap: Map<number, number>;
};

function shouldIncludeRow(rowYear: number, constituencyId: number, ctx: FilterContext): boolean {
  if (ctx.year !== undefined && rowYear !== ctx.year) return false;
  if (ctx.constituencyIds && ctx.constituencyIds.length > 0 && !ctx.constituencyIds.includes(constituencyId)) {
    return false;
  }
  if (ctx.stateIds && ctx.stateIds.length > 0) {
    const stateId = ctx.constituencyStateMap.get(constituencyId);
    if (!stateId || !ctx.stateIds.includes(stateId)) return false;
  }
  return true;
}

function loadFirstVoteCounts(ctx: FilterContext): FirstVoteCount[] {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "direct_candidacy.csv"));
  const out: FirstVoteCount[] = [];

  for (const r of rows) {
    const personId = num(r["PersonID"]);
    const year = num(r["Year"]);
    const constituencyId = num(r["ConstituencyID"]);
    if (!personId || !year || !constituencyId) continue;

    if (!shouldIncludeRow(year, constituencyId, ctx)) continue;

    const votes = toCount(r["Erststimmen"]);
    if (votes <= 0) continue;

    out.push({
      person_id: personId,
      year,
      constituency_id: constituencyId,
      votes,
    });
  }

  return out;
}

function loadSecondVoteCounts(ctx: FilterContext): SecondVoteCount[] {
  const bridgeMap = loadBridgeIdMap();
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "constituency_party_votes.csv"));
  const out: SecondVoteCount[] = [];

  for (const r of rows) {
    const voteType = num(r["VoteType"]);
    if (voteType !== 2) continue;

    const bridgeId = num(r["BridgeID"]);
    if (!bridgeId) continue;
    const bridge = bridgeMap.get(bridgeId);
    if (!bridge) continue;

    const year = bridge.year;
    const constituencyId = bridge.constituencyId;
    const partyId = num(r["PartyID"]);
    if (!year || !constituencyId || !partyId) continue;

    if (!shouldIncludeRow(year, constituencyId, ctx)) continue;

    const votes = toCount(r["Votes"]);
    if (votes <= 0) continue;

    out.push({
      constituency_id: constituencyId,
      year,
      party_id: partyId,
      votes,
    });
  }

  return out;
}

function loadInvalidVoteCounts(ctx: FilterContext): { invalidFirst: InvalidVoteCount[]; invalidSecond: InvalidVoteCount[] } {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "constituency_elections.csv"));
  const invalidFirst: InvalidVoteCount[] = [];
  const invalidSecond: InvalidVoteCount[] = [];

  for (const r of rows) {
    const year = num(r["Year"]);
    const constituencyId = num(r["ConstituencyID"]);
    if (!year || !constituencyId) continue;

    if (!shouldIncludeRow(year, constituencyId, ctx)) continue;

    const invFirst = toCount(r["InvalidFirst"]);
    if (invFirst > 0) {
      invalidFirst.push({
        constituency_id: constituencyId,
        year,
        votes: invFirst,
      });
    }

    const invSecond = toCount(r["InvalidSecond"]);
    if (invSecond > 0) {
      invalidSecond.push({
        constituency_id: constituencyId,
        year,
        votes: invSecond,
      });
    }
  }

  return { invalidFirst, invalidSecond };
}

function loadBridgeIdMap(): Map<number, { year: number; constituencyId: number }> {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "constituency_elections.csv"));
  const map = new Map<number, { year: number; constituencyId: number }>();

  for (const r of rows) {
    const bridgeId = num(r["BridgeID"]);
    const year = num(r["Year"]);
    const constituencyId = num(r["ConstituencyID"]);
    if (!bridgeId || !year || !constituencyId) continue;
    map.set(bridgeId, { year, constituencyId });
  }

  return map;
}

async function insertFirstVotes(
  validCounts: FirstVoteCount[],
  invalidCounts: InvalidVoteCount[],
  options: { year?: number; skipVerification: boolean }
) {
  if (validCounts.length === 0 && invalidCounts.length === 0) {
    console.log(" -> No first_votes to insert for requested filters");
    return;
  }

  const client = await pool.connect();
  const t0 = Date.now();

  try {
    await applyFastSessionSettings(client);
    await client.query("CREATE TEMP TABLE tmp_first_vote_counts (person_id integer, year integer, constituency_id integer, votes bigint)");
    await bulkInsert(client, "tmp_first_vote_counts", ["person_id", "year", "constituency_id", "votes"], validCounts);

    if (invalidCounts.length > 0) {
      await client.query("CREATE TEMP TABLE tmp_invalid_first_counts (constituency_id integer, year integer, votes bigint)");
      await bulkInsert(client, "tmp_invalid_first_counts", ["constituency_id", "year", "votes"], invalidCounts);
    }

    await client.query(`
      WITH src AS (
        SELECT person_id, year, constituency_id, votes
        FROM tmp_first_vote_counts
        WHERE votes > 0
      ),
      mapped AS (
        SELECT
          src.person_id,
          ce.bridge_id AS constituency_election_id,
          src.votes
        FROM src
        JOIN direct_candidacy dc
          ON dc.person_id = src.person_id
        JOIN constituency_elections ce
          ON ce.bridge_id = dc.constituency_election_id
         AND ce.year = src.year
         AND ce.constituency_id = src.constituency_id
      )
      INSERT INTO first_votes (direct_person_id, constituency_election_id, is_valid, created_at)
      SELECT mapped.person_id, mapped.constituency_election_id, true, CURRENT_DATE
      FROM mapped
      JOIN LATERAL generate_series(1, mapped.votes) gs(n) ON true;
    `);

    if (invalidCounts.length > 0) {
      await client.query(`
        WITH invalid_src AS (
          SELECT constituency_id, year, votes
          FROM tmp_invalid_first_counts
          WHERE votes > 0
        ),
        pick AS (
          SELECT
            ce.bridge_id AS constituency_election_id,
            ce.constituency_id,
            ce.year,
            MIN(dc.person_id) AS person_id
          FROM direct_candidacy dc
          JOIN constituency_elections ce
            ON ce.bridge_id = dc.constituency_election_id
          JOIN invalid_src i
            ON i.constituency_id = ce.constituency_id
           AND i.year = ce.year
          GROUP BY ce.bridge_id, ce.constituency_id, ce.year
        )
        INSERT INTO first_votes (direct_person_id, constituency_election_id, is_valid, created_at)
        SELECT p.person_id, p.constituency_election_id, false, CURRENT_DATE
        FROM invalid_src i
        JOIN pick p
          ON p.constituency_id = i.constituency_id
         AND p.year = i.year
        JOIN LATERAL generate_series(1, i.votes) gs(n) ON true;
      `);
    }

    if (!options.skipVerification) {
      const mismatchRes = await client.query(`
        WITH mapped AS (
          SELECT
            src.person_id,
            src.year,
            src.constituency_id,
            src.votes,
            ce.bridge_id AS constituency_election_id
          FROM tmp_first_vote_counts src
          JOIN constituency_elections ce
            ON ce.constituency_id = src.constituency_id
           AND ce.year = src.year
        )
        SELECT
          mapped.person_id,
          mapped.year,
          mapped.constituency_id,
          mapped.votes AS expected,
          COUNT(fv.id)::bigint AS generated
        FROM mapped
        LEFT JOIN first_votes fv
          ON fv.direct_person_id = mapped.person_id
         AND fv.constituency_election_id = mapped.constituency_election_id
         AND fv.is_valid = true
        GROUP BY mapped.person_id, mapped.year, mapped.constituency_id, mapped.votes
        HAVING COUNT(fv.id)::bigint <> mapped.votes;
      `);

      if (mismatchRes.rows.length) {
        console.log(` Found ${mismatchRes.rows.length} mismatched direct candidates`);
      } else {
        console.log(" First votes consistent with CSV counts");
      }

      if (invalidCounts.length > 0) {
        const invalidMismatchRes = await client.query(`
          WITH invalid_src AS (
            SELECT constituency_id, year, votes
            FROM tmp_invalid_first_counts
          ),
          got AS (
            SELECT
              ce.constituency_id,
              ce.year,
              COUNT(*)::bigint AS generated
            FROM first_votes fv
            JOIN constituency_elections ce
              ON ce.bridge_id = fv.constituency_election_id
            WHERE fv.is_valid = false
            GROUP BY ce.constituency_id, ce.year
          )
          SELECT i.constituency_id, i.year, i.votes AS expected, COALESCE(g.generated, 0) AS generated
          FROM invalid_src i
          LEFT JOIN got g
            ON g.constituency_id = i.constituency_id
           AND g.year = i.year
          WHERE COALESCE(g.generated, 0) <> i.votes;
        `);

        if (invalidMismatchRes.rows.length) {
          console.log(` Warning: Found ${invalidMismatchRes.rows.length} mismatched invalid first-vote counts`);
        } else {
          console.log(" Invalid first votes consistent with CSV counts");
        }
      }
    }

    const countRes = await client.query(
      `SELECT COUNT(*)::bigint AS cnt
       FROM first_votes fv
       ${options.year ? "JOIN constituency_elections ce ON ce.bridge_id = fv.constituency_election_id WHERE ce.year = $1" : ""}`,
      options.year ? [options.year] : []
    );

    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(` -> ${Number(countRes.rows[0].cnt).toLocaleString()} first_votes inserted in ${dur}s`);
  } finally {
    try {
      await resetSessionSettings(client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(` Warning: Failed to reset session settings: ${message}`);
    }
    client.release();
  }
}

async function insertSecondVotes(
  validCounts: SecondVoteCount[],
  invalidCounts: InvalidVoteCount[],
  options: { year?: number; skipVerification: boolean }
) {
  if (validCounts.length === 0 && invalidCounts.length === 0) {
    console.log(" -> No second_votes to insert for requested filters");
    return;
  }

  const client = await pool.connect();
  const t0 = Date.now();

  try {
    await applyFastSessionSettings(client);
    await client.query("CREATE TEMP TABLE tmp_second_vote_counts (constituency_id integer, year integer, party_id integer, votes bigint)");
    await bulkInsert(client, "tmp_second_vote_counts", ["constituency_id", "year", "party_id", "votes"], validCounts);

    if (invalidCounts.length > 0) {
      await client.query("CREATE TEMP TABLE tmp_invalid_second_counts (constituency_id integer, year integer, votes bigint)");
      await bulkInsert(client, "tmp_invalid_second_counts", ["constituency_id", "year", "votes"], invalidCounts);
    }

    await client.query(`
      WITH src AS (
        SELECT constituency_id, year, party_id, votes
        FROM tmp_second_vote_counts
        WHERE votes > 0
      ),
      mapped AS (
        SELECT
          ce.bridge_id AS constituency_election_id,
          src.constituency_id,
          src.year,
          src.votes,
          pl.id AS party_list_id
        FROM src
        JOIN constituency_elections ce
          ON ce.constituency_id = src.constituency_id
         AND ce.year = src.year
        JOIN constituencies c ON c.id = ce.constituency_id
        JOIN party_lists pl
          ON pl.party_id = src.party_id
         AND pl.state_id = c.state_id
         AND pl.year = ce.year
      )
      INSERT INTO second_votes (party_list_id, constituency_election_id, is_valid, created_at)
      SELECT mapped.party_list_id, mapped.constituency_election_id, true, CURRENT_DATE
      FROM mapped
      JOIN LATERAL generate_series(1, mapped.votes) gs(n) ON true;
    `);

    if (invalidCounts.length > 0) {
      await client.query(`
        WITH invalid_src AS (
          SELECT constituency_id, year, votes
          FROM tmp_invalid_second_counts
          WHERE votes > 0
        ),
        pick AS (
          SELECT
            ce.bridge_id AS constituency_election_id,
            ce.constituency_id,
            ce.year,
            MIN(pl.id) AS party_list_id
          FROM invalid_src i
          JOIN constituency_elections ce
            ON ce.constituency_id = i.constituency_id
           AND ce.year = i.year
          JOIN constituencies c ON c.id = ce.constituency_id
          JOIN party_lists pl
            ON pl.state_id = c.state_id
           AND pl.year = ce.year
          GROUP BY ce.bridge_id, ce.constituency_id, ce.year
        )
        INSERT INTO second_votes (party_list_id, constituency_election_id, is_valid, created_at)
        SELECT p.party_list_id, p.constituency_election_id, false, CURRENT_DATE
        FROM invalid_src i
        JOIN pick p
          ON p.constituency_id = i.constituency_id
         AND p.year = i.year
        JOIN LATERAL generate_series(1, i.votes) gs(n) ON true;
      `);
    }

    if (!options.skipVerification) {
      const mismatchRes = await client.query(`
        WITH mapped AS (
          SELECT
            ce.bridge_id AS constituency_election_id,
            src.constituency_id,
            src.year,
            src.party_id,
            src.votes,
            pl.id AS party_list_id
          FROM tmp_second_vote_counts src
          JOIN constituency_elections ce
            ON ce.constituency_id = src.constituency_id
           AND ce.year = src.year
          JOIN constituencies c ON c.id = ce.constituency_id
          JOIN party_lists pl
            ON pl.party_id = src.party_id
           AND pl.state_id = c.state_id
           AND pl.year = ce.year
        )
        SELECT
          mapped.party_list_id,
          mapped.constituency_id,
          mapped.year,
          mapped.votes AS expected,
          COUNT(sv.id)::bigint AS generated
        FROM mapped
        LEFT JOIN second_votes sv
          ON sv.party_list_id = mapped.party_list_id
         AND sv.constituency_election_id = mapped.constituency_election_id
         AND sv.is_valid = true
        GROUP BY mapped.party_list_id, mapped.constituency_id, mapped.year, mapped.votes
        HAVING COUNT(sv.id)::bigint <> mapped.votes;
      `);

      if (mismatchRes.rows.length) {
        console.log(` Warning: Found ${mismatchRes.rows.length} mismatched party/constituency second-vote rows`);
      } else {
        console.log(" Second votes consistent with CSV counts");
      }

      if (invalidCounts.length > 0) {
        const invalidMismatchRes = await client.query(`
          WITH invalid_src AS (
            SELECT constituency_id, year, votes
            FROM tmp_invalid_second_counts
          ),
          got AS (
            SELECT
              ce.constituency_id,
              ce.year,
              COUNT(*)::bigint AS generated
            FROM second_votes sv
            JOIN constituency_elections ce
              ON ce.bridge_id = sv.constituency_election_id
            WHERE sv.is_valid = false
            GROUP BY ce.constituency_id, ce.year
          )
          SELECT i.constituency_id, i.year, i.votes AS expected, COALESCE(g.generated, 0) AS generated
          FROM invalid_src i
          LEFT JOIN got g
            ON g.constituency_id = i.constituency_id
           AND g.year = i.year
          WHERE COALESCE(g.generated, 0) <> i.votes;
        `);

        if (invalidMismatchRes.rows.length) {
          console.log(` Warning: Found ${invalidMismatchRes.rows.length} mismatched invalid second-vote counts`);
        } else {
          console.log(" Invalid second votes consistent with CSV counts");
        }
      }
    }

    const countRes = await client.query(
      "SELECT COUNT(*)::bigint AS cnt FROM second_votes"
    );

    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(` -> ${Number(countRes.rows[0].cnt).toLocaleString()} second_votes inserted in ${dur}s`);
  } finally {
    try {
      await resetSessionSettings(client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(` Warning: Failed to reset session settings: ${message}`);
    }
    client.release();
  }
}

async function bulkInsert<T extends Record<string, number>>(
  client: PoolClient,
  tableName: string,
  columns: string[],
  rows: T[],
  batchSize = 1000
) {
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: string[] = [];
    const params: number[] = [];

    for (const row of batch) {
      const placeholders: string[] = [];
      for (const col of columns) {
        params.push(row[col]);
        placeholders.push(`$${params.length}`);
      }
      values.push(`(${placeholders.join(", ")})`);
    }

    const query = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES ${values.join(", ")}`;
    await client.query(query, params);
  }
}

async function recreateIndexesAndFKs() {
  console.log("  Creating indexes...");
  const idxStart = Date.now();
  await Promise.all([
    pool.query(`
      CREATE INDEX IF NOT EXISTS idx_first_votes_person_constituency_election
        ON first_votes(direct_person_id, constituency_election_id);
    `),
    pool.query(`
      CREATE INDEX IF NOT EXISTS second_votes_party_idx
        ON second_votes(party_list_id);
    `),
    pool.query(`
      CREATE INDEX IF NOT EXISTS second_votes_constituency_election_idx
        ON second_votes(constituency_election_id);
    `)
  ]);
  const idxDur = ((Date.now() - idxStart) / 1000).toFixed(1);
  console.log(`  Indexes created in ${idxDur}s`);

  console.log("  Adding foreign key constraints...");
  const fkStart = Date.now();
  await dropIndexesAndFKs();

  await Promise.all([
    pool.query(`
      ALTER TABLE first_votes
        ADD CONSTRAINT fk_first_vote_direct_cand
        FOREIGN KEY (direct_person_id, constituency_election_id)
        REFERENCES direct_candidacy(person_id, constituency_election_id)
        ON DELETE CASCADE
        NOT VALID;
    `),
    pool.query(`
      ALTER TABLE second_votes
        ADD CONSTRAINT fk_second_vote_party_list
        FOREIGN KEY (party_list_id)
        REFERENCES party_lists(id)
        ON DELETE CASCADE
        NOT VALID;
    `),
    pool.query(`
      ALTER TABLE second_votes
        ADD CONSTRAINT fk_second_vote_constituency_election
        FOREIGN KEY (constituency_election_id)
        REFERENCES constituency_elections(bridge_id)
        ON DELETE CASCADE
        NOT VALID;
    `)
  ]);

  await Promise.all([
    pool.query(`ALTER TABLE first_votes VALIDATE CONSTRAINT fk_first_vote_direct_cand;`),
    pool.query(`ALTER TABLE second_votes VALIDATE CONSTRAINT fk_second_vote_party_list;`),
    pool.query(`ALTER TABLE second_votes VALIDATE CONSTRAINT fk_second_vote_constituency_election;`)
  ]);
  const fkDur = ((Date.now() - fkStart) / 1000).toFixed(1);
  console.log(`  Foreign keys added and validated in ${fkDur}s`);
}

async function dropIndexesAndFKs() {
  const fkRes = await pool.query<{
    conname: string;
    table_name: string;
  }>(
    `
    SELECT conname, conrelid::regclass::text AS table_name
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid::regclass::text IN ('first_votes', 'second_votes');
    `
  );

  for (const row of fkRes.rows) {
    await pool.query(`ALTER TABLE ${row.table_name} DROP CONSTRAINT IF EXISTS "${row.conname}";`);
  }

  const idxRes = await pool.query<{ indexname: string }>(
    `
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('first_votes', 'second_votes')
      AND indexname NOT LIKE '%_pkey';
    `
  );

  for (const row of idxRes.rows) {
    await pool.query(`DROP INDEX IF EXISTS "${row.indexname}";`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
