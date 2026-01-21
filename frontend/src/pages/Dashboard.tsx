import { useMemo, useState } from 'react';
import { Briefcase, MapPin, Percent, User, ListOrdered, ChevronDown, ChevronUp, Search, BarChart3, Users, TrendingUp, TrendingDown, Minus, UserPlus } from 'lucide-react';
import { useMembers, useSeatDistribution, useElectionResults, type ElectionResultsFilters } from '../hooks/useQueries';
import type { SeatDistributionItem } from '../types/api';
import { Hemicycle, type Seat } from '../components/parliament/Hemicycle';
import { PieChart } from '../components/parliament/PieChart';
import { getPartyColor, getPartyDisplayName } from '../utils/party';
import { cn } from '../utils/cn';
import { Card, CardHeader, CardSubtitle, CardTitle } from '../components/ui/Card';
import { PartyBadge } from '../components/ui/PartyBadge';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../components/ui/Table';

const COALITION_DESCRIPTIONS: Record<string, string> = {
  'Grand Coalition': 'A coalition of the two largest parties, typically CDU/CSU and SPD. Historically the most common coalition in Germany.',
  'Traffic Light (Ampel)': 'A coalition of SPD (Red), FDP (Yellow), and Greens. First formed at the federal level in 2021.',
  'Jamaica': 'A coalition of CDU/CSU (Black), Greens, and FDP (Yellow). Named after the colors of the Jamaican flag.',
  'Kenya': 'A coalition of CDU/CSU (Black), SPD (Red), and Greens. Named after the colors of the Kenyan flag.',
  'Red-Green-Red': 'A left-wing coalition of SPD, Greens, and Die Linke.',
};

interface DashboardProps {
  year: number;
}

