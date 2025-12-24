/**
 * Ballot Generator
 *
 * Generates individual ballot records (first_votes and second_votes) from
 * pre-aggregated election data, ensuring that counts match exactly.
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
 * 6. Append to existing data (don't drop tables):
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
 *   --no-drop                Don't recreate tables (append mode)
 *   --verify                 Run verification after generation
 *   --logged                 Create logged tables (default: unlogged for speed)
 *
 * EXAMPLES:
 *   # Generate only constituency 63 (Frankfurt/Oder) for 2025
 *   npx ts-node src/generateBallots.ts --year=2025 --constituency=63
 *
 *   # Generate all Berlin constituencies (state_id=11)
 *   npx ts-node src/generateBallots.ts --year=2025 --state=11
 *
 *   # Regenerate with verification
 *   npx ts-node src/generateBallots.ts --year=2025 --verify
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = drizzle(pool);

interface GenerationOptions {
  useUnloggedTables?: boolean;
  dropAndRecreateTables?: boolean;
  skipVerification?: boolean;
  year?: number; // Filter by election year (default: all years)
  constituencyNumbers?: number[]; // Filter by constituency NUMBERS (56, 57, 58...) - USER-FACING
  stateIds?: number[]; // Filter by specific state IDs (default: all)
}

async function main() {
  // Parse command-line arguments
  const args = process.argv.slice(2);
  const options: GenerationOptions = {
    useUnloggedTables: true,
    dropAndRecreateTables: true,
    skipVerification: true,
  };

  for (const arg of args) {
    if (arg.startsWith('--year=')) {
      options.year = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--constituency=')) {
      const nums = arg.split('=')[1].split(',').map(Number);
      options.constituencyNumbers = nums;
    } else if (arg.startsWith('--constituencies=')) {
      const nums = arg.split('=')[1].split(',').map(Number);
      options.constituencyNumbers = nums;
    } else if (arg.startsWith('--state=')) {
      const ids = arg.split('=')[1].split(',').map(Number);
      options.stateIds = ids;
    } else if (arg === '--no-drop') {
      options.dropAndRecreateTables = false;
    } else if (arg === '--verify') {
      options.skipVerification = false;
    } else if (arg === '--logged') {
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

  // Validate and map constituency numbers to IDs
  let constituencyIds: number[] | undefined;
  if (constituencyNumbers && constituencyNumbers.length > 0) {
    // If year is specified, filter constituencies by year (via direct_candidacy or constituency_elections)
    // to handle cases where the same constituency number exists for different election years
    let mappingQuery: string;
    let queryParams: any[];

    if (year !== undefined) {
      // Filter by year: only return constituencies that have candidates in that election year
      mappingQuery = `
        SELECT DISTINCT c.id, c.number, c.name
        FROM constituencies c
        JOIN direct_candidacy dc ON dc.constituency_id = c.id
        WHERE c.number = ANY($1) AND dc.year = $2
        ORDER BY c.number
      `;
      queryParams = [constituencyNumbers, year];
    } else {
      // No year filter: return all constituencies with those numbers (may include duplicates across years!)
      mappingQuery = `
        SELECT id, number, name
        FROM constituencies
        WHERE number = ANY($1)
        ORDER BY number
      `;
      queryParams = [constituencyNumbers];
    }

    const mappingRes = await pool.query(mappingQuery, queryParams);

    if (mappingRes.rows.length === 0) {
      console.error(`❌ Error: No constituencies found with numbers: ${constituencyNumbers.join(', ')}${year ? ` for year ${year}` : ''}`);
      console.error(`   Valid constituency numbers range from 1-299 (use the "Number" column, not the database ID)`);
      if (!year) {
        console.error(`   💡 Tip: Specify --year=YYYY to avoid ambiguity with constituency numbers that changed between elections`);
      }
      process.exit(1);
    }

    if (mappingRes.rows.length < constituencyNumbers.length) {
      const foundNumbers = mappingRes.rows.map((r: any) => r.number);
      const missingNumbers = constituencyNumbers.filter(n => !foundNumbers.includes(n));
      console.warn(`⚠️  Warning: Some constituency numbers not found: ${missingNumbers.join(', ')}${year ? ` for year ${year}` : ''}`);
      console.warn(`   Will generate ballots for: ${foundNumbers.join(', ')}`);
    }

    // Check for duplicate constituency numbers (same number, different IDs)
    const numberCounts = new Map<number, number>();
    for (const row of mappingRes.rows) {
      const count = numberCounts.get(row.number) || 0;
      numberCounts.set(row.number, count + 1);
    }
    const duplicates = Array.from(numberCounts.entries()).filter(([_, count]) => count > 1);

    if (duplicates.length > 0 && !year) {
      const dupNumbers = duplicates.map(([num, _]) => num);
      console.warn(`⚠️  Warning: Constituency numbers ${dupNumbers.join(', ')} exist in multiple election years`);
      console.warn(`   Generating ballots for ALL matching constituencies. Specify --year=YYYY to disambiguate.`);
      mappingRes.rows.forEach((r: any) => {
        console.warn(`     - Constituency ${r.number}: "${r.name}" (id=${r.id})`);
      });
    }

    constituencyIds = mappingRes.rows.map((r: any) => r.id);
    console.log(`✓ Mapped constituency numbers ${constituencyNumbers.join(',')} → database IDs ${constituencyIds.join(',')}${year ? ` (year ${year})` : ''}`);
  }

  // Build filter description
  let filterDesc = '';
  if (year) filterDesc += ` year=${year}`;
  if (constituencyNumbers) filterDesc += ` constituencies=${constituencyNumbers.join(',')}`;
  if (stateIds) filterDesc += ` states=${stateIds.join(',')}`;

  console.log(`Starting ballot generation${filterDesc || ' (all data)'}...`);
  const start = Date.now();

  await db.execute(sql`SET LOCAL synchronous_commit = 'off';`);

  if (dropAndRecreateTables) {
    console.log("Dropping and recreating tables...");
    await recreateFirstVotesTable(useUnloggedTables);
    await recreateSecondVotesTable(useUnloggedTables);
  } else {
    console.log("Truncating existing first_votes and second_votes...");
    await db.execute(
      sql.raw(
        "TRUNCATE TABLE first_votes, second_votes RESTART IDENTITY CASCADE;"
      )
    );
  }

  console.log("\nGenerating first_votes...");
  await insertFirstVotes(year, constituencyIds, stateIds);

  console.log("\nGenerating second_votes...");
  await insertSecondVotes(year, constituencyIds, stateIds);

  console.log("\nRecreating indexes and foreign keys...");
  await recreateIndexesAndFKs();

  const total = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✅ Ballot generation complete in ${total}s`);

  if (!skipVerification) {
    console.log("\nVerifying consistency...");
    await verifyCounts();
  }
}

/**
 * Drop and recreate first_votes table (optionally as UNLOGGED)
 */
