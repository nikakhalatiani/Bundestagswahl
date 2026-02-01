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
          -- drop all materialized views in the public schema
          FOR r IN (SELECT matviewname FROM pg_matviews WHERE schemaname = 'public')
          LOOP
              EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS "public"."' || r.matviewname || '" CASCADE;';
          END LOOP;

          -- drop all views in the public schema
          FOR r IN (SELECT viewname FROM pg_views WHERE schemaname = 'public')
          LOOP
              EXECUTE 'DROP VIEW IF EXISTS "public"."' || r.viewname || '" CASCADE;';
          END LOOP;

          -- drop all tables in the public schema
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
          LOOP
              EXECUTE 'DROP TABLE IF EXISTS "public"."' || r.tablename || '" CASCADE;';
          END LOOP;

          -- drop drizzle schema if exists
          EXECUTE 'DROP SCHEMA IF EXISTS "drizzle" CASCADE;';

      END $$;
    `);
    console.log("All public tables dropped.");
  } catch (err) {
    console.error("Failed to drop tables:", err);
  } finally {
    await disconnect();
  }
}

dropAllTables();
