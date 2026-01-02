import { useMemo, useState } from 'react';
import { Briefcase, MapPin, Percent, User, ListOrdered, ChevronDown, ChevronUp, Search, BarChart3, Users, TrendingUp, TrendingDown, Minus, UserPlus } from 'lucide-react';
import { useMembers, useSeatDistribution, useElectionResults, type ElectionResultsFilters } from '../hooks/useQueries';
import type { SeatDistributionItem } from '../types/api';
import { Hemicycle, type Seat } from '../components/parliament/Hemicycle';
import { PieChart } from '../components/parliament/PieChart';
import { getPartyColor, getPartyDisplayName, partyBadgeStyle } from '../utils/party';

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
  }, [membersRes?.data]);

  const selectedSeat = useMemo(() => {
    return seats.find((s) => s.id === selectedSeatId) ?? null;
  }, [seats, selectedSeatId]);

  const selectedPartyLabel = useMemo(() => {
    return selectedSeat ? getPartyDisplayName(selectedSeat.party, partyOpts) : '';
  }, [selectedSeat, partyOpts]);

  const selectedPartyColor = useMemo(() => {
    return selectedSeat ? getPartyColor(selectedSeat.party, partyOpts) : getPartyColor('', partyOpts);
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
      <div className="loading">
        <div className="spinner"></div>
        <div className="loading-text">Loading seat distribution...</div>
      </div>
    );
  }

  if (error) {
    return <div className="error">Failed to load data: {String(error)}</div>;
  }

  if (!data) {
    return <div className="error">No data returned.</div>;
  }

  return (
    <div>
      {/* State Distribution - above main card */}
      {allStateDistribution.length > 0 && (
        <div className="card mb-1">
          <div className="state-card-header">
            <div className="card-title">Seats by Federal State</div>
            <div className="card-subtitle">Click to filter (multi-select)</div>
          </div>
          <div className="state-card-content">
            <div className="state-grid">
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
                    className={`state-item ${isSelected ? 'is-selected' : ''} ${isGreyedOut ? 'is-greyed' : ''}`}
                  >
                    <div className="state-item-header">
                      <span className="state-item-name">{state.name}</span>
                      <span className="state-item-count">{state.total}</span>
                    </div>
                    <div className="state-bar-track" title={`${state.direct} direct, ${state.list} list`}>
                      <div className="state-bar-direct" style={{ width: `${directPct}%` }} />
                      <div className="state-bar-list" style={{ width: `${listPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div>
            <h2 className="card-title">Seat distribution in the Bundestag {year}</h2>
            <div className="card-subtitle">Total seats: {totalSeats}</div>
          </div>
          <button
            className="view-type-switch"
            onClick={() => setLameMode(!lameMode)}
            title={lameMode ? 'Switch to Hemicycle view' : 'Switch to Pie Chart view'}
            type="button"
          >
            <span className={`view-switch-label ${!lameMode ? 'active' : ''}`}>Hemicycle</span>
            <span className="view-switch-toggle">
              <span className={`view-switch-dot ${lameMode ? 'right' : ''}`} />
            </span>
            <span className={`view-switch-label ${lameMode ? 'active' : ''}`}>Pie</span>
          </button>

        </div>

        <div className="dashboard-grid">
          <div>
            <div className="filter-bar">
              <div className="filter-row">
                <div className="search-wrapper">
                  <Search size={18} className="search-icon" />
                  <input
                    type="text"
                    placeholder="Search for a member..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                </div>

                {/* Filter dropdowns */}
                <select
                  value={mandateFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'all' || val === 'direct' || val === 'list') setMandateFilter(val);
                  }}
                  className="filter-select"
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
                  className="filter-select"
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
                  className="filter-select"
                  title="Filter by member status"
                >
                  <option value="all">All Members</option>
                  <option value="new">New Members</option>
                  <option value="reelected">Re-elected</option>
                </select>
              </div>

              {/* Filter summary */}
              {seatPassesFilters && (
                <div className="filter-summary">
                  <div className="filter-summary-content">
                    <Users size={14} />
                    <span>
                      <strong className="text-primary">{filteredSeats.length}</strong> of {seats.length} members match filters
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
                    className="filter-clear-btn"
                    title="Clear all filters"
                    type="button"
                  >
                    ✕ Clear
                  </button>
                </div>
              )}
              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map(s => (
                    <div
                      key={s.id}
                      onClick={() => {
                        setSelectedSeatId(s.id);
                        setSearchTerm('');
                      }}
                      className="search-result-item"
                    >
                      <div>
                        <div className="search-result-name">{s.memberName}</div>
                        <div className="search-result-meta">{s.party} • {s.region}</div>
                      </div>
                      <div className="party-dot" style={{ background: getPartyColor(s.party, partyOpts) }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="hemicycle-container">
              {isMembersLoading ? (
                <div className="loading">
                  <div className="spinner"></div>
                  <div className="loading-text">Loading members…</div>
                </div>
              ) : membersError ? (
                <div className="warning-box mt-0">
                  <div className="warning-box-title">Visualization unavailable</div>
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
            <div className="info-panel">
              {selectedSeat ? (
                <>
                  <div className="info-panel-header">
                    <div className="member-header">
                      <div className="member-name">
                        {selectedSeat.memberName}
                      </div>
                      <span
                        className="party-badge"
                        style={{ backgroundColor: selectedPartyColor, color: '#fff' }}
                      >
                        {selectedPartyLabel}
                      </span>
                    </div>
                    <button className="btn" onClick={() => setSelectedSeatId(null)} type="button">
                      ✕
                    </button>
                  </div>
                  <div className="info-panel-content">
                    <div className="member-badges">
                      <span className={`seat-badge ${selectedSeat.seatType === 'direct' ? 'seat-direct' : 'seat-list'}`}>
                        {selectedSeat.seatType === 'direct' ? 'Direct Mandate' : 'List Mandate'}
                      </span>
                      {selectedSeat.previouslyElected ? (
                        <span className="seat-badge" style={{ backgroundColor: '#9613a2ff', color: 'white' }}>
                          Re-elected
                        </span>
                      ) : (
                        <span className="seat-badge" style={{ backgroundColor: '#FF9800', color: 'white' }}>
                          New Member
                        </span>
                      )}
                    </div>

                    <div className="info-grid">
                      <div className="info-item">
                        <div className="info-icon">
                          <MapPin size={18} />
                        </div>
                        <div>
                          <div className="info-label">Region / Constituency</div>
                          <div className="info-value">{selectedSeat.constituency || selectedSeat.region}</div>
                        </div>
                      </div>

                      {selectedSeat.profession && (
                        <div className="info-item">
                          <div className="info-icon">
                            <Briefcase size={18} />
                          </div>
                          <div>
                            <div className="info-label">Profession</div>
                            <div className="info-value">{selectedSeat.profession}</div>
                          </div>
                        </div>
                      )}

                      {(selectedSeat.birthYear || selectedSeat.gender) && (
                        <div className="info-item">
                          <div className="info-icon">
                            <User size={18} />
                          </div>
                          <div>
                            <div className="info-label">Personal Details</div>
                            <div className="info-value">
                              {selectedSeat.gender ? `${selectedSeat.gender === 'm' ? 'Male' : selectedSeat.gender === 'w' ? 'Female' : selectedSeat.gender}` : ''}
                              {selectedSeat.gender && selectedSeat.birthYear ? ', ' : ''}
                              {selectedSeat.birthYear ? `${year - selectedSeat.birthYear} years old` : ''}
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedSeat.seatType === 'direct' && selectedSeat.percentage !== undefined ? (
                        <div className="info-item">
                          <div className="info-icon">
                            <Percent size={18} />
                          </div>
                          <div>
                            <div className="info-label">First Vote Share</div>
                            <div className="info-value">{selectedSeat.percentage.toFixed(1)}%</div>
                          </div>
                        </div>
                      ) : selectedSeat.listPosition !== undefined ? (
                        <div className="info-item">
                          <div className="info-icon">
                            <ListOrdered size={18} />
                          </div>
                          <div>
                            <div className="info-label">List Position</div>
                            <div className="info-value">{selectedSeat.listPosition}</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <>

                  <div className="info-panel-content p-0">
                    <table className="party-table">
                      <thead>
                        <tr>
                          <th>Party</th>
                          <th className="text-right">Seats</th>
                          <th className="text-center small-text" title="Direct / List mandates">D / L</th>
                          <th className="text-right">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {combinedItems.map((party) => {
                          const isSelected = selectedParties.has(party.party_name);
                          const color = getPartyColor(party.party_name, partyOpts);
                          const breakdown = partyMandateBreakdown[party.party_name] || { direct: 0, list: 0 };
                          return (
                            <tr
                              key={party.party_name}
                              className={`table-row-interactive ${isSelected ? 'is-selected' : ''}`}
                              onClick={() => toggleParty(party.party_name)}
                              style={{
                                boxShadow: isSelected ? `inset 4px 0 0 ${color}` : 'none'
                              }}
                            >
                              <td>
                                <span
                                  className="party-badge"
                                  style={partyBadgeStyle(party.party_name, partyOpts)}
                                >
                                  {party.party_name}
                                </span>
                              </td>
                              <td className="text-right seats-count">{party.seats}</td>
                              <td className="text-center mandate-split">
                                <span className="mandate-direct">{breakdown.direct}</span>
                                {' / '}
                                <span className="mandate-list">{breakdown.list}</span>
                              </td>
                              <td className="text-right share-value">
                                {((party.seats / totalSeats) * 100).toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats Row */}
      {quickStats && (
        <div className="quick-stats-grid">
          <div className="quick-stat-card">
            <div className="quick-stat-icon">
              <MapPin size={20} />
            </div>
            <div className="quick-stat-content">
              <div className="quick-stat-value direct">{quickStats.directCount}</div>
              <div className="quick-stat-label">Direct Mandates</div>
            </div>
          </div>
          <div className="quick-stat-card">
            <div className="quick-stat-icon">
              <ListOrdered size={20} />
            </div>
            <div className="quick-stat-content">
              <div className="quick-stat-value list">{quickStats.listCount}</div>
              <div className="quick-stat-label">List Mandates</div>
            </div>
          </div>
          <div className="quick-stat-card">
            <div className="quick-stat-icon">
              <UserPlus size={20} />
            </div>
            <div className="quick-stat-content">
              <div className="quick-stat-value new">{quickStats.newMemberCount}</div>
              <div className="quick-stat-label">New Members</div>
            </div>
          </div>
          <div className="quick-stat-card">
            <div className="quick-stat-icon">
              <Users size={20} />
            </div>
            <div className="quick-stat-content">
              <div className="quick-stat-value reelected">{quickStats.reelectedCount}</div>
              <div className="quick-stat-label">Re-elected</div>
            </div>
          </div>
          {quickStats.youngest && (
            <div className="quick-stat-card">
              <div className="quick-stat-icon">
                <User size={20} />
              </div>
              <div className="quick-stat-content">
                <div className="quick-stat-value">{quickStats.youngest.memberName.split(' ').slice(-1)[0]}</div>
                <div className="quick-stat-label">Youngest ({year - quickStats.youngest.birthYear!}y)</div>
              </div>
            </div>
          )}
          {quickStats.oldest && (
            <div className="quick-stat-card">
              <div className="quick-stat-icon">
                <User size={20} />
              </div>
              <div className="quick-stat-content">
                <div className="quick-stat-value">{quickStats.oldest.memberName.split(' ').slice(-1)[0]}</div>
                <div className="quick-stat-label">Oldest ({year - quickStats.oldest.birthYear!}y)</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="dashboard-grid mt-1-5">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Key Information</h3>
          </div>
          <div className="key-info-text">
            <div>
              The German Bundestag has 630 seats. Seat allocation uses the Sainte-Laguë method based on second votes. After the 2023 electoral reform, there are no overhang mandates.
            </div>
          </div>

          {possibleCoalitions.length > 0 && (
            <div className="coalitions-section">
              <h4 className="coalitions-title">
                Possible Coalitions (Majority &gt; {Math.floor(totalSeats / 2)})
              </h4>
              <div className="info-grid">
                {possibleCoalitions.map((c) => {
                  const isExpanded = expandedCoalition === c.name;
                  const seatPct = ((c.seats / totalSeats) * 100).toFixed(1);
                  return (
                    <div key={c.name} className="coalition-card">
                      <div
                        className={`info-item coalition-header ${isExpanded ? 'is-expanded' : ''}`}
                        onClick={() => setExpandedCoalition(isExpanded ? null : c.name)}
                      >
                        <div className="coalition-dots">
                          {c.parties.map((p) => (
                            <div
                              key={p}
                              className="coalition-dot"
                              style={{ backgroundColor: getPartyColor(p, partyOpts) }}
                              title={p}
                            />
                          ))}
                        </div>
                        <div className="coalition-name">{c.name}</div>
                        <div className="coalition-seats">
                          {c.seats} seats
                          <span className="coalition-seats-pct">({seatPct}%)</span>
                        </div>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>

                      {isExpanded && (
                        <div className="coalition-details">
                          <div className="coalition-chancellor">
                            <strong>Possible Chancellor:</strong> Candidate from <span style={{ color: getPartyColor(c.strongestParty, partyOpts), fontWeight: 600 }}>{c.strongestParty}</span>
                          </div>
                          <div className="coalition-description">
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
        </div>

        {demographics && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Demographics</h3>
            </div>

            <div className="info-grid">
              <div className="info-item">
                <div className="info-icon">
                  <Users size={18} />
                </div>
                <div className="demographics-flex">
                  <div className="info-label">Gender Balance</div>
                  <div className="gender-bar-container">
                    <div className="gender-bar-track">
                      <div className="gender-bar-female" style={{ width: `${demographics.femalePercent}%` }} title="Female" />
                      <div className="gender-bar-male" title="Male" />
                    </div>
                  </div>
                  <div className="gender-labels">
                    <span>{demographics.femalePercent}% Female</span>
                    <span>{(100 - Number(demographics.femalePercent)).toFixed(1)}% Male</span>
                  </div>
                </div>
              </div>

              <div className="info-item">
                <div className="info-icon">
                  <BarChart3 size={18} />
                </div>
                <div className="demographics-flex">
                  <div className="info-label">Age Distribution</div>
                  <div className="age-chart">
                    {ageDistribution.map(({ range, count }) => {
                      const maxCount = Math.max(...ageDistribution.map(a => a.count), 1);
                      const heightPx = Math.round((count / maxCount) * 46);
                      return (
                        <div
                          key={range}
                          className="age-bar-wrapper"
                          title={`${range}: ${count} members`}
                        >
                          <div
                            className="age-bar"
                            style={{ height: count > 0 ? `${heightPx}px` : '0px' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="age-labels">
                    {ageDistribution.map(({ range }) => (
                      <div key={range} className="age-label">{range}</div>
                    ))}
                  </div>
                  <div className="age-average">
                    Average: <strong className="text-primary">{demographics.avgAge}</strong> years
                  </div>
                </div>
              </div>

              <div className="professions-section">
                <div className="info-label mb-0-5">Top Professions</div>
                <div className="professions-list">
                  {demographics.topProfessions.map(([prof, count], i) => (
                    <div key={i} className="profession-item">
                      <span className="profession-name">{prof || 'Unknown'}</span>
                      <span className="profession-count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {resultsData && (
        <div className="card mt-1-5">
          <div className="card-header comparison-header">
            <div>
              <h3 className="card-title">Election Results Comparison</h3>
              <div className="card-subtitle">
                {comparisonMode === 'second' ? 'Second Votes' : comparisonMode === 'first' ? 'First Votes' : 'Seat Distribution'}: {year} vs {year === 2025 ? 2021 : 2017}
              </div>
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
                className="filter-select filter-select-wide"
              >
                <option value="seats">Seats</option>
                <option value="first">First Votes</option>
                <option value="second">Second Votes</option>
              </select>
            </div>
          </div>

          {/* Empty state when no data for the selected filter combination */}
          {resultsData.data.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-title">No data for this filter combination. Try removing a state or party filter to see results.</div>
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
              <div className="comparison-summary">
                <div className="summary-item">
                  <TrendingUp size={14} color="#2D8659" />
                  <span className="summary-value-gain">{partiesGained}</span>
                  <span className="summary-label">gained</span>
                </div>
                <div className="summary-item">
                  <TrendingDown size={14} color="#E3000F" />
                  <span className="summary-value-loss">{partiesLost}</span>
                  <span className="summary-label">lost</span>
                </div>
                {winnerChange > 0 && (
                  <div className="summary-item">
                    <span className="summary-label">Biggest gain:</span>
                    <span className="fw-semibold" style={{ color: getPartyColor(biggestWinner.abbreviation, partyOpts) }}>
                      {biggestWinner.abbreviation}
                    </span>
                    <span className="summary-value-gain">+{winnerChange.toFixed(1)}%</span>
                  </div>
                )}
                {loserChange < 0 && (
                  <div className="summary-item">
                    <span className="summary-label">Biggest loss:</span>
                    <span className="fw-semibold" style={{ color: getPartyColor(biggestLoser.abbreviation, partyOpts) }}>
                      {biggestLoser.abbreviation}
                    </span>
                    <span className="summary-value-loss">{loserChange.toFixed(1)}%</span>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="comparison-content">
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
                  <div key={party.abbreviation} className="party-comparison">
                    <div className="party-comparison-header">
                      <div className="party-comparison-name">
                        {party.abbreviation}
                      </div>
                      <div className="party-comparison-change">
                        {change > 0 ? <TrendingUp size={16} color="#2D8659" /> : change < 0 ? <TrendingDown size={16} color="#E3000F" /> : <Minus size={16} color="#999" />}
                        <span className={`change-value ${change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral'}`}>
                          {change > 0 ? '+' : ''}{change.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* Current Year Bar */}
                    <div className="bar-row current">
                      <div className="bar-container">
                        <div
                          className="result-bar"
                          style={{
                            width: `${Math.max(widthPercent, 1)}%`,
                            background: color,
                            paddingRight: isSmall ? 0 : '0.5rem'
                          }}
                        >
                          {!isSmall && displayValue}
                        </div>
                        {isSmall && (
                          <span className="bar-value-outside">{displayValue}</span>
                        )}
                      </div>
                    </div>

                    {/* Previous Year Bar */}
                    <div className="bar-row">
                      <div className="bar-container prev">
                        <div
                          className="result-bar prev"
                          style={{
                            width: `${Math.max((prevValue / maxVal) * 100, 1)}%`,
                            background: `repeating-linear-gradient(45deg, ${color}, ${color} 2px, transparent 2px, transparent 6px)`,
                            backgroundColor: `${color}33`,
                            border: `1px solid ${color}`
                          }}
                        />
                        <span className="prev-value">
                          {comparisonMode === 'seats' ? party.prevVotes : `${party.prevPercentage.toFixed(1)}%`}
                          <span className="prev-year">({year === 2025 ? 2021 : 2017})</span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
