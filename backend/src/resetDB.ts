// src/db/reset.ts
import dbModule from "./db";
const { pool, disconnect } = dbModule;

async function dropAllTables() {
  try {
    console.log("Dropping all public tables...");
    await pool.query(`
      DO $$
      DECLARE
          r RECORD;
      BEGIN
          -- drop all tables in the public schema
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
          LOOP
              EXECUTE 'DROP TABLE IF EXISTS "public"."' || r.tablename || '" CASCADE;';
          END LOOP;

          -- drop drizzle schema if exists
          EXECUTE 'DROP SCHEMA IF EXISTS "drizzle" CASCADE;';

      END $$;
    `);
    console.log("✅ All public tables dropped.");
  } catch (err) {
    console.error("⚠ Failed to drop tables:", err);
  } finally {
    await disconnect();
  }
}

dropAllTables();