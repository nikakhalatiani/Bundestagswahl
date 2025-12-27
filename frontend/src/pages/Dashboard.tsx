import { useMemo, useState } from 'react';
import { Briefcase, MapPin, Percent, User, ListOrdered, ChevronDown, ChevronUp, Search, BarChart3, Users, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useMembers, useSeatDistribution, useElectionResults } from '../hooks/useQueries';
import type { SeatDistributionItem } from '../types/api';
import { Hemicycle, type Seat } from '../components/parliament/Hemicycle';
import { getPartyColor, getPartyDisplayName, partyBadgeStyle } from '../utils/party';

const COALITION_DESCRIPTIONS: Record<string, string> = {
  'Grand Coalition': 'A coalition of the two largest parties, typically CDU/CSU and SPD. Historically the most common coalition in Germany.',
  'Traffic Light (Ampel)': 'A coalition of SPD (Red), FDP (Yellow), and Greens. First formed at the federal level in 2021.',
  'Jamaica': 'A coalition of CDU/CSU (Black), Greens, and FDP (Yellow). Named after the colors of the Jamaican flag.',
  'Kenya': 'A coalition of CDU/CSU (Black), SPD (Red), and Greens. Named after the colors of the Kenyan flag.',
  'Germany': 'A coalition of CDU/CSU (Black), SPD (Red), and FDP (Yellow). Named after the German flag colors.',
  'Red-Green-Red': 'A left-wing coalition of SPD, Greens, and Die Linke.',
};

interface DashboardProps {
  year: number;
}

