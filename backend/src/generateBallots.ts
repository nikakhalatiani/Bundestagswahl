import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

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

  console.log('Starting ballot generation (all years)...');
  const start = Date.now();

  await db.execute(sql`SET LOCAL synchronous_commit = 'off';`);

  if (dropAndRecreateTables) {
    console.log('Dropping and recreating tables...');
    await recreateFirstVotesTable(useUnloggedTables);
    await recreateSecondVotesTable(useUnloggedTables);
  } else {
    console.log('Truncating existing first_votes and second_votes...');
    await db.execute(sql.raw('TRUNCATE TABLE first_votes, second_votes RESTART IDENTITY CASCADE;'));
  }

  console.log('\nGenerating first_votes...');
  await insertFirstVotes();

  console.log('\nGenerating second_votes...');
  await insertSecondVotes();

  console.log('\nRecreating indexes and foreign keys...');
  await recreateIndexesAndFKs();

  const total = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✅ Ballot generation complete in ${total}s`);

  if (!skipVerification) {
    console.log('\nVerifying consistency...');
    await verifyCounts();
  }
}

/**
 * Drop and recreate first_votes table (optionally as UNLOGGED)
 */
async function recreateFirstVotesTable(unlogged: boolean) {
  const definition = `
    DROP TABLE IF EXISTS first_votes CASCADE;
    CREATE ${unlogged ? 'UNLOGGED ' : ''}TABLE first_votes (
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
    CREATE ${unlogged ? 'UNLOGGED ' : ''}TABLE second_votes (
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
 */
async function insertFirstVotes() {
  const query = `
    INSERT INTO first_votes (
      year,
      direct_person_id,
      is_valid,
      created_at
    )
    SELECT
      dc.year,
      dc.person_id,
      true,
      CURRENT_DATE
    FROM direct_candidacy dc
    CROSS JOIN LATERAL generate_series(
      1,
      FLOOR(COALESCE(dc.first_votes, 0))::integer
    ) AS gs(n)
    WHERE dc.first_votes IS NOT NULL
      AND dc.first_votes > 0;
  `;
  const t0 = Date.now();
  await db.execute(sql.raw(query));
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(` -> first_votes inserted in ${dur}s`);
}

/**
 * Expand party_lists.vote_count into individual rows in second_votes
 */
async function insertSecondVotes() {
  const query = `
    INSERT INTO second_votes (
      party_list_id,
      is_valid,
      created_at
    )
    SELECT
      pl.id,
      true,
      CURRENT_DATE
    FROM party_lists pl
    CROSS JOIN LATERAL generate_series(
      1,
      FLOOR(COALESCE(pl.vote_count, 0))::integer
    ) AS gs(n)
    WHERE pl.vote_count IS NOT NULL
      AND pl.vote_count > 0;
  `;
  const t0 = Date.now();
  await db.execute(sql.raw(query));
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(` -> second_votes inserted in ${dur}s`);
}

/**
 * Add indexes and FKs after bulk inserts
 */
async function recreateIndexesAndFKs() {
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_first_votes_person_year
      ON first_votes(direct_person_id, year);
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_second_votes_party
      ON second_votes(party_list_id);
  `));

  await db.execute(sql.raw(`
    ALTER TABLE first_votes
      ADD CONSTRAINT fk_first_vote_direct_cand
      FOREIGN KEY (direct_person_id, year)
      REFERENCES direct_candidacy(person_id, year)
      ON DELETE CASCADE;
  `));

  await db.execute(sql.raw(`
    ALTER TABLE second_votes
      ADD CONSTRAINT fk_second_vote_party_list
      FOREIGN KEY (party_list_id)
      REFERENCES party_lists(id)
      ON DELETE CASCADE;
  `));
}

/**
 * Optional sanity verification: check that counts match aggregates
 */
async function verifyCounts() {
  console.log('Verifying first votes...');
  const firstMismatch = await db.execute(sql.raw(`
    SELECT dc.person_id, dc.first_votes, COUNT(fv.id)::bigint AS generated
    FROM direct_candidacy dc
    LEFT JOIN first_votes fv
      ON fv.direct_person_id = dc.person_id
     AND fv.year = dc.year
    WHERE dc.first_votes IS NOT NULL
    GROUP BY dc.person_id, dc.first_votes
    HAVING ABS(COUNT(fv.id) - FLOOR(dc.first_votes)) > 1;
  `));

  if (firstMismatch.rows.length) {
    console.log(` ⚠ Found ${firstMismatch.rows.length} mismatched direct candidates`);
  } else {
    console.log(' ✅ First votes consistent');
  }

  console.log('Verifying second votes...');
  const secondMismatch = await db.execute(sql.raw(`
    SELECT pl.id, pl.vote_count, COUNT(sv.id)::bigint AS generated
    FROM party_lists pl
    LEFT JOIN second_votes sv
      ON sv.party_list_id = pl.id
    GROUP BY pl.id, pl.vote_count
    HAVING ABS(COUNT(sv.id) - FLOOR(pl.vote_count)) > 1;
  `));

  if (secondMismatch.rows.length) {
    console.log(` ⚠ Found ${secondMismatch.rows.length} mismatched party lists`);
  } else {
    console.log(' ✅ Second votes consistent');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
