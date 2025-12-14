// npx ts-node src/countSeatsPerParty.ts

const calculateSeats = require('./calculateSeats');

(async () => {
  try {
    const res = await calculateSeats(2025);
    const rows = res.seatAllocation || [];

    const counts: Record<string, { party_id: number | null; party_name: string | null; seats: number }> = {};

    for (const r of rows) {
      const pid = r.party_id ?? 'no_party';
      const pname = r.party_name ?? 'Independent';
      const key = `${pid}::${pname}`;
      if (!counts[key]) counts[key] = { party_id: pid, party_name: pname, seats: 0 };
      counts[key].seats += 1;
    }

    const out = Object.values(counts).sort((a, b) => b.seats - a.seats);
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error counting seats per party:', err);
    process.exit(1);
  }
})();