export function Dashboard({ year }: DashboardProps) {
  const { data, isLoading, error } = useSeatDistribution(year);
  const { data: membersRes, isLoading: isMembersLoading, error: membersError } = useMembers(year);

  const [comparisonMode, setComparisonMode] = useState<'first' | 'second' | 'seats'>('second');
  const { data: resultsData } = useElectionResults(year, comparisonMode);

  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [selectedParty, setSelectedParty] = useState<string | null>(null);
  const [expandedCoalition, setExpandedCoalition] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

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

  const searchResults = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return [];
    return seats.filter(s =>
      s.memberName.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 8);
  }, [seats, searchTerm]);

  const demographics = useMemo(() => {
    if (seats.length === 0) return null;

    let totalAge = 0;
    let ageCount = 0;
    const genderCounts: Record<string, number> = { m: 0, w: 0, d: 0 };
    const professions: Record<string, number> = {};

    seats.forEach(s => {
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
  }, [seats, year]);

  const possibleCoalitions = useMemo(() => {
    if (totalSeats === 0) return [];
    const majority = Math.floor(totalSeats / 2) + 1;

    const coalitions = [
      { name: 'Grand Coalition', parties: ['CDU/CSU', 'SPD'] },
      { name: 'Traffic Light (Ampel)', parties: ['SPD', 'GRÜNE', 'FDP'] },
      { name: 'Jamaica', parties: ['CDU/CSU', 'GRÜNE', 'FDP'] },
      { name: 'Kenya', parties: ['CDU/CSU', 'SPD', 'GRÜNE'] },
      { name: 'Germany', parties: ['CDU/CSU', 'SPD', 'FDP'] },
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
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Seat distribution in the Bundestag {year}</h2>
          <div className="card-subtitle">Total seats: {totalSeats}</div>
        </div>

        <div className="dashboard-grid">
          <div>
            <div style={{ position: 'relative', marginBottom: '1rem' }}>
              <div style={{ position: 'relative' }}>
                <Search size={18} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input
                  type="text"
                  placeholder="Search for a member..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 1rem 0.6rem 2.2rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.95rem'
                  }}
                />
              </div>
              {searchResults.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  marginTop: '4px',
                  boxShadow: 'var(--shadow-md)',
                  zIndex: 10,
                  maxHeight: '300px',
                  overflowY: 'auto'
                }}>
                  {searchResults.map(s => (
                    <div
                      key={s.id}
                      onClick={() => {
                        setSelectedSeatId(s.id);
                        setSearchTerm('');
                      }}
                      style={{
                        padding: '0.75rem 1rem',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--bg-accent)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                      className="search-result-item"
                    >
                      <div>
                        <div style={{ fontWeight: 500 }}>{s.memberName}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{s.party} • {s.region}</div>
                      </div>
                      <div style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: getPartyColor(s.party, partyOpts)
                      }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ height: 400 }}>
              {isMembersLoading ? (
                <div className="loading" style={{ padding: '2rem 1rem' }}>
                  <div className="spinner"></div>
                  <div className="loading-text">Loading members…</div>
                </div>
              ) : membersError ? (
                <div className="warning-box" style={{ marginTop: 0 }}>
                  <div className="warning-box-title">Hemicycle unavailable</div>
                  <div>Could not load members: {String(membersError)}</div>
                </div>
              ) : (
                <Hemicycle
                  seats={seats}
                  height={400}
                  combineCduCsu={true}
                  selectedSeatId={selectedSeatId}
                  onSelectSeatId={setSelectedSeatId}
                  partyFilter={selectedParty ? new Set([selectedParty]) : undefined}
                />
              )}
            </div>
          </div>

          <div>
            <div className="info-panel">
              {selectedSeat ? (
                <>
                  <div className="info-panel-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
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
                    <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span className="seat-badge" style={{
                        backgroundColor: selectedSeat.seatType === 'direct' ? '#4CAF50' : '#2196F3',
                        color: 'white'
                      }}>
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
                  <div className="info-panel-header">
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Party Breakdown</div>
                  </div>
                  <div className="info-panel-content" style={{ padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                          <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Party</th>
                          <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Seats</th>
                          <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {combinedItems.map((party) => {
                          const isSelected = selectedParty === party.party_name;
                          const color = getPartyColor(party.party_name, partyOpts);
                          return (
                            <tr
                              key={party.party_name}
                              className={`table-row-interactive ${isSelected ? 'is-selected' : ''}`}
                              onClick={() => setSelectedParty(isSelected ? null : party.party_name)}
                              style={{
                                borderBottom: '1px solid var(--border-color)',
                                backgroundColor: isSelected ? 'var(--bg-accent)' : undefined,
                                boxShadow: isSelected ? `inset 4px 0 0 ${color}` : 'none'
                              }}
                            >
                              <td style={{ padding: '0.75rem 1rem' }}>
                                <span
                                  className="party-badge"
                                  style={partyBadgeStyle(party.party_name, partyOpts)}
                                >
                                  {party.party_name}
                                </span>
                              </td>
                              <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 500 }}>{party.seats}</td>
                              <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
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

      <div className="dashboard-grid" style={{ marginTop: '1.5rem' }}>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Key Information</h3>
          </div>
          <div className="info-box">
            <div className="info-box-title">German Federal Election {year}</div>
            <div className="info-box-text">
              The German Bundestag has {totalSeats} seats. Seat allocation uses the Sainte-Laguë method based on second votes.
              After the 2023 electoral reform, there are no overhang mandates.
            </div>
          </div>

          {possibleCoalitions.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <h4 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>
                Possible Coalitions (Majority &gt; {Math.floor(totalSeats / 2)})
              </h4>
              <div className="info-grid">
                {possibleCoalitions.map((c) => {
                  const isExpanded = expandedCoalition === c.name;
                  return (
                    <div key={c.name} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                      <div
                        className="info-item"
                        style={{ alignItems: 'center', padding: '0.75rem', cursor: 'pointer', background: isExpanded ? 'var(--bg-accent)' : 'transparent' }}
                        onClick={() => setExpandedCoalition(isExpanded ? null : c.name)}
                      >
                        <div style={{ display: 'flex', gap: '0.25rem', marginRight: '0.75rem' }}>
                          {c.parties.map((p) => (
                            <div
                              key={p}
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                backgroundColor: getPartyColor(p, partyOpts),
                              }}
                              title={p}
                            />
                          ))}
                        </div>
                        <div style={{ flex: 1, fontWeight: 500 }}>{c.name}</div>
                        <div style={{ fontWeight: 600, marginRight: '0.5rem' }}>{c.seats} seats</div>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>

                      {isExpanded && (
                        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)', fontSize: '0.9rem' }}>
                          <div style={{ marginBottom: '0.5rem' }}>
                            <strong>Possible Chancellor:</strong> Candidate from <span style={{ color: getPartyColor(c.strongestParty, partyOpts), fontWeight: 600 }}>{c.strongestParty}</span>
                          </div>
                          <div style={{ color: 'var(--text-secondary)' }}>
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
                <div style={{ flex: 1 }}>
                  <div className="info-label">Gender Balance</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <div style={{ flex: 1, height: '8px', background: '#eee', borderRadius: '4px', overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${demographics.femalePercent}%`, background: '#E91E63' }} title="Female" />
                      <div style={{ flex: 1, background: '#2196F3' }} title="Male" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <span>{demographics.femalePercent}% Female</span>
                    <span>{(100 - Number(demographics.femalePercent)).toFixed(1)}% Male</span>
                  </div>
                </div>
              </div>

              <div className="info-item">
                <div className="info-icon">
                  <BarChart3 size={18} />
                </div>
                <div>
                  <div className="info-label">Average Age</div>
                  <div className="info-value">{demographics.avgAge} years</div>
                </div>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <div className="info-label" style={{ marginBottom: '0.5rem' }}>Top Professions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {demographics.topProfessions.map(([prof, count], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                      <span style={{ color: 'var(--text-primary)' }}>{prof || 'Unknown'}</span>
                      <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {resultsData && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                style={{
                  padding: '0.5rem 2rem 0.5rem 1rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--bg-primary)',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 0.7rem center',
                  backgroundSize: '1em'
                }}
              >
                <option value="seats">Seats</option>
                <option value="first">First Votes</option>
                <option value="second">Second Votes</option>
              </select>
            </div>
          </div>
          <div style={{ padding: '1rem 0' }}>
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
                <div key={party.abbreviation} style={{ marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {party.abbreviation}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {change > 0 ? <TrendingUp size={16} color="#2D8659" /> : change < 0 ? <TrendingDown size={16} color="#E3000F" /> : <Minus size={16} color="#999" />}
                      <span style={{
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        color: change > 0 ? '#2D8659' : change < 0 ? '#E3000F' : '#999'
                      }}>
                        {change > 0 ? '+' : ''}{change.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Current Year Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                    <div style={{ flex: 1, height: '28px', display: 'flex', alignItems: 'center' }}>
                      <div style={{
                        width: `${Math.max(widthPercent, 1)}%`,
                        background: color,
                        height: '100%',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        paddingRight: isSmall ? 0 : '0.5rem',
                        color: '#fff',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                        transition: 'width 0.5s ease-out'
                      }}>
                        {!isSmall && displayValue}
                      </div>
                      {isSmall && (
                        <div style={{ marginLeft: '0.5rem', color: '#000', fontWeight: 700, fontSize: '0.9rem' }}>
                          {displayValue}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Previous Year Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ flex: 1, height: '16px', display: 'flex', alignItems: 'center' }}>
                      <div style={{
                        width: `${Math.max((prevValue / maxVal) * 100, 1)}%`,
                        background: `repeating-linear-gradient(45deg, ${color}, ${color} 2px, transparent 2px, transparent 6px)`,
                        backgroundColor: `${color}33`,
                        border: `1px solid ${color}`,
                        height: '100%',
                        borderRadius: '3px',
                        transition: 'width 0.5s ease-out'
                      }} />
                      <div style={{
                        marginLeft: '0.5rem',
                        color: 'var(--text-primary)',
                        fontWeight: 500,
                        fontSize: '0.85rem'
                      }}>
                        {comparisonMode === 'seats' ? party.prevVotes : `${party.prevPercentage.toFixed(1)}%`}
                        <span style={{ marginLeft: '0.35rem', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                          ({year === 2025 ? 2021 : 2017})
                        </span>
                      </div>
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