export function Dashboard({ year }: DashboardProps) {
  const { data, isLoading, error } = useSeatDistribution(year);
  const { data: membersRes, isLoading: isMembersLoading, error: membersError } = useMembers(year);

  const [comparisonMode, setComparisonMode] = useState<'first' | 'second' | 'seats'>('second');
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [selectedParties, setSelectedParties] = useState<Set<string>>(new Set());
  const [expandedCoalition, setExpandedCoalition] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [lameMode, setLameMode] = useState(false);

  // Filter states
  const [mandateFilter, setMandateFilter] = useState<'all' | 'direct' | 'list'>('all');
  const [genderFilter, setGenderFilter] = useState<'all' | 'm' | 'w'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'reelected'>('all');
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());

  // Toggle functions for multi-select
  const toggleParty = (party: string) => {
    setSelectedParties(prev => {
      const next = new Set(prev);
      if (next.has(party)) {
        next.delete(party);
      } else {
        next.add(party);
      }
      return next;
    });
  };

  const toggleState = (state: string) => {
    setSelectedStates(prev => {
      const next = new Set(prev);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
  };

  // Map state name → state_id from members data
  const stateNameToId = useMemo(() => {
    const map = new Map<string, number>();
    membersRes?.data?.forEach(m => {
      if (m.state_name && m.state_id) {
        map.set(m.state_name, m.state_id);
      }
    });
    return map;
  }, [membersRes?.data]);

  // Build election results filters from current filter state
  const electionResultsFilters = useMemo<ElectionResultsFilters>(() => {
    const filters: ElectionResultsFilters = {};
    if (selectedStates.size > 0) {
      filters.stateIds = Array.from(selectedStates)
        .map(name => stateNameToId.get(name))
        .filter((id): id is number => id !== undefined);
    }
    if (mandateFilter !== 'all') {
      filters.mandateType = mandateFilter;
    }
    if (genderFilter !== 'all') {
      filters.gender = genderFilter;
    }
    if (selectedParties.size > 0) {
      filters.parties = Array.from(selectedParties);
    }
    if (statusFilter !== 'all') {
      filters.status = statusFilter;
    }
    return filters;
  }, [selectedStates, stateNameToId, mandateFilter, genderFilter, selectedParties, statusFilter]);

  const { data: resultsData } = useElectionResults(year, comparisonMode, electionResultsFilters);

  const partyOpts = useMemo(() => ({ combineCduCsu: true }), []);

  const items: SeatDistributionItem[] = data?.data ?? [];

  const combinedItems = useMemo(() => {
    const combinedMap = new Map<string, { party_name: string; seats: number }>();
    for (const party of items) {
      const displayName = getPartyDisplayName(party.party_name, partyOpts);
      const existing = combinedMap.get(displayName);
      if (existing) {
        existing.seats += party.seats;
      } else {
        combinedMap.set(displayName, { party_name: displayName, seats: party.seats });
      }
    }
    return Array.from(combinedMap.values()).sort((a, b) => b.seats - a.seats);
  }, [items, partyOpts]);

  const totalSeats = useMemo(() => {
    return combinedItems.reduce((sum, p) => sum + p.seats, 0);
  }, [combinedItems]);

  const seats: Seat[] = useMemo(() => {
    const members = membersRes?.data ?? [];
    return members.map((m) => ({
      id: `${year}-${m.person_id}`,
      party: m.party_name,
      seatType: m.seat_type.toLowerCase().includes('direct') ? 'direct' : 'list',
      memberName: `${m.title ? `${m.title} ` : ''}${m.first_name} ${m.last_name}`,
      region: m.state_name,
      constituency: m.constituency_name || undefined,
      percentage: m.percent_first_votes ?? undefined,
      listPosition: m.list_position ?? undefined,
      profession: m.profession || undefined,
      birthYear: m.birth_year || undefined,
      gender: m.gender || undefined,
      previouslyElected: m.previously_elected,
    }));
  }, [membersRes?.data, year]);

  const selectedSeat = useMemo(() => {
    return seats.find((s) => s.id === selectedSeatId) ?? null;
  }, [seats, selectedSeatId]);

  const selectedPartyLabel = useMemo(() => {
    return selectedSeat ? getPartyDisplayName(selectedSeat.party, partyOpts) : '';
  }, [selectedSeat, partyOpts]);

  // Combined filter function used by Hemicycle and Demographics
  const seatPassesFilters = useMemo(() => {
    const hasActiveFilter =
      selectedParties.size > 0 ||
      mandateFilter !== 'all' ||
      genderFilter !== 'all' ||
      statusFilter !== 'all' ||
      selectedStates.size > 0;

    if (!hasActiveFilter) return undefined; // No filter active → show all

    return (s: Seat) => {
      // Party filter (multi-select)
      if (selectedParties.size > 0) {
        const displayName = getPartyDisplayName(s.party, partyOpts);
        if (!selectedParties.has(displayName)) return false;
      }
      // Mandate type filter
      if (mandateFilter !== 'all' && s.seatType !== mandateFilter) return false;
      // Gender filter
      if (genderFilter !== 'all' && s.gender?.toLowerCase() !== genderFilter) return false;
      // Status filter
      if (statusFilter === 'new' && s.previouslyElected) return false;
      if (statusFilter === 'reelected' && !s.previouslyElected) return false;
      // State filter (multi-select)
      if (selectedStates.size > 0 && (!s.region || !selectedStates.has(s.region))) return false;
      return true;
    };
  }, [selectedParties, mandateFilter, genderFilter, statusFilter, selectedStates, partyOpts]);

  // Seats that pass all filters (for demographics and counts)
  const filteredSeats = useMemo(() => {
    if (!seatPassesFilters) return seats;
    return seats.filter(seatPassesFilters);
  }, [seats, seatPassesFilters]);

  const searchResults = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return [];
    return seats.filter(s =>
      s.memberName.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 8);
  }, [seats, searchTerm]);

  const demographics = useMemo(() => {
    if (filteredSeats.length === 0) return null;

    let totalAge = 0;
    let ageCount = 0;
    const genderCounts: Record<string, number> = { m: 0, w: 0, d: 0 };
    const professions: Record<string, number> = {};

    filteredSeats.forEach(s => {
      if (s.birthYear) {
        totalAge += (year - s.birthYear);
        ageCount++;
      }
      if (s.gender) {
        const g = s.gender.toLowerCase();
        genderCounts[g] = (genderCounts[g] || 0) + 1;
      }
      if (s.profession) {
        professions[s.profession] = (professions[s.profession] || 0) + 1;
      }
    });

    const avgAge = ageCount > 0 ? (totalAge / ageCount).toFixed(1) : 'N/A';
    const totalGender = (genderCounts.m || 0) + (genderCounts.w || 0) + (genderCounts.d || 0);
    const femalePercent = totalGender > 0 ? ((genderCounts.w || 0) / totalGender * 100).toFixed(1) : '0';

    const topProfessions = Object.entries(professions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return { avgAge, genderCounts, femalePercent, topProfessions };
  }, [filteredSeats, year]);

  // State distribution from ALL seats (for display, not filtering)
  const allStateDistribution = useMemo(() => {
    const dist: Record<string, { total: number; direct: number; list: number }> = {};
    seats.forEach(s => {
      if (!s.region) return;
      if (!dist[s.region]) dist[s.region] = { total: 0, direct: 0, list: 0 };
      dist[s.region].total++;
      if (s.seatType === 'direct') dist[s.region].direct++;
      else dist[s.region].list++;
    });
    return Object.entries(dist)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [seats]);

  // State distribution from filtered seats (for counts when filters active)
  const stateDistribution = useMemo(() => {
    const dist: Record<string, { total: number; direct: number; list: number }> = {};
    filteredSeats.forEach(s => {
      if (!s.region) return;
      if (!dist[s.region]) dist[s.region] = { total: 0, direct: 0, list: 0 };
      dist[s.region].total++;
      if (s.seatType === 'direct') dist[s.region].direct++;
      else dist[s.region].list++;
    });
    return Object.entries(dist)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [filteredSeats]);

  // Filtered seat distribution for PieChart (computed from filteredSeats)
  const filteredCombinedItems = useMemo(() => {
    const combinedMap = new Map<string, { party_name: string; seats: number }>();
    for (const seat of filteredSeats) {
      const displayName = getPartyDisplayName(seat.party, partyOpts);
      const existing = combinedMap.get(displayName);
      if (existing) {
        existing.seats += 1;
      } else {
        combinedMap.set(displayName, { party_name: displayName, seats: 1 });
      }
    }
    return Array.from(combinedMap.values()).sort((a, b) => b.seats - a.seats);
  }, [filteredSeats, partyOpts]);

  // Party mandate breakdown (direct vs list per party)
  const partyMandateBreakdown = useMemo(() => {
    const breakdown: Record<string, { direct: number; list: number }> = {};
    seats.forEach(s => {
      const displayName = getPartyDisplayName(s.party, partyOpts);
      if (!breakdown[displayName]) breakdown[displayName] = { direct: 0, list: 0 };
      if (s.seatType === 'direct') breakdown[displayName].direct++;
      else breakdown[displayName].list++;
    });
    return breakdown;
  }, [seats, partyOpts]);

  // Quick stats (based on filtered seats)
  const quickStats = useMemo(() => {
    if (filteredSeats.length === 0) return null;

    const seatsWithAge = filteredSeats.filter(s => s.birthYear);
    const youngest = seatsWithAge.length > 0
      ? seatsWithAge.reduce((min, s) => (s.birthYear! > min.birthYear! ? s : min))
      : null;
    const oldest = seatsWithAge.length > 0
      ? seatsWithAge.reduce((max, s) => (s.birthYear! < max.birthYear! ? s : max))
      : null;

    const directCount = filteredSeats.filter(s => s.seatType === 'direct').length;
    const listCount = filteredSeats.filter(s => s.seatType === 'list').length;
    const newMemberCount = filteredSeats.filter(s => !s.previouslyElected).length;
    const reelectedCount = filteredSeats.filter(s => s.previouslyElected).length;

    // Most represented state
    const stateCounts: Record<string, number> = {};
    filteredSeats.forEach(s => {
      if (s.region) stateCounts[s.region] = (stateCounts[s.region] || 0) + 1;
    });
    const topState = Object.entries(stateCounts).sort((a, b) => b[1] - a[1])[0];

    return {
      youngest,
      oldest,
      directCount,
      listCount,
      newMemberCount,
      reelectedCount,
      topState: topState ? { name: topState[0], count: topState[1] } : null,
    };
  }, [filteredSeats]);

  // Age distribution (brackets)
  const ageDistribution = useMemo(() => {
    const brackets: Record<string, number> = {
      '18-29': 0,
      '30-39': 0,
      '40-49': 0,
      '50-59': 0,
      '60-69': 0,
      '70+': 0,
    };
    filteredSeats.forEach(s => {
      if (!s.birthYear) return;
      const age = year - s.birthYear;
      if (age < 30) brackets['18-29']++;
      else if (age < 40) brackets['30-39']++;
      else if (age < 50) brackets['40-49']++;
      else if (age < 60) brackets['50-59']++;
      else if (age < 70) brackets['60-69']++;
      else brackets['70+']++;
    });
    return Object.entries(brackets).map(([range, count]) => ({ range, count }));
  }, [filteredSeats, year]);

  const possibleCoalitions = useMemo(() => {
    if (totalSeats === 0) return [];
    const majority = Math.floor(totalSeats / 2) + 1;

    const coalitions = [
      { name: 'Grand Coalition', parties: ['CDU/CSU', 'SPD'] },
      { name: 'Traffic Light (Ampel)', parties: ['SPD', 'GRÜNE', 'FDP'] },
      { name: 'Jamaica', parties: ['CDU/CSU', 'GRÜNE', 'FDP'] },
      { name: 'Kenya', parties: ['CDU/CSU', 'SPD', 'GRÜNE'] },
      { name: 'Red-Green-Red', parties: ['SPD', 'GRÜNE', 'DIE LINKE'] },
    ];

    return coalitions.map(c => {
      let totalSeatsInCoalition = 0;
      let strongestParty = { name: '', seats: -1 };

      c.parties.forEach(pName => {
        const party = combinedItems.find(item => item.party_name === pName);
        const seats = party ? party.seats : 0;
        totalSeatsInCoalition += seats;
        if (seats > strongestParty.seats) {
          strongestParty = { name: pName, seats };
        }
      });

      return {
        ...c,
        seats: totalSeatsInCoalition,
        isMajority: totalSeatsInCoalition >= majority,
        strongestParty: strongestParty.name
      };
    }).filter(c => c.isMajority).sort((a, b) => b.seats - a.seats);
  }, [combinedItems, totalSeats]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center px-8 py-16">
        <div className="h-[50px] w-[50px] animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-surface-accent border-t-brand-black"></div>
        <div className="mt-4 font-medium text-ink-muted">Loading seat distribution...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border-2 border-[#d00] bg-[#fee] p-6 font-medium text-[#d00]">
        Failed to load data: {String(error)}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border-2 border-[#d00] bg-[#fee] p-6 font-medium text-[#d00]">
        No data returned.
      </div>
    );
  }

  const filterSelectClass = `appearance-none rounded-md border border-line bg-surface-muted px-3 py-2 pr-8 text-[0.9rem] text-ink transition hover:border-ink-faint hover:bg-surface-accent focus:border-ink focus:outline-none focus:ring-2 focus:ring-black/5 bg-[url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e")] bg-no-repeat bg-[right_0.5rem_center] bg-[length:0.9em]`;

  return (
    <div className="flex flex-col gap-6">
      {/* State Distribution - above main card */}
      {allStateDistribution.length > 0 && (
        <Card className="p-0">
          <div className="border-b border-line px-4 py-3">
            <div className="text-xl font-bold text-ink">Seats by Federal State</div>
            <div className="text-sm text-ink-muted">Click to filter (multi-select)</div>
          </div>
          <div className="px-4 py-3">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
              {allStateDistribution.map(state => {
                const isSelected = selectedStates.has(state.name);
                const isGreyedOut = selectedStates.size > 0 && !isSelected;
                const maxTotal = Math.max(...allStateDistribution.map(s => s.total), 1);
                const widthPct = (state.total / maxTotal) * 100;
                const directPct = (state.direct / state.total) * widthPct;
                const listPct = (state.list / state.total) * widthPct;
                return (
                  <div
                    key={state.name}
                    onClick={() => toggleState(state.name)}
                    className={cn(
                      'cursor-pointer rounded border border-line px-2.5 py-1.5 transition',
                      isSelected && 'border-2 border-ink bg-surface-accent',
                      isGreyedOut && 'opacity-[0.4] hover:opacity-[0.7]'
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium">{state.name}</span>
                      <span className="text-[0.8rem] font-semibold">{state.total}</span>
                    </div>
                    <div className="flex h-1 overflow-hidden rounded-full bg-surface" title={`${state.direct} direct, ${state.list} list`}>
                      <div className="rounded-full rounded-r-none bg-[#4caf50]" style={{ width: `${directPct}%` }} />
                      <div className="rounded-full rounded-l-none bg-[#2196f3]" style={{ width: `${listPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Seat distribution in the Bundestag {year}</CardTitle>
            <CardSubtitle>Total seats: {totalSeats}</CardSubtitle>
          </div>
          <button
            className="ml-auto flex items-center gap-2 rounded-full border border-line bg-surface-muted px-2 py-1.5 transition hover:border-ink-muted"
            onClick={() => setLameMode(!lameMode)}
            title={lameMode ? 'Switch to Hemicycle view' : 'Switch to Pie Chart view'}
            type="button"
          >
            <span className={cn('text-[0.75rem] font-semibold text-ink-faint', !lameMode && 'text-ink')}>Hemicycle</span>
            <span className="relative h-[18px] w-8 rounded-full bg-surface-accent transition">
              <span className={cn('absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-brand-black transition-[left]', lameMode && 'left-4')} />
            </span>
            <span className={cn('text-[0.75rem] font-semibold text-ink-faint', lameMode && 'text-ink')}>Pie</span>
          </button>
        </CardHeader>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="relative mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <input
                    type="text"
                    placeholder="Search for a member..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full rounded-md border border-line bg-surface-muted px-3 py-2 pl-9 text-[0.9rem] transition focus:border-ink-faint focus:bg-surface focus:outline-none focus:ring-2 focus:ring-black/5"
                  />
                </div>

                {/* Filter dropdowns */}
                <select
                  value={mandateFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'all' || val === 'direct' || val === 'list') setMandateFilter(val);
                  }}
                  className={filterSelectClass}
                  title="Filter by mandate type"
                >
                  <option value="all">All Mandates</option>
                  <option value="direct">Direct Only</option>
                  <option value="list">List Only</option>
                </select>

                <select
                  value={genderFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'all' || val === 'm' || val === 'w') setGenderFilter(val);
                  }}
                  className={filterSelectClass}
                  title="Filter by gender"
                >
                  <option value="all">All Genders</option>
                  <option value="m">Male</option>
                  <option value="w">Female</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'all' || val === 'new' || val === 'reelected') setStatusFilter(val);
                  }}
                  className={filterSelectClass}
                  title="Filter by member status"
                >
                  <option value="all">All Members</option>
                  <option value="new">New Members</option>
                  <option value="reelected">Re-elected</option>
                </select>
              </div>

              {/* Filter summary */}
              {seatPassesFilters && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-surface-accent px-3 py-2 text-[0.85rem] text-ink-muted">
                  <div className="flex items-center gap-2">
                    <Users size={14} />
                    <span>
                      <strong className="text-ink">{filteredSeats.length}</strong> of {seats.length} members match filters
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedParties(new Set());
                      setMandateFilter('all');
                      setGenderFilter('all');
                      setStatusFilter('all');
                      setSelectedStates(new Set());
                    }}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-[0.8rem] font-semibold text-ink-muted transition hover:bg-black/5 hover:text-ink"
                    title="Clear all filters"
                    type="button"
                  >
                    ✕ Clear
                  </button>
                </div>
              )}
              {searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-[300px] overflow-y-auto rounded-md border border-line bg-surface shadow-md">
                  {searchResults.map(s => (
                    <div
                      key={s.id}
                      onClick={() => {
                        setSelectedSeatId(s.id);
                        setSearchTerm('');
                      }}
                      className="flex cursor-pointer items-center justify-between border-b border-surface-accent px-4 py-3 hover:bg-surface-muted"
                    >
                      <div>
                        <div className="font-medium">{s.memberName}</div>
                        <div className="text-[0.8rem] text-ink-muted">{s.party} • {s.region}</div>
                      </div>
                      <div className="h-2.5 w-2.5 rounded-full" style={{ background: getPartyColor(s.party, partyOpts) }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="h-[440px]">
              {isMembersLoading ? (
                <div className="flex flex-col items-center justify-center px-8 py-16">
                  <div className="h-[50px] w-[50px] animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-surface-accent border-t-brand-black"></div>
                  <div className="mt-4 font-medium text-ink-muted">Loading members…</div>
                </div>
              ) : membersError ? (
                <div className="rounded border-l-4 border-[#ff9800] bg-[#fff3e0] p-4">
                  <div className="mb-2 font-semibold text-[#f57c00]">Visualization unavailable</div>
                  <div>Could not load members: {String(membersError)}</div>
                </div>
              ) : lameMode ? (
                <PieChart
                  data={seatPassesFilters ? filteredCombinedItems : combinedItems}
                  size={400}
                  combineCduCsu={true}
                  animateKey={`pie-${lameMode ? 'on' : 'off'}`}
                  selectedParties={selectedParties}
                  onToggleParty={toggleParty}
                />
              ) : (
                <Hemicycle
                  seats={seats}
                  height={400}
                  combineCduCsu={true}
                  selectedSeatId={selectedSeatId}
                  onSelectSeatId={setSelectedSeatId}
                  seatFilter={seatPassesFilters}
                />
              )}
            </div>
          </div>

          <div>
            <div className="flex min-h-[420px] flex-col overflow-hidden rounded-[10px] border border-line bg-surface shadow-md">
              {selectedSeat ? (
                <>
                  <div className="flex items-center justify-between border-b border-line bg-surface-muted p-4">
                    <div className="flex items-center gap-3">
                      <div className="text-[1.1rem] font-extrabold text-ink">
                        {selectedSeat.memberName}
                      </div>
                      <PartyBadge party={selectedPartyLabel} combineCduCsu>
                        {selectedPartyLabel}
                      </PartyBadge>
                    </div>
                    <button className="rounded-md px-2 py-1 text-ink-muted transition hover:text-ink" onClick={() => setSelectedSeatId(null)} type="button">
                      ✕
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="mb-6 flex flex-wrap gap-2">
                      <span
                        className={cn(
                          'inline-block rounded px-2 py-1 text-[0.75rem] font-semibold uppercase tracking-[0.5px] text-white',
                          selectedSeat.seatType === 'direct' ? 'bg-[#4caf50]' : 'bg-[#2196f3]'
                        )}
                      >
                        {selectedSeat.seatType === 'direct' ? 'Direct Mandate' : 'List Mandate'}
                      </span>
                      {selectedSeat.previouslyElected ? (
                        <span className="inline-block rounded px-2 py-1 text-[0.75rem] font-semibold uppercase tracking-[0.5px] text-white bg-[#9613a2]">
                          Re-elected
                        </span>
                      ) : (
                        <span className="inline-block rounded px-2 py-1 text-[0.75rem] font-semibold uppercase tracking-[0.5px] text-white bg-[#ff9800]">
                          New Member
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col gap-5">
                      <div className="flex items-start gap-3 text-ink-muted">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-accent text-ink-muted">
                          <MapPin size={18} />
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">Region / Constituency</div>
                          <div className="font-medium text-ink">{selectedSeat.constituency || selectedSeat.region}</div>
                        </div>
                      </div>

                      {selectedSeat.profession && (
                        <div className="flex items-start gap-3 text-ink-muted">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-accent text-ink-muted">
                            <Briefcase size={18} />
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">Profession</div>
                            <div className="font-medium text-ink">{selectedSeat.profession}</div>
                          </div>
                        </div>
                      )}

                      {(selectedSeat.birthYear || selectedSeat.gender) && (
                        <div className="flex items-start gap-3 text-ink-muted">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-accent text-ink-muted">
                            <User size={18} />
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">Personal Details</div>
                            <div className="font-medium text-ink">
                              {selectedSeat.gender ? `${selectedSeat.gender === 'm' ? 'Male' : selectedSeat.gender === 'w' ? 'Female' : selectedSeat.gender}` : ''}
                              {selectedSeat.gender && selectedSeat.birthYear ? ', ' : ''}
                              {selectedSeat.birthYear ? `${year - selectedSeat.birthYear} years old` : ''}
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedSeat.seatType === 'direct' && selectedSeat.percentage !== undefined ? (
                        <div className="flex items-start gap-3 text-ink-muted">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-accent text-ink-muted">
                            <Percent size={18} />
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">First Vote Share</div>
                            <div className="font-medium text-ink">{selectedSeat.percentage.toFixed(1)}%</div>
                          </div>
                        </div>
                      ) : selectedSeat.listPosition !== undefined ? (
                        <div className="flex items-start gap-3 text-ink-muted">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-accent text-ink-muted">
                            <ListOrdered size={18} />
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">List Position</div>
                            <div className="font-medium text-ink">{selectedSeat.listPosition}</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 overflow-y-auto p-0">
                  <Table variant="party">
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Party</TableHeaderCell>
                        <TableHeaderCell className="text-right">Seats</TableHeaderCell>
                        <TableHeaderCell className="text-center text-[0.75rem]" title="Direct / List mandates">D / L</TableHeaderCell>
                        <TableHeaderCell className="text-right">Share</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {combinedItems.map((party) => {
                        const isSelected = selectedParties.has(party.party_name);
                        const color = getPartyColor(party.party_name, partyOpts);
                        const breakdown = partyMandateBreakdown[party.party_name] || { direct: 0, list: 0 };
                        return (
                          <TableRow
                            key={party.party_name}
                            className={cn(
                              'cursor-pointer transition-colors hover:bg-surface-accent',
                              isSelected && 'bg-surface-accent'
                            )}
                            onClick={() => toggleParty(party.party_name)}
                            style={{
                              boxShadow: isSelected ? `inset 4px 0 0 ${color}` : 'none'
                            }}
                          >
                            <TableCell>
                              <PartyBadge party={party.party_name} combineCduCsu>
                                {party.party_name}
                              </PartyBadge>
                            </TableCell>
                            <TableCell className="text-right font-medium">{party.seats}</TableCell>
                            <TableCell className="text-center text-[0.8rem] text-ink-muted">
                              <span className="text-[#4caf50]">{breakdown.direct}</span>
                              {' / '}
                              <span className="text-[#2196f3]">{breakdown.list}</span>
                            </TableCell>
                            <TableCell className="text-right text-ink-muted">
                              {((party.seats / totalSeats) * 100).toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Quick Stats Row */}
      {quickStats && (
        <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-ink-muted">
              <MapPin size={20} />
            </div>
            <div className="flex flex-col">
              <div className="text-[1.1rem] font-bold leading-tight text-[#4caf50]">{quickStats.directCount}</div>
              <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">Direct Mandates</div>
            </div>
          </div>
          <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-ink-muted">
              <ListOrdered size={20} />
            </div>
            <div className="flex flex-col">
              <div className="text-[1.1rem] font-bold leading-tight text-[#2196f3]">{quickStats.listCount}</div>
              <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">List Mandates</div>
            </div>
          </div>
          <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-ink-muted">
              <UserPlus size={20} />
            </div>
            <div className="flex flex-col">
              <div className="text-[1.1rem] font-bold leading-tight text-[#ff9800]">{quickStats.newMemberCount}</div>
              <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">New Members</div>
            </div>
          </div>
          <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-ink-muted">
              <Users size={20} />
            </div>
            <div className="flex flex-col">
              <div className="text-[1.1rem] font-bold leading-tight text-[#9613a2]">{quickStats.reelectedCount}</div>
              <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">Re-elected</div>
            </div>
          </div>
          {quickStats.youngest && (
            <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-ink-muted">
                <User size={20} />
              </div>
              <div className="flex flex-col">
                <div className="text-[1.1rem] font-bold leading-tight text-ink">{quickStats.youngest.memberName.split(' ').slice(-1)[0]}</div>
                <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">Youngest ({year - quickStats.youngest.birthYear!}y)</div>
              </div>
            </div>
          )}
          {quickStats.oldest && (
            <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-ink-muted">
                <User size={20} />
              </div>
              <div className="flex flex-col">
                <div className="text-[1.1rem] font-bold leading-tight text-ink">{quickStats.oldest.memberName.split(' ').slice(-1)[0]}</div>
                <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">Oldest ({year - quickStats.oldest.birthYear!}y)</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Key Information</CardTitle>
          </CardHeader>
          <div className="text-ink leading-relaxed">
            <div>
              The German Bundestag has 630 seats. Seat allocation uses the Sainte-Laguë method based on second votes. After the 2023 electoral reform, there are no overhang mandates.
            </div>
          </div>

          {possibleCoalitions.length > 0 && (
            <div className="mt-6">
              <h4 className="mb-4 text-[1.1rem] font-semibold">
                Possible Coalitions (Majority &gt; {Math.floor(totalSeats / 2)})
              </h4>
              <div className="flex flex-col gap-4">
                {possibleCoalitions.map((c) => {
                  const isExpanded = expandedCoalition === c.name;
                  const seatPct = ((c.seats / totalSeats) * 100).toFixed(1);
                  return (
                    <div key={c.name} className="overflow-hidden rounded-lg border border-line">
                      <div
                        className={cn(
                          'flex cursor-pointer items-center gap-3 p-3 transition',
                          isExpanded ? 'bg-surface-accent' : 'bg-transparent'
                        )}
                        onClick={() => setExpandedCoalition(isExpanded ? null : c.name)}
                      >
                        <div className="flex gap-1">
                          {c.parties.map((p) => (
                            <div
                              key={p}
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: getPartyColor(p, partyOpts) }}
                              title={p}
                            />
                          ))}
                        </div>
                        <div className="flex-1 font-medium">{c.name}</div>
                        <div className="whitespace-nowrap font-semibold">
                          {c.seats} seats
                          <span className="ml-1 font-medium text-ink-muted">({seatPct}%)</span>
                        </div>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>

                      {isExpanded && (
                        <div className="border-t border-line bg-surface-muted p-3 text-[0.9rem]">
                          <div className="mb-2">
                            <strong>Possible Chancellor:</strong> Candidate from <span style={{ color: getPartyColor(c.strongestParty, partyOpts), fontWeight: 600 }}>{c.strongestParty}</span>
                          </div>
                          <div className="text-ink-muted">
                            {COALITION_DESCRIPTIONS[c.name] || 'A possible governing coalition.'}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {demographics && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Demographics</CardTitle>
            </CardHeader>

            <div className="flex flex-col gap-5">
              <div className="flex items-start gap-3 text-ink-muted">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-accent text-ink-muted">
                  <Users size={18} />
                </div>
                <div className="flex-1">
                  <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">Gender Balance</div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex h-2 flex-1 overflow-hidden rounded bg-[#eeeeee]">
                      <div className="bg-[#e91e63]" style={{ width: `${demographics.femalePercent}%` }} title="Female" />
                      <div className="flex-1 bg-[#2196f3]" title="Male" />
                    </div>
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-ink-muted">
                    <span>{demographics.femalePercent}% Female</span>
                    <span>{(100 - Number(demographics.femalePercent)).toFixed(1)}% Male</span>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 text-ink-muted">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-accent text-ink-muted">
                  <BarChart3 size={18} />
                </div>
                <div className="flex-1">
                  <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">Age Distribution</div>
                  <div className="mt-2 flex h-[50px] items-end gap-[2px]">
                    {ageDistribution.map(({ range, count }) => {
                      const maxCount = Math.max(...ageDistribution.map(a => a.count), 1);
                      const heightPx = Math.round((count / maxCount) * 46);
                      return (
                        <div
                          key={range}
                          className="flex flex-1 flex-col items-center justify-end"
                          title={`${range}: ${count} members`}
                        >
                          <div
                            className="w-full rounded-t-[2px] bg-ink-muted/70"
                            style={{ height: count > 0 ? `${heightPx}px` : '0px' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex gap-[2px]">
                    {ageDistribution.map(({ range }) => (
                      <div key={range} className="flex-1 text-center text-[0.65rem] text-ink-muted">{range}</div>
                    ))}
                  </div>
                  <div className="mt-2 text-[0.85rem] text-ink-muted">
                    Average: <strong className="text-ink">{demographics.avgAge}</strong> years
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs uppercase tracking-[0.5px] text-ink-muted">Top Professions</div>
                <div className="flex flex-col gap-2">
                  {demographics.topProfessions.map(([prof, count], i) => (
                    <div key={i} className="flex items-center justify-between rounded bg-surface-muted px-2 py-1.5">
                      <span className="max-w-[160px] truncate text-[0.8rem] text-ink">{prof || 'Unknown'}</span>
                      <span className="text-[0.75rem] font-semibold text-ink-faint">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {resultsData && (
        <Card className="mt-6">
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Election Results Comparison</CardTitle>
              <CardSubtitle>
                {comparisonMode === 'second' ? 'Second Votes' : comparisonMode === 'first' ? 'First Votes' : 'Seat Distribution'}: {year} vs {year === 2025 ? 2021 : 2017}
              </CardSubtitle>
            </div>
            <div>
              <select
                value={comparisonMode}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === 'seats' || next === 'first' || next === 'second') {
                    setComparisonMode(next);
                  }
                }}
                className={cn(filterSelectClass, 'min-w-[160px]')}
              >
                <option value="seats">Seats</option>
                <option value="first">First Votes</option>
                <option value="second">Second Votes</option>
              </select>
            </div>
          </CardHeader>

          {/* Empty state when no data for the selected filter combination */}
          {resultsData.data.length === 0 && (
            <div className="rounded-md bg-surface-muted px-4 py-3 text-sm text-ink-muted">
              No data for this filter combination. Try removing a state or party filter to see results.
            </div>
          )}

          {/* Summary Statistics */}
          {resultsData.data.length > 0 && (() => {
            const partiesGained = resultsData.data.filter(p => p.percentage > p.prevPercentage).length;
            const partiesLost = resultsData.data.filter(p => p.percentage < p.prevPercentage).length;
            const biggestWinner = resultsData.data.reduce((max, p) =>
              (p.percentage - p.prevPercentage) > (max.percentage - max.prevPercentage) ? p : max
            );
            const biggestLoser = resultsData.data.reduce((min, p) =>
              (p.percentage - p.prevPercentage) < (min.percentage - min.prevPercentage) ? p : min
            );
            const winnerChange = biggestWinner.percentage - biggestWinner.prevPercentage;
            const loserChange = biggestLoser.percentage - biggestLoser.prevPercentage;

            return (
              <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-accent px-3 py-2 text-[0.85rem] text-ink-muted">
                <div className="flex items-center gap-1">
                  <TrendingUp size={14} color="#2D8659" />
                  <span className="font-semibold text-[#2d8659]">{partiesGained}</span>
                  <span>gained</span>
                </div>
                <div className="flex items-center gap-1">
                  <TrendingDown size={14} color="#E3000F" />
                  <span className="font-semibold text-[#e3000f]">{partiesLost}</span>
                  <span>lost</span>
                </div>
                {winnerChange > 0 && (
                  <div className="flex items-center gap-1">
                    <span>Biggest gain:</span>
                    <span className="font-semibold" style={{ color: getPartyColor(biggestWinner.abbreviation, partyOpts) }}>
                      {biggestWinner.abbreviation}
                    </span>
                    <span className="font-semibold text-[#2d8659]">+{winnerChange.toFixed(1)}%</span>
                  </div>
                )}
                {loserChange < 0 && (
                  <div className="flex items-center gap-1">
                    <span>Biggest loss:</span>
                    <span className="font-semibold" style={{ color: getPartyColor(biggestLoser.abbreviation, partyOpts) }}>
                      {biggestLoser.abbreviation}
                    </span>
                    <span className="font-semibold text-[#e3000f]">{loserChange.toFixed(1)}%</span>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="py-4">
            {[...resultsData.data]
              .sort((a, b) => {
                const aVal = comparisonMode === 'seats' ? a.votes : a.percentage;
                const aPrev = comparisonMode === 'seats' ? a.prevVotes : a.prevPercentage;
                const bVal = comparisonMode === 'seats' ? b.votes : b.percentage;
                const bPrev = comparisonMode === 'seats' ? b.prevVotes : b.prevPercentage;
                return Math.max(bVal, bPrev) - Math.max(aVal, aPrev);
              })
              .slice(0, 8)
              .map((party) => {
                const change = party.percentage - party.prevPercentage;
                const color = getPartyColor(party.abbreviation, partyOpts);

                // Use raw count for seats (max ~300), percentage for votes (max ~35-40%)
                const value = comparisonMode === 'seats' ? party.votes : party.percentage;
                const prevValue = comparisonMode === 'seats' ? party.prevVotes : party.prevPercentage;
                const maxVal = comparisonMode === 'seats' ? 300 : 40;

                const widthPercent = (value / maxVal) * 100;
                const isSmall = widthPercent < 15;
                const displayValue = comparisonMode === 'seats' ? party.votes : `${party.percentage.toFixed(1)}%`;

                return (
                  <div key={party.abbreviation} className="mb-6">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-base font-bold">
                        {party.abbreviation}
                      </div>
                      <div className="flex items-center gap-2">
                        {change > 0 ? <TrendingUp size={16} color="#2D8659" /> : change < 0 ? <TrendingDown size={16} color="#E3000F" /> : <Minus size={16} color="#999" />}
                        <span className={cn(
                          'text-[0.9rem] font-bold',
                          change > 0 ? 'text-[#2d8659]' : change < 0 ? 'text-[#e3000f]' : 'text-[#999]'
                        )}>
                          {change > 0 ? '+' : ''}{change.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* Current Year Bar */}
                    <div className="mb-1 flex items-center gap-3">
                      <div className="relative flex h-7 flex-1 items-center">
                        <div
                          className="flex h-full items-center justify-end rounded px-2 text-[0.9rem] font-bold text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] transition-[width] duration-500 ease-out"
                          style={{
                            width: `${Math.max(widthPercent, 1)}%`,
                            background: color,
                            paddingRight: isSmall ? 0 : '0.5rem'
                          }}
                        >
                          {!isSmall && displayValue}
                        </div>
                        {isSmall && (
                          <span className="ml-2 whitespace-nowrap text-[0.9rem] font-bold text-black">{displayValue}</span>
                        )}
                      </div>
                    </div>

                    {/* Previous Year Bar */}
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-4 flex-1 items-center">
                        <div
                          className="flex h-full items-center justify-end rounded-[3px] px-0 text-[0.9rem] font-bold text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                          style={{
                            width: `${Math.max((prevValue / maxVal) * 100, 1)}%`,
                            background: `repeating-linear-gradient(45deg, ${color}, ${color} 2px, transparent 2px, transparent 6px)`,
                            backgroundColor: `${color}33`,
                            border: `1px solid ${color}`
                          }}
                        />
                        <span className="ml-2 whitespace-nowrap text-[0.85rem] font-medium text-ink">
                          {comparisonMode === 'seats' ? party.prevVotes : `${party.prevPercentage.toFixed(1)}%`}
                          <span className="ml-1 text-[0.75rem] font-normal text-ink-muted">({year === 2025 ? 2021 : 2017})</span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      )}
    </div>
  );
}