async function recreateFirstVotesTable(unlogged: boolean) {
  const definition = `
    DROP TABLE IF EXISTS first_votes CASCADE;
    CREATE ${unlogged ? "UNLOGGED " : ""}TABLE first_votes (
      id serial PRIMARY KEY,
      year integer NOT NULL,
      direct_person_id integer NOT NULL,
      is_valid boolean NOT NULL DEFAULT true,
      created_at date DEFAULT now()
    );
  `;
  await db.execute(sql.raw(definition));
}

/**
 * Drop and recreate second_votes table (optionally as UNLOGGED)
 */
async function recreateSecondVotesTable(unlogged: boolean) {
  const definition = `
    DROP TABLE IF EXISTS second_votes CASCADE;
    CREATE ${unlogged ? "UNLOGGED " : ""}TABLE second_votes (
      id serial PRIMARY KEY,
      party_list_id integer NOT NULL,
      is_valid boolean NOT NULL DEFAULT true,
      created_at date DEFAULT now()
    );
  `;
  await db.execute(sql.raw(definition));
}

/**
 * Expand direct_candidacy.first_votes into individual rows in first_votes
 * Uses correct schema names:
 *   direct_candidacy(person_id, year, first_votes)
 *   first_votes(year, direct_person_id)
 *
 * Supports filtering by year, constituency IDs, or state IDs
 */
async function insertFirstVotes(
  year?: number,
  constituencyIds?: number[],
  stateIds?: number[]
) {
  // Build WHERE clause filters
  const filters: string[] = [
    'dc.first_votes IS NOT NULL',
    'dc.first_votes::bigint > 0'
  ];

  if (year !== undefined) {
    filters.push(`dc.year = ${year}`);
  }

  if (constituencyIds && constituencyIds.length > 0) {
    filters.push(`dc.constituency_id IN (${constituencyIds.join(',')})`);
  }

  if (stateIds && stateIds.length > 0) {
    filters.push(`dc.constituency_id IN (SELECT id FROM constituencies WHERE state_id IN (${stateIds.join(',')}))`);
  }

  const whereClause = filters.join('\n        AND ');

  const query = `
    WITH src AS (
      SELECT
        dc.year,
        dc.person_id AS direct_person_id,
        dc.first_votes::bigint AS n
      FROM direct_candidacy dc
      WHERE ${whereClause}
    )
    INSERT INTO first_votes (
      year,
      direct_person_id,
      is_valid,
      created_at
    )
    SELECT
      src.year,
      src.direct_person_id,
      true,
      CURRENT_DATE
    FROM src
    JOIN LATERAL generate_series(1, src.n) gs(n) ON true;
  `;
  const t0 = Date.now();
  await db.execute(sql.raw(query));
  const dur = ((Date.now() - t0) / 1000).toFixed(1);

  // Count inserted rows
  const countRes = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM first_votes WHERE ${year !== undefined ? `year = ${year}` : 'true'}`));
  const count = countRes.rows[0]?.cnt || 0;
  console.log(` -> ${Number(count).toLocaleString()} first_votes inserted in ${dur}s`);
}

/**
 * Expand party_lists.vote_count into individual rows in second_votes
 * Uses correct schema names:
 *   party_lists(id, vote_count)
 *   second_votes(party_list_id)
 *
 * Supports filtering by year, constituency IDs (via state), or state IDs
 */
async function insertSecondVotes(
  year?: number,
  constituencyIds?: number[],
  stateIds?: number[]
) {
  // Build WHERE clause filters
  const filters: string[] = [
    'pl.vote_count IS NOT NULL',
    'pl.vote_count::bigint > 0'
  ];

  if (year !== undefined) {
    filters.push(`pl.year = ${year}`);
  }

  // For second votes, filter by state (party lists are state-level)
  if (stateIds && stateIds.length > 0) {
    filters.push(`pl.state_id IN (${stateIds.join(',')})`);
  } else if (constituencyIds && constituencyIds.length > 0) {
    // If constituencies specified, get their states
    filters.push(`pl.state_id IN (SELECT DISTINCT state_id FROM constituencies WHERE id IN (${constituencyIds.join(',')}))`);
  }

  const whereClause = filters.join('\n        AND ');

  const query = `
    WITH src AS (
      SELECT
        pl.id AS party_list_id,
        pl.vote_count::bigint AS n
      FROM party_lists pl
      WHERE ${whereClause}
    )
    INSERT INTO second_votes (
      party_list_id,
      is_valid,
      created_at
    )
    SELECT
      src.party_list_id,
      true,
      CURRENT_DATE
    FROM src
    JOIN LATERAL generate_series(1, src.n) gs(n) ON true;
  `;
  const t0 = Date.now();
  await db.execute(sql.raw(query));
  const dur = ((Date.now() - t0) / 1000).toFixed(1);

  // Count inserted rows
  const countRes = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM second_votes`));
  const count = countRes.rows[0]?.cnt || 0;
  console.log(` -> ${Number(count).toLocaleString()} second_votes inserted in ${dur}s`);
}

