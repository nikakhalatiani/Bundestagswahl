/**
 * Loads all normalized German federal election CSVs (for all years) into the DB.
 * Matches the new Drizzle schema: one CSV file per table, each possibly multi‑year.
 */

import dbModule from "./db"; // must export { pool, disconnect }
const { pool, disconnect } = dbModule;

import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import type { PoolClient } from "pg";

// ---------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------
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


// Updated helper to return NULL for empty strings
const num = (v: string | number | null | undefined): number | null => {
  // 1. Handle empty strings, null, undefined
  if (v === null || v === undefined || v === "") return null;

  // 2. Convert to number
  const n = Number(v);

  // 3. Check if it's a valid finite number (excludes NaN and Infinity)
  return Number.isFinite(n) ? n : null;
};

async function transactionalInsert(label: string, run: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    console.log(`→ Loading ${label} ...`);
    await client.query("BEGIN");
    await run(client);
    await client.query("COMMIT");
    console.log(`✓ ${label} loaded.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`Failed loading ${label}:`, err);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
//  Generic interfaces deriving from CSV structure
// ---------------------------------------------------------------------
type CsvRow = Record<string, string>;

// ---------------------------------------------------------------------
//  Folder setup
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
//  Loaders (one per table)
// ---------------------------------------------------------------------

async function loadStates() {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "states.csv"));
  await transactionalInsert("States", async (c) => {
    for (const r of rows) {
      await c.query(
        `INSERT INTO states (id, abbr, name)
         VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET abbr=EXCLUDED.abbr, name=EXCLUDED.name`,
        [Number(r["StateID"]), r["GebietLandAbk"], r["Gebietsname"]]
      );
    }
  });
}

async function loadParties() {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "parties.csv"));
  await transactionalInsert("Parties", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO parties (id, short_name, long_name, is_minority)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id)
         DO UPDATE SET short_name=EXCLUDED.short_name, long_name=EXCLUDED.long_name, is_minority=EXCLUDED.is_minority`,
        [Number(r["PartyID"]), r["ShortName"], r["LongName"], r["IsMinority"]?.toLowerCase() === "true",]
      );
  });
}

async function loadElections() {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "elections.csv"));
  await transactionalInsert("Elections", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO elections (year, date)
         VALUES ($1,$2)
         ON CONFLICT (year) DO UPDATE SET date=EXCLUDED.date`,
        [Number(r["Year"]), r["Date"]]
      );
  });
}

async function loadConstituencies() {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "constituencies.csv"));
  await transactionalInsert("Constituencies", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO constituencies (id, number, name, state_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id)
         DO UPDATE SET number=EXCLUDED.number, name=EXCLUDED.name, state_id=EXCLUDED.state_id`,
        [Number(r["ConstituencyID"]), Number(r["Number"]), r["Name"], Number(r["StateID"])]
      );
  });
}

async function loadPersons() {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "persons.csv"));
  await transactionalInsert("Persons", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO persons (id, title, name_addition, last_name, first_name, artist_name,
                               gender, birth_year, postal_code, city, birth_place, profession)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET last_name=EXCLUDED.last_name`,
        [
          Number(r["PersonID"]),
          r["Titel"] || null,
          r["Namenszusatz"] || null,
          r["Nachname"],
          r["Vornamen"],
          r["Künstlername"] || null,
          r["Geschlecht"] || null,
          r["Geburtsjahr"] ? Number(r["Geburtsjahr"]) : null,
          r["PLZ"] || null,
          r["Wohnort"] || null,
          r["Geburtsort"] || null,
          r["Beruf"] || null,
        ]
      );
  });
}

async function loadPartyLists() {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "party_lists.csv"));
  await transactionalInsert("Party Lists", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO party_lists (id, year, state_id, party_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id)
         DO UPDATE SET year=EXCLUDED.year,
                       state_id=EXCLUDED.state_id,
                       party_id=EXCLUDED.party_id`,
        [Number(r["PartyListID"]), Number(r["Year"]), Number(r["StateID"]), Number(r["PartyID"])]
      );
  });
}

async function loadDirectCandidacy() {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "direct_candidacy.csv"));
  const mappingRes = await pool.query(
    `SELECT bridge_id, year, constituency_id
     FROM constituency_elections`
  );
  const bridgeMap = new Map<string, number>();
  for (const row of mappingRes.rows) {
    bridgeMap.set(`${row.year}-${row.constituency_id}`, row.bridge_id);
  }
  await transactionalInsert("Direct Candidacy", async (c) => {
    for (const r of rows) {
      // Skip if composite PK is missing
      const pId = num(r["PersonID"]);
      const year = num(r["Year"]);
      const constituencyId = num(r["ConstituencyID"]);
      if (pId === null || year === null) continue;
      if (constituencyId === null) continue;
      const bridgeId = bridgeMap.get(`${year}-${constituencyId}`);
      if (!bridgeId) continue;

      await c.query(
        `INSERT INTO direct_candidacy (person_id, constituency_election_id, party_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (person_id, constituency_election_id) DO UPDATE
         SET party_id=EXCLUDED.party_id`,
        [
          pId,
          bridgeId,
          num(r["PartyID"])
        ]
      );
    }
  });
}

