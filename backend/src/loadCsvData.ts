import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

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

function readCsv<T>(filePath: string): T[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, {
    columns: true,
    delimiter: ';',
    skip_empty_lines: true,
    trim: true,
  });
}

function parseFloat(value: string): number | null {
  if (!value || value === '') return null;
  const parsed = Number(value);
  return isNaN(parsed) ? null : parsed;
}

function parseInt(value: string): number | null {
  if (!value || value === '') return null;
  const parsed = Number(value);
  return isNaN(parsed) ? null : Math.floor(parsed);
}

async function loadStates() {
  console.log('Loading states...');
  const csvPath = path.join(__dirname, '..', '..', 'Bundestagswahl', 'outputs', 'states.csv');
  const rows = readCsv<StateRow>(csvPath);
  
  for (const row of rows) {
    await prisma.state.upsert({
      where: { id: row.GebietLandAbk },
      update: { name: row.Gebietsname },
      create: {
        id: row.GebietLandAbk,
        name: row.Gebietsname,
      },
    });
  }
  console.log(`Loaded ${rows.length} states`);
}

async function loadParties() {
  console.log('Loading parties...');
  const csvPath = path.join(__dirname, '..', '..', 'Bundestagswahl', 'outputs', 'parties.csv');
  const rows = readCsv<PartyRow>(csvPath);
  
  const seenShortNames = new Set<string>();
  
  for (const row of rows) {
    // Skip duplicates (e.g., CDU appears multiple times)
    if (seenShortNames.has(row.Gruppenname)) {
      console.log(`  Skipping duplicate party: ${row.Gruppenname}`);
      continue;
    }
    seenShortNames.add(row.Gruppenname);
    
    await prisma.party.upsert({
      where: { shortName: row.Gruppenname },
      update: {
        id: Number(row.PartyID),
        longName: row.GruppennameLang,
      },
      create: {
        id: Number(row.PartyID),
        shortName: row.Gruppenname,
        longName: row.GruppennameLang,
      },
    });
  }
  console.log(`Loaded ${seenShortNames.size} unique parties (${rows.length} total rows)`);
}

async function loadConstituencies() {
  console.log('Loading constituencies...');
  const csvPath = path.join(__dirname, '..', '..', 'Bundestagswahl', 'outputs', 'wahlkreis.csv');
  const rows = readCsv<ConstituencyRow>(csvPath);
  
  for (const row of rows) {
    await prisma.constituency.upsert({
      where: { number: Number(row.Gebietsnummer) },
      update: {
        name: row.Gebietsname,
        stateId: row.GebietLandAbk,
      },
      create: {
        number: Number(row.Gebietsnummer),
        name: row.Gebietsname,
        stateId: row.GebietLandAbk,
      },
    });
  }
  console.log(`Loaded ${rows.length} constituencies`);
}

async function loadCandidates() {
  console.log('Loading candidates...');
  const csvPath = path.join(__dirname, '..', '..', 'Bundestagswahl', 'outputs', 'candidates.csv');
  const rows = readCsv<CandidateRow>(csvPath);
  
  // Clear existing candidates
  await prisma.candidate.deleteMany({});
  
  let count = 0;
  for (const row of rows) {
    try {
      await prisma.candidate.create({
        data: {
          title: row.Titel || null,
          nameAddition: row.Namenszusatz || null,
          lastName: row.Nachname,
          firstName: row.Vornamen,
          artistName: row.Künstlername || null,
          gender: row.Geschlecht || null,
          birthYear: parseInt(row.Geburtsjahr),
          postalCode: row.PLZ || null,
          city: row.Wohnort || null,
          cityStateAbbr: row.WohnortLandAbk || null,
          birthPlace: row.Geburtsort || null,
          nationality: row.Staatsangehörigkeit || null,
          profession: row.Beruf || null,
          stateId: row.GebietLandAbk,
          partyShortName: row.GruppennameKurz || null,
          listPosition: parseFloat(row.Listenplatz),
          constituencyNum: parseInt(row.Wahlkreis),
          stateName: row.State || null,
          firstVotes: parseFloat(row.Erststimmen),
        },
      });
      count++;
      if (count % 500 === 0) {
        console.log(`  Loaded ${count} candidates...`);
      }
    } catch (error) {
      console.error(`Error loading candidate ${row.Vornamen} ${row.Nachname}:`, error);
    }
  }
  console.log(`Loaded ${count} candidates`);
}

async function loadStateParties() {
  console.log('Loading state parties...');
  const csvPath = path.join(__dirname, '..', '..', 'Bundestagswahl', 'outputs', 'state_parties.csv');
  const rows = readCsv<StatePartyRow>(csvPath);
  
  // Clear existing state parties
  await prisma.stateParty.deleteMany({});
  
  for (const row of rows) {
    try {
      await prisma.stateParty.create({
        data: {
          stateId: row.GebietLandAbk,
          partyShortName: row.GruppennameKurz,
          secondVotes: parseFloat(row.Anzahl) || 0,
        },
      });
    } catch (error) {
      console.error(`Error loading state party ${row.GebietLandAbk} - ${row.GruppennameKurz}:`, error);
    }
  }
  console.log(`Loaded ${rows.length} state party records`);
}

async function main() {
  try {
    console.log('Starting CSV data import...\n');
    
    await loadStates();
    await loadParties();
    await loadConstituencies();
    await loadCandidates();
    await loadStateParties();
    
    console.log('\n✅ All CSV data loaded successfully!');
  } catch (error) {
    console.error('Error loading CSV data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
