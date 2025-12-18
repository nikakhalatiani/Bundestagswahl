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
}

async function main() {
  await generateBallots({
    useUnloggedTables: true,
    dropAndRecreateTables: true,
    skipVerification: true,
  });
  await pool.end();
}

async function generateBallots(options: GenerationOptions) {
  const {
    useUnloggedTables = true,
    dropAndRecreateTables = true,
    skipVerification = true,
  } = options;

  console.log("Starting ballot generation (all years)...");
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
  await insertFirstVotes();

  console.log("\nGenerating second_votes...");
  await insertSecondVotes();

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
 */
async function insertFirstVotes() {
  const query = `
    WITH src AS (
      SELECT
        dc.year,
        dc.person_id AS direct_person_id,
        dc.first_votes::bigint AS n
      FROM direct_candidacy dc
      WHERE dc.first_votes IS NOT NULL
        AND dc.first_votes::bigint > 0
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
  console.log(` -> first_votes inserted in ${dur}s`);
}

/**
 * Expand party_lists.vote_count into individual rows in second_votes
 * Uses correct schema names:
 *   party_lists(id, vote_count)
 *   second_votes(party_list_id)
 */
async function insertSecondVotes() {
  const query = `
    WITH src AS (
      SELECT
        pl.id AS party_list_id,
        pl.vote_count::bigint AS n
      FROM party_lists pl
      WHERE pl.vote_count IS NOT NULL
        AND pl.vote_count::bigint > 0
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
  console.log(` -> second_votes inserted in ${dur}s`);
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