async function loadPartyListCandidacy() {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "party_list_candidacy.csv"));
  await transactionalInsert("Party List Candidacy", async (c) => {
    for (const r of rows) {
      const pId = num(r["PersonID"]);
      const plId = num(r["PartyListID"]);
      if (pId === null || plId === null) continue;

      await c.query(
        `INSERT INTO party_list_candidacy (person_id, party_list_id, list_position)
         VALUES ($1,$2,$3)
         ON CONFLICT (person_id, party_list_id)
         DO UPDATE SET list_position=EXCLUDED.list_position`,
        [
          pId,
          plId,
          num(r["Listenplatz"]),
        ]
      );
    }
  });
}

async function loadConstituencyElections() {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "constituency_elections.csv"));
  await transactionalInsert("Constituency Elections", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO constituency_elections (bridge_id, year, constituency_id, eligible_voters)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (bridge_id)
         DO UPDATE SET year=EXCLUDED.year,
                       constituency_id=EXCLUDED.constituency_id,
                       eligible_voters=EXCLUDED.eligible_voters`,
        [
          Number(r["BridgeID"]),
          Number(r["Year"]),
          Number(r["ConstituencyID"]),
          num(r["EligibleVoters"]),
        ]
      );
  });
}

async function loadStructuralData() {
  const rows = readCsv<CsvRow>(path.join(DATA_DIR, "strukturdaten.csv"));
  const mappingRes = await pool.query(
    `SELECT ce.bridge_id, ce.year, c.number
     FROM constituency_elections ce
     JOIN constituencies c ON c.id = ce.constituency_id`
  );
  const constituencyMap = new Map<string, number>();
  for (const row of mappingRes.rows) {
    constituencyMap.set(`${row.year}-${row.number}`, row.bridge_id);
  }

  await transactionalInsert("Structural Data", async (c) => {
    await c.query("DELETE FROM constituency_structural_data");
    await c.query("DELETE FROM structural_metrics");
    const seenMetrics = new Set<string>();
    for (const r of rows) {
      const year = num(r["Year"]);
      const number = num(r["ConstituencyNumber"]);
      const metricKey = r["MetricKey"];
      if (!year || !number || !metricKey) continue;
      const constituencyElectionId = constituencyMap.get(`${year}-${number}`);
      if (!constituencyElectionId) continue;

      if (!seenMetrics.has(metricKey)) {
        seenMetrics.add(metricKey);
        await c.query(
          `INSERT INTO structural_metrics (key, label, unit)
           VALUES ($1,$2,$3)
           ON CONFLICT (key)
           DO UPDATE SET label=EXCLUDED.label, unit=EXCLUDED.unit`,
          [metricKey, r["MetricLabel"] || metricKey, r["MetricUnit"] || null]
        );
      }

      await c.query(
        `INSERT INTO constituency_structural_data (constituency_election_id, metric_key, value)
         VALUES ($1,$2,$3)
         ON CONFLICT (constituency_election_id, metric_key)
         DO UPDATE SET value=EXCLUDED.value`,
        [
          constituencyElectionId,
          metricKey,
          num(r["Value"]),
        ]
      );
    }
  });
}

// ---------------------------------------------------------------------
//  Main pipeline
// ---------------------------------------------------------------------
async function main() {
  try {
    await loadStates();
    await loadParties();
    await loadElections();
    await loadConstituencies();
    await loadPersons();
    await loadPartyLists();
    await loadConstituencyElections();
    await loadDirectCandidacy();
    await loadPartyListCandidacy();
    await loadStructuralData();
    console.log("\nAll CSVs from data folder loaded successfully!");
  } finally {
    await disconnect();
  }
  async function resetSequences() {
    const tables = ["states", "parties", "constituencies", "persons", "party_lists", "constituency_elections"];
    const client = await pool.connect();
    try {
      for (const table of tables) {
        // Sets the sequence to the current maximum ID
        await client.query(`SELECT setval('${table}_id_seq', (SELECT MAX(id) FROM ${table}));`);
      }
      console.log("✓ Sequences reset.");
    } finally {
      client.release();
    }
  }
}

main();
