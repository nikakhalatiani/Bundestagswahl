import { useQuery } from '@tanstack/react-query';
import type {
  ApiResponse,
  ClosestWinnerItem,
  ConstituenciesSingleItem,
  ConstituencyOverviewResponse,
  ConstituencyListItem,
  ConstituencyWinnerItem,
  ConstituencyVotesBulkItem,
  PartyStrengthItem,
  StructuralDataResponse,
  DirectWithoutCoverageResponse,
  MemberItem,
  NearMissesResponse,
  SeatDistributionItem,
  ElectionResultsResponse,
} from '../types/api';

const API_BASE = ''; // Use relative URLs with Vite proxy

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface ElectionResultsFilters {
  stateIds?: number[];
  mandateType?: 'direct' | 'list';
  gender?: 'm' | 'w';
  parties?: string[];
  status?: 'new' | 'reelected';
}

export function useElectionResults(
  year: number,
  type: 'first' | 'second' | 'seats' = 'second',
  filters?: ElectionResultsFilters
) {
  return useQuery({
    queryKey: ['electionResults', year, type, filters],
    queryFn: async () => {
      const params = new URLSearchParams({ year: String(year), type });
      if (filters?.stateIds?.length) params.set('state_ids', filters.stateIds.join(','));
      if (filters?.mandateType) params.set('mandate_type', filters.mandateType);
      if (filters?.gender) params.set('gender', filters.gender);
      if (filters?.parties?.length) params.set('parties', filters.parties.join(','));
      if (filters?.status) params.set('status', filters.status);
      return fetchJson<ElectionResultsResponse>(`${API_BASE}/api/election-results?${params.toString()}`);
    },
    placeholderData: (previous) => previous,
  });
}

export function useSeatDistribution(year: number) {
  return useQuery({
    queryKey: ['seatDistribution', year],
    queryFn: async () => {
      return fetchJson<ApiResponse<SeatDistributionItem[]>>(`${API_BASE}/api/seats?year=${year}`);
    },
  });
}

export function useMembers(year: number) {
  return useQuery({
    queryKey: ['members', year],
    queryFn: async () => {
      return fetchJson<ApiResponse<MemberItem[]>>(`${API_BASE}/api/members?year=${year}`);
    },
  });
}

export function useConstituencyOverview(constituencyId: number, year: number) {
  return useQuery({
    queryKey: ['constituencyOverview', constituencyId, year],
    queryFn: async () => {
      return fetchJson<ConstituencyOverviewResponse>(`${API_BASE}/api/constituency/${constituencyId}/overview?year=${year}`);
    },
    enabled: constituencyId > 0,
  });
}

export function useConstituencyWinners(year: number, stateId?: number) {
  return useQuery({
    queryKey: ['constituencyWinners', year, stateId],
    queryFn: async () => {
      const url = stateId
        ? `${API_BASE}/api/constituency-winners?year=${year}&state_id=${stateId}`
        : `${API_BASE}/api/constituency-winners?year=${year}`;
      return fetchJson<ApiResponse<ConstituencyWinnerItem[]>>(url);
    },
  });
}

export function useDirectWithoutCoverage(year: number) {
  return useQuery({
    queryKey: ['directWithoutCoverage', year],
    queryFn: async () => {
      return fetchJson<DirectWithoutCoverageResponse>(`${API_BASE}/api/direct-without-coverage?year=${year}`);
    },
  });
}

export function useClosestWinners(year: number, limit: number = 10) {
  return useQuery({
    queryKey: ['closestWinners', year, limit],
    queryFn: async () => {
      return fetchJson<ApiResponse<ClosestWinnerItem[]>>(`${API_BASE}/api/closest-winners?year=${year}&limit=${limit}`);
    },
  });
}

export function useNearMisses(year: number, limit: number = 5) {
  return useQuery({
    queryKey: ['nearMisses', year, limit],
    queryFn: async () => {
      return fetchJson<NearMissesResponse>(`${API_BASE}/api/near-misses?year=${year}&limit=${limit}`);
    },
  });
}

export function useConstituenciesSingle(year: number, ids?: string) {
  return useQuery({
    queryKey: ['constituenciesSingle', year, ids],
    queryFn: async () => {
      const url = ids
        ? `${API_BASE}/api/constituencies-single?year=${year}&ids=${ids}`
        : `${API_BASE}/api/constituencies-single?year=${year}`;
      return fetchJson<{ data: ConstituenciesSingleItem[] }>(url);
    },
  });
}

export function useConstituencyList(year: number) {
  return useQuery({
    queryKey: ['constituencies', year],
    queryFn: async () => {
      return fetchJson<ApiResponse<ConstituencyListItem[]>>(`${API_BASE}/api/constituencies?year=${year}`);
    },
  });
}

// Bulk vote distribution for map tooltips and coloring
export function useConstituencyVotesBulk(year: number) {
  return useQuery({
    queryKey: ['constituencyVotesBulk', year],
    queryFn: async () => {
      return fetchJson<ApiResponse<ConstituencyVotesBulkItem[]>>(`${API_BASE}/api/constituency-votes-bulk?year=${year}`);
    },
  });
}

export function usePartyConstituencyStrength(
  year: number,
  party?: string,
  voteType: 1 | 2 = 2
) {
  return useQuery({
    queryKey: ['partyStrength', year, party, voteType],
    queryFn: async () => {
      const partyValue = party ?? '';
      const params = new URLSearchParams({
        year: String(year),
        party: partyValue,
        vote_type: String(voteType),
      });
      return fetchJson<ApiResponse<PartyStrengthItem[]>>(`${API_BASE}/api/party-constituency-strength?${params.toString()}`);
    },
    enabled: Boolean(party),
  });
}

export function useStructuralData(year: number) {
  return useQuery({
    queryKey: ['structuralData', year],
    queryFn: async () => {
      return fetchJson<StructuralDataResponse>(`${API_BASE}/api/structural-data?year=${year}`);
    },
  });
}
