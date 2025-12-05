import dbModule from "./db";
const { pool, disconnect } = dbModule;
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";

interface StateRow {
  GebietLandAbk: string;
  Gebietsname: string;
}
interface PartyRow {
  PartyID: string;
  Gruppenname: string;
  GruppennameLang: string;
}
interface ConstituencyRow {
  Gebietsnummer: string;
  Gebietsname: string;
  GebietLandAbk: string;
}
interface CandidateRow {
  Titel: string;
  Namenszusatz: string;
  Nachname: string;
  Vornamen: string;
  Künstlername: string;
  Geschlecht: string;
  Geburtsjahr: string;
  PLZ: string;
  Wohnort: string;
  WohnortLandAbk: string;
  Geburtsort: string;
  Staatsangehörigkeit: string;
  Beruf: string;
  GebietLandAbk: string;
  GruppennameKurz: string;
  Listenplatz: string;
  Wahlkreis: string;
  State: string;
  Erststimmen: string;
}
interface StatePartyRow {
  GebietLandAbk: string;
  GruppennameKurz: string;
  Anzahl: string;
}

function readCsv<T>(pathToFile: string): T[] {
  const csv = fs.readFileSync(pathToFile, "utf-8");
  return parse(csv, {
    columns: true,
    delimiter: ";",
    trim: true,
    skip_empty_lines: true,
    // Allow records with an unexpected number of columns (e.g. trailing semicolons)
    relax_column_count: true,
  });
}

// ELECTION_YEAR controls which set of CSV files to use (e.g. '2021' or '2025')
const ELECTION_YEAR = process.env.ELECTION_YEAR || "2021";
const DATA_DIR = path.join(__dirname, "..", "..", "data");

console.log(`Loading election data for ${ELECTION_YEAR}`);

async function transactionalInsert(
  label: string,
  sql: (c: any) => Promise<void>
): Promise<void> {
  const client = await pool.connect();
  try {
    console.log(`→ Loading ${label} ...`);
    await client.query("BEGIN");
    await sql(client);
    await client.query("COMMIT");
    console.log(`✓ ${label} loaded.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`⚠ Failed loading ${label}:`, err);
  } finally {
    client.release();
  }
}

async function loadStates() {
  const p = path.join(DATA_DIR, `states${ELECTION_YEAR}.csv`);
  const rows = readCsv<StateRow>(p);
  await transactionalInsert("States", async (c) => {
    for (const r of rows) {
      await c.query(
        `INSERT INTO states (id, name)
         VALUES ($1,$2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [r.GebietLandAbk, r.Gebietsname]
      );
    }
  });
}

async function loadParties() {
  const p = path.join(DATA_DIR, `parties${ELECTION_YEAR}.csv`);
  const rows = readCsv<PartyRow>(p);
  const seen = new Set<string>();

  await transactionalInsert("Parties", async (c) => {
    for (const r of rows) {
      if (seen.has(r.Gruppenname)) continue;
      seen.add(r.Gruppenname);
      await c.query(
        `INSERT INTO parties (short_name, long_name)
         VALUES ($1,$2)
         ON CONFLICT (short_name)
         DO UPDATE SET long_name = EXCLUDED.long_name`,
        [r.Gruppenname, r.GruppennameLang]
      );
    }
  });
}

async function loadConstituencies() {
  const p = path.join(DATA_DIR, `wahlkreis${ELECTION_YEAR}.csv`);
  const rows = readCsv<ConstituencyRow>(p);
  await transactionalInsert("Constituencies", async (c) => {
    for (const r of rows) {
      await c.query(
        `INSERT INTO constituencies (number, name, state_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (number)
         DO UPDATE SET name = EXCLUDED.name, state_id = EXCLUDED.state_id`,
        [Number(r.Gebietsnummer), r.Gebietsname, r.GebietLandAbk]
      );
    }
  });
}

async function loadCandidates() {
  const p = path.join(DATA_DIR, `candidates${ELECTION_YEAR}.csv`);
  const rows = readCsv<CandidateRow>(p);
  await transactionalInsert("Candidates", async (c) => {
    await c.query("DELETE FROM candidates");
    let i = 0;
    for (const r of rows) {
      await c.query(
        `INSERT INTO candidates (title, name_addition, last_name, first_name, artist_name, gender,
          birth_year, postal_code, city, city_state_abbr, birth_place,
          profession, state_id, party_short_name, list_position,
          constituency_num, state_name, first_votes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          r.Titel || null,
          r.Namenszusatz || null,
          r.Nachname,
          r.Vornamen,
          r.Künstlername || null,
          r.Geschlecht || null,
          r.Geburtsjahr ? Number(r.Geburtsjahr) : null,
          r.PLZ || null,
          r.Wohnort || null,
          r.WohnortLandAbk || null,
          r.Geburtsort || null,
          r.Beruf || null,
          r.GebietLandAbk,
          r.GruppennameKurz || null,
          r.Listenplatz ? Number(r.Listenplatz) : null,
          r.Wahlkreis ? Number(r.Wahlkreis) : null,
          r.State || null,
          r.Erststimmen ? Number(r.Erststimmen) : null,
        ]
      );
      if (++i % 1000 === 0) process.stdout.write(`\r  inserted ${i}`);
    }
  });
}

async function loadStateParties() {
  const p = path.join(DATA_DIR, `state_parties${ELECTION_YEAR}.csv`);
  const rows = readCsv<StatePartyRow>(p);
  await transactionalInsert("State Parties", async (c) => {
    for (const r of rows) {
      await c.query(
        `INSERT INTO state_parties (state_id, party_short_name, second_votes)
       VALUES ($1,$2,$3)
       ON CONFLICT (state_id, party_short_name)
       DO UPDATE SET second_votes = EXCLUDED.second_votes`,
        [r.GebietLandAbk, r.GruppennameKurz, Number(r.Anzahl) || 0]
      );
    }
  });
}

async function main() {
  try {
    await loadStates();
    await loadParties();
    await loadConstituencies();
    await loadCandidates();
    await loadStateParties();
    console.log("\n✅ CSV data loaded successfully");
  } finally {
    await disconnect();
  }
}
main();