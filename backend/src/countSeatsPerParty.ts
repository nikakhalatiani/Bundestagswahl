import type { CalculateSeatsResult, SeatAllocationRow } from './types/seats';

const calculateSeatsFunc: (year?: number) => Promise<CalculateSeatsResult> = require('./calculateSeats');

interface SeatCounts {
  party_id: number | string;
  party_name: string;
  seats: number;
}

export default async function countSeatsPerParty(year: number = 2025): Promise<SeatCounts[]> {
  try {
    const res = await calculateSeatsFunc(year);
    const rows: SeatAllocationRow[] = res.seatAllocation || [];

    const counts: Record<string, { party_id: number | string; party_name: string; seats: number }> = {};

    for (const r of rows) {
      if (r.party_id == null || r.party_name == null) {
        throw new Error(`Invalid seat allocation row: missing party_id or party_name: ${JSON.stringify(r)}`);
      }

      const pid: number | string = r.party_id;
      const pname: string = r.party_name;
      const key = `${pid}::${pname}`;
      if (!counts[key]) counts[key] = { party_id: pid, party_name: pname, seats: 0 };
      counts[key].seats += 1;
    }

    const out = Object.values(counts)
      .map(c => ({ party_id: c.party_id, party_name: c.party_name, seats: c.seats }))
      .sort((a, b) => b.seats - a.seats);

    return out;
  } catch (err) {
    console.error('Error counting seats per party:', err);
    throw err;
  }
}
