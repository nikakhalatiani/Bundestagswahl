/**
 * Loads all normalized Bundestagswahl CSVs (for all years) into the DB.
 * Matches the new Drizzle schema: one CSV file per table, each possibly multi‑year.
 */

import dbModule from "./db"; // must export { pool, disconnect }
const { pool, disconnect } = dbModule;

import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";

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

async function transactionalInsert(label: string, run: (c: any) => Promise<void>) {
  const client = await pool.connect();
  try {
    console.log(`→ Loading ${label} ...`);
    await client.query("BEGIN");
    await run(client);
    await client.query("COMMIT");
    console.log(`✓ ${label} loaded.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`⚠ Failed loading ${label}:`, err);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
//  Generic interfaces deriving from your CSV structure
// ---------------------------------------------------------------------
interface StateRow {
  StateID: string;
  GebietLandAbk: string;
  Gebietsname: string;
}
interface PartyRow {
  PartyID: string;
  ShortName: string;
  LongName: string;
}
interface ElectionRow {
  Year: string;
  Date: string;
}
interface ConstituencyRow {
  ConstituencyID: string;
  Number: string;
  Name: string;
  StateID: string;
}
interface PersonRow {
  PersonID: string;
  Titel: string;
  Namenszusatz: string;
  Nachname: string;
  Vornamen: string;
  Künstlername: string;
  Geschlecht: string;
  Geburtsjahr: string;
  PLZ: string;
  Wohnort: string;
  Geburtsort: string;
  Beruf: string;
}
interface PartyListRow {
  PartyListID: string;
  Year: string;
  StateID: string;
  PartyID: string;
  VoteCount: string;
}
interface DirectCandRow {
  PersonID: string;
  Year: string;
  ConstituencyID: string;
  Erststimmen: string;
  PreviouslyElected: string;
  PartyID: string;
}
interface PartyListCandRow {
  PersonID: string;
  Year: string;
  PartyListID: string;
  Listenplatz: string;
  PreviouslyElected: string;
}
interface ConstElectionRow {
  BridgeID: string;
  Year: string;
  ConstituencyID: string;
  EligibleVoters: string;
  TotalVoters: string;
}
interface ConstPartyVoteRow {
  ID: string;
  BridgeID: string;
  PartyID: string;
  VoteType: string;
  Votes: string;
  Percent: string;
  PrevVotes: string;
  PrevPercent: string;
  DiffPercentPts: string;
}

// ---------------------------------------------------------------------
//  Folder setup (you now keep everything inside "data")
// ---------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, "..", "..", "data");

// ---------------------------------------------------------------------
//  Loaders (one per table)
// ---------------------------------------------------------------------

async function loadStates() {
  const rows = readCsv<StateRow>(path.join(DATA_DIR, "states.csv"));
  await transactionalInsert("States", async (c) => {
    for (const r of rows) {
      await c.query(
        `INSERT INTO states (id, abbr, name)
         VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET abbr=EXCLUDED.abbr, name=EXCLUDED.name`,
        [Number(r.StateID), r.GebietLandAbk, r.Gebietsname]
      );
    }
  });
}

async function loadParties() {
  const rows = readCsv<PartyRow>(path.join(DATA_DIR, "parties.csv"));
  await transactionalInsert("Parties", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO parties (id, short_name, long_name)
         VALUES ($1,$2,$3)
         ON CONFLICT (id)
         DO UPDATE SET short_name=EXCLUDED.short_name, long_name=EXCLUDED.long_name`,
        [Number(r.PartyID), r.ShortName, r.LongName]
      );
  });
}

async function loadElections() {
  const rows = readCsv<ElectionRow>(path.join(DATA_DIR, "elections.csv"));
  await transactionalInsert("Elections", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO elections (year, date)
         VALUES ($1,$2)
         ON CONFLICT (year) DO UPDATE SET date=EXCLUDED.date`,
        [Number(r.Year), r.Date]
      );
  });
}

async function loadConstituencies() {
  const rows = readCsv<ConstituencyRow>(path.join(DATA_DIR, "constituencies.csv"));
  await transactionalInsert("Constituencies", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO constituencies (id, number, name, state_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id)
         DO UPDATE SET number=EXCLUDED.number, name=EXCLUDED.name, state_id=EXCLUDED.state_id`,
        [Number(r.ConstituencyID), Number(r.Number), r.Name, Number(r.StateID)]
      );
  });
}

