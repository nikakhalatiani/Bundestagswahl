import { useMemo, useState } from 'react';
import { Briefcase, MapPin, Percent, User, ListOrdered } from 'lucide-react';
import { useMembers, useSeatDistribution } from '../hooks/useQueries';
import type { SeatDistributionItem } from '../types/api';
import { Hemicycle, type Seat } from '../components/parliament/Hemicycle';
import { getPartyColor, getPartyDisplayName, partyBadgeStyle } from '../utils/party';

interface DashboardProps {
  year: number;
}

export function Dashboard({ year }: DashboardProps) {
  const { data, isLoading, error } = useSeatDistribution(year);
  const { data: membersRes, isLoading: isMembersLoading, error: membersError } = useMembers(year);

  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [selectedParty, setSelectedParty] = useState<string | null>(null);

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
      </div>
    </div>
  );
}