/**
 * Add indexes and FKs after bulk inserts
 * Uses correct FK references:
 *   first_votes(direct_person_id, year) -> direct_candidacy(person_id, year)
 *   second_votes(party_list_id)         -> party_lists(id)
 */
async function recreateIndexesAndFKs() {
  await db.execute(
    sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_first_votes_person_year
        ON first_votes(direct_person_id, year);
    `)
  );

  await db.execute(
    sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_second_votes_party_list
        ON second_votes(party_list_id);
    `)
  );

  // Add constraints as NOT VALID (faster), then validate
  await db.execute(
    sql.raw(`
      ALTER TABLE first_votes
        ADD CONSTRAINT fk_first_vote_direct_cand
        FOREIGN KEY (direct_person_id, year)
        REFERENCES direct_candidacy(person_id, year)
        ON DELETE CASCADE
        NOT VALID;
    `)
  );

  await db.execute(
    sql.raw(`
      ALTER TABLE second_votes
        ADD CONSTRAINT fk_second_vote_party_list
        FOREIGN KEY (party_list_id)
        REFERENCES party_lists(id)
        ON DELETE CASCADE
        NOT VALID;
    `)
  );

  await db.execute(
    sql.raw(`
      ALTER TABLE first_votes
        VALIDATE CONSTRAINT fk_first_vote_direct_cand;
    `)
  );

  await db.execute(
    sql.raw(`
      ALTER TABLE second_votes
        VALIDATE CONSTRAINT fk_second_vote_party_list;
    `)
  );
}

/**
 * Optional sanity verification: check that counts match aggregates exactly
 */
async function verifyCounts() {
  console.log("Verifying first votes...");
  const firstMismatch = await db.execute(
    sql.raw(`
      SELECT
        dc.person_id,
        dc.year,
        dc.first_votes::bigint AS expected,
        COUNT(fv.id)::bigint AS generated
      FROM direct_candidacy dc
      LEFT JOIN first_votes fv
        ON fv.direct_person_id = dc.person_id
       AND fv.year = dc.year
      WHERE dc.first_votes IS NOT NULL
        AND dc.first_votes::bigint > 0
      GROUP BY dc.person_id, dc.year, dc.first_votes
      HAVING COUNT(fv.id)::bigint <> dc.first_votes::bigint;
    `)
  );

  if (firstMismatch.rows.length) {
    console.log(
      ` ⚠ Found ${firstMismatch.rows.length} mismatched direct candidates`
    );
  } else {
    console.log(" ✅ First votes consistent");
  }

  console.log("Verifying second votes...");
  const secondMismatch = await db.execute(
    sql.raw(`
      SELECT
        pl.id AS party_list_id,
        pl.vote_count::bigint AS expected,
        COUNT(sv.id)::bigint AS generated
      FROM party_lists pl
      LEFT JOIN second_votes sv
        ON sv.party_list_id = pl.id
      WHERE pl.vote_count IS NOT NULL
        AND pl.vote_count::bigint > 0
      GROUP BY pl.id, pl.vote_count
      HAVING COUNT(sv.id)::bigint <> pl.vote_count::bigint;
    `)
  );

  if (secondMismatch.rows.length) {
    console.log(
      ` ⚠ Found ${secondMismatch.rows.length} mismatched party lists`
    );
  } else {
    console.log(" ✅ Second votes consistent");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});