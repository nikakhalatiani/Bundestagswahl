import { useMemo, useState } from 'react';
import { Briefcase, MapPin, Percent, User, ListOrdered, ChevronDown, ChevronUp } from 'lucide-react';
import { useMembers, useSeatDistribution } from '../hooks/useQueries';
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

  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [selectedParty, setSelectedParty] = useState<string | null>(null);
  const [expandedCoalition, setExpandedCoalition] = useState<string | null>(null);

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
    </div>
  );
}
