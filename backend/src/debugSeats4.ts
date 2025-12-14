// npx ts-node src/debugSeats4.ts
// Run the exact seatAllocationQuery and check output

import dbModule from './db';
const pool = (dbModule as any).pool || (dbModule as any).default?.pool;

async function debugSeats4(year: number = 2025) {
  console.log(`\n=== DEBUG PART 4: Run actual seatAllocationQuery ===\n`);

  const calculateSeats = require('./calculateSeats');
  const results = await calculateSeats(year);
  
  // Count seats per party from seatAllocation
  const seatAllocation = results.seatAllocation || [];
  console.log(`Total rows in seatAllocation: ${seatAllocation.length}`);
  
  // Group by party
  const partySeats: Record<string, number> = {};
  const partyTypes: Record<string, { direkt: number; list: number; other: number }> = {};
  
  for (const row of seatAllocation) {
    const name = row.party_name || 'Unknown';
    partySeats[name] = (partySeats[name] || 0) + 1;
    
    if (!partyTypes[name]) {
      partyTypes[name] = { direkt: 0, list: 0, other: 0 };
    }
    
    const typ = row.sitz_typ || '';
    if (typ === 'Direktmandat') {
      partyTypes[name].direkt++;
    } else if (typ === 'Listensitz') {
      partyTypes[name].list++;
    } else {
      partyTypes[name].other++;
    }
  }
  
  console.log('\n--- Seat counts per party ---');
  const sorted = Object.entries(partySeats).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    const types = partyTypes[name];
    console.log(`${name}: ${count} (Direkt: ${types.direkt}, List: ${types.list}, Other: ${types.other})`);
  }
  
  // Check if GRÜNE is in there
  console.log('\n--- Sample GRÜNE rows (if any) ---');
  const grueneRows = seatAllocation.filter((r: any) => 
    r.party_name && r.party_name.includes('GRÜN')
  );
  console.log(`Found ${grueneRows.length} GRÜNE rows`);
  if (grueneRows.length > 0) {
    console.log('First 5 GRÜNE rows:');
    console.table(grueneRows.slice(0, 5));
  }
  
  // Check what sitz_typ values exist
  console.log('\n--- All sitz_typ values ---');
  const sitzTypes = new Set(seatAllocation.map((r: any) => r.sitz_typ));
  console.log([...sitzTypes]);

  // Check total sum
  const total = Object.values(partySeats).reduce((a, b) => a + b, 0);
  console.log(`\nTotal seats allocated: ${total}`);
  
  process.exit(0);
}

debugSeats4(2025).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
