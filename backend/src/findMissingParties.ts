import dbModule from "./db";
const { pool, disconnect } = dbModule;
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";

interface PartyRow {
  PartyID: string;
  Gruppenname: string;
  GruppennameLang: string;
}

// ELECTION_YEAR same as loader
const ELECTION_YEAR = process.env.ELECTION_YEAR || "2021";
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const csvPath = path.join(DATA_DIR, `parties${ELECTION_YEAR}.csv`);

function readCsv<T>(filePath: string): T[] {
  const content = fs.readFileSync(filePath, "utf-8");
  return parse(content, {
    columns: true,
    delimiter: ";",
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
}

async function main() {
  const rows = readCsv<PartyRow>(csvPath);
  console.log(`Loaded ${rows.length} rows from ${path.basename(csvPath)}.`);

  const client = await pool.connect();
  try {
    console.log("Creating staging table...");
    await client.query("DROP TABLE IF EXISTS parties_staging;");
    await client.query(`
      CREATE TEMP TABLE parties_staging (
        id           integer,
        short_name   text,
        long_name    text
      );
    `);

    console.log("Inserting raw CSV data into staging...");
    for (const r of rows) {
      await client.query(
        `INSERT INTO parties_staging (id, short_name, long_name)
         VALUES ($1,$2,$3)`,
        [Number(r.PartyID) || null, r.Gruppenname || null, r.GruppennameLang || null]
      );
    }

    console.log("Comparing staged vs real data...\n");

    // Rows in staging that aren't present in real parties
    const missingRes = await client.query(`
      SELECT short_name, long_name
      FROM parties_staging s
      WHERE NOT EXISTS (
        SELECT 1 FROM parties p WHERE p.short_name = s.short_name
      )
      ORDER BY short_name;
    `);

    if (missingRes.rows.length === 0) {
      console.log("✅ All party names in CSV exist in the parties table");
    } else {
      console.log("⚠ Missing or mismatched party rows:");
      console.table(missingRes.rows);
      console.log(`Total missing: ${missingRes.rows.length}`);
    }

    // Optional: show duplicates inside CSV itself
    const dupRes = await client.query(`
      SELECT short_name, COUNT(*) as cnt
      FROM parties_staging
      WHERE short_name IS NOT NULL
      GROUP BY short_name
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC;
    `);

    if (dupRes.rows.length > 0) {
      console.log("\n⚠ Duplicate short names in CSV:");
      console.table(dupRes.rows);
    }

  } catch (err) {
    console.error("Error during staging comparison:", err);
  } finally {
    client.release();
    await disconnect();
  }
}

main();