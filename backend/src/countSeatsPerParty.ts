const calculateSeatsFunc = require('./calculateSeats');

interface SeatCounts {
  party_id: number | string;
  party_name: string;
  direct_mandates: number;
  list_seats: number;
  other_seats: number;
  total_seats: number;
}

(async () => {
  try {
    const year = process.argv[2] ? parseInt(process.argv[2]) : 2025;
    console.log(`\n=== Seat Counts Per Party for ${year} ===\n`);

    const res = await calculateSeatsFunc(year);
    const rows = res.seatAllocation || [];

    const counts: Record<string, SeatCounts> = {};

    for (const r of rows) {
      const pid = r.party_id ?? 'no_party';
      const pname = r.party_name ?? 'Independent';
      const key = `${pid}::${pname}`;

      if (!counts[key]) {
        counts[key] = {
          party_id: pid,
          party_name: pname,
          direct_mandates: 0,
          list_seats: 0,
          other_seats: 0,
          total_seats: 0
        };
      }

      counts[key].total_seats += 1;

      const seatType = r.seat_type || '';
      if (seatType === 'Direct Mandate') {
        counts[key].direct_mandates += 1;
      } else if (seatType === 'List Seat') {
        counts[key].list_seats += 1;
      } else {
        counts[key].other_seats += 1;
      }
    }

    const out = Object.values(counts).sort((a, b) => b.total_seats - a.total_seats);

    console.table(out);
    console.log(`\nTotal Seats: ${rows.length}`);

    process.exit(0);
  } catch (err) {
    console.error('Error counting seats per party:', err);
    process.exit(1);
  }
})();