async function loadPersons() {
  const rows = readCsv<PersonRow>(path.join(DATA_DIR, "persons.csv"));
  await transactionalInsert("Persons", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO persons (id, title, name_addition, last_name, first_name, artist_name,
                               gender, birth_year, postal_code, city, birth_place, profession)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET last_name=EXCLUDED.last_name`,
        [
          Number(r.PersonID),
          r.Titel || null,
          r.Namenszusatz || null,
          r.Nachname,
          r.Vornamen,
          r.Künstlername || null,
          r.Geschlecht || null,
          r.Geburtsjahr ? Number(r.Geburtsjahr) : null,
          r.PLZ || null,
          r.Wohnort || null,
          r.Geburtsort || null,
          r.Beruf || null,
        ]
      );
  });
}

async function loadPartyLists() {
  const rows = readCsv<PartyListRow>(path.join(DATA_DIR, "party_lists.csv"));
  await transactionalInsert("Party Lists", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO party_lists (id, year, state_id, party_id, vote_count)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id)
         DO UPDATE SET vote_count=EXCLUDED.vote_count`,
        [Number(r.PartyListID), Number(r.Year), Number(r.StateID), Number(r.PartyID), Number(r.VoteCount)]
      );
  });
}

async function loadDirectCandidacy() {
  const rows = readCsv<DirectCandRow>(path.join(DATA_DIR, "direct_candidacy.csv"));
  await transactionalInsert("Direct Candidacy", async (c) => {
    for (const r of rows) {
      // Skip if composite PK is missing
      const pId = num(r.PersonID);
      const year = num(r.Year);
      if (pId === null || year === null) continue; 

      await c.query(
        `INSERT INTO direct_candidacy (person_id, year, constituency_id, first_votes, previously_elected, party_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (person_id, year) DO UPDATE
         SET first_votes=EXCLUDED.first_votes,
             previously_elected=EXCLUDED.previously_elected,
             party_id=EXCLUDED.party_id`,
        [
          pId,
          year,
          num(r.ConstituencyID),
          num(r.Erststimmen), // This handles "NaN" correctly now
          r.PreviouslyElected?.toLowerCase() === "true",
          num(r.PartyID)
        ]
      );
    }
  });
}

async function loadPartyListCandidacy() {
  const rows = readCsv<PartyListCandRow>(path.join(DATA_DIR, "party_list_candidacy.csv"));
  await transactionalInsert("Party List Candidacy", async (c) => {
    for (const r of rows) {
      const pId = num(r.PersonID);
      const plId = num(r.PartyListID);
      if (pId === null || plId === null) continue;

      await c.query(
        `INSERT INTO party_list_candidacy (person_id, party_list_id, list_position, previously_elected)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (person_id, party_list_id)
         DO UPDATE SET list_position=EXCLUDED.list_position,
                       previously_elected=EXCLUDED.previously_elected`,
        [
          pId,
          plId,
          num(r.Listenplatz), // Changed from ternary/Number()
          r.PreviouslyElected?.toLowerCase() === "true",
        ]
      );
    }
  });
}

async function loadConstituencyElections() {
  const rows = readCsv<ConstElectionRow>(path.join(DATA_DIR, "constituency_elections.csv"));
  await transactionalInsert("Constituency Elections", async (c) => {
    for (const r of rows)
      await c.query(
        `INSERT INTO constituency_elections (bridge_id, year, constituency_id, eligible_voters, total_voters)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (bridge_id)
         DO UPDATE SET eligible_voters=EXCLUDED.eligible_voters,
                       total_voters=EXCLUDED.total_voters`,
        [
          Number(r.BridgeID),
          Number(r.Year),
          Number(r.ConstituencyID),
          r.EligibleVoters ? Number(r.EligibleVoters) : null,
          r.TotalVoters ? Number(r.TotalVoters) : null,
        ]
      );
  });
}

async function loadConstituencyPartyVotes() {
  const rows = readCsv<ConstPartyVoteRow>(path.join(DATA_DIR, "constituency_party_votes.csv"));
  await transactionalInsert("Constituency Party Votes", async (c) => {
    for (const r of rows) {
      const id = num(r.ID);
      if (id === null) continue;

      await c.query(
        `INSERT INTO constituency_party_votes 
         (id, bridge_id, party_id, vote_type, votes, percent, prev_votes, prev_percent, diff_percent_pts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id)
         DO UPDATE SET votes=EXCLUDED.votes, percent=EXCLUDED.percent,
                       prev_votes=EXCLUDED.prev_votes, prev_percent=EXCLUDED.prev_percent,
                       diff_percent_pts=EXCLUDED.diff_percent_pts`,
        [
          id,
          num(r.BridgeID),
          num(r.PartyID),
          num(r.VoteType),
          num(r.Votes),            // Safely handles "NaN"
          num(r.Percent),          // Safely handles "NaN"
          num(r.PrevVotes),        // Safely handles "NaN"
          num(r.PrevPercent),      // Safely handles "NaN"
          num(r.DiffPercentPts),   // Safely handles "NaN"
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
    await loadDirectCandidacy();
    await loadPartyListCandidacy();
    await loadConstituencyElections();
    await loadConstituencyPartyVotes();
    console.log("\n✅ All CSVs from data folder loaded successfully!");
  } finally {
    await disconnect();
  }
  async function resetSequences() {
  const tables = ["states", "parties", "constituencies", "persons", "party_lists", "constituency_elections", "constituency_party_votes"]; 
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