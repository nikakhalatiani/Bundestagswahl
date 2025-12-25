export type PgInt = number | string;
export type PgNumeric = number | string;

export interface SeatAllocationRow {
  person_id: PgInt;
  party_id: PgInt;
  state_id: PgInt;
  party_name?: string;
  state_name?: string;
  seat_type: string;
  constituency: string | null;
  list_position: PgInt | null;
  percent_first_votes: PgNumeric | null;
}

export interface PartySummaryRow {
  party: string;
  second_votes: PgNumeric;
  percent_second_votes: PgNumeric;
  direct_mandates: PgInt;
  minority_party: boolean;
  in_bundestag: boolean;
}

export interface FederalDistributionRow {
  party: string;
  seats: PgInt;
}

export interface StateDistributionRow {
  party: string;
  state: string;
  seats: PgInt;
}

export interface CalculateSeatsResult {
  seatAllocation: SeatAllocationRow[];
  summary: PartySummaryRow[];
  federalDistribution: FederalDistributionRow[];
  stateDistribution: StateDistributionRow[];
}
