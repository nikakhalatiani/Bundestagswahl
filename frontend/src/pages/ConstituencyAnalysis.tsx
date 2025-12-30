import { useEffect, useMemo, useState } from 'react';
import { MapPin, Vote, Users, TrendingUp, Award, AlertTriangle } from 'lucide-react';
import { Autocomplete } from '../components/Autocomplete';
import { ConstituencyMap } from '../components/ConstituencyMap';
import {
  useClosestWinners,
  useConstituencyList,
  useConstituencyOverview,
  useConstituencyWinners,
  useConstituenciesSingle,
  useDirectWithoutCoverage,
  useConstituencyVotesBulk,
} from '../hooks/useQueries';
import type { ClosestWinnerItem, ConstituencyListItem, VoteDistributionItem } from '../types/api';
import { getPartyDisplayName, getPartyColor, partyBadgeStyle } from '../utils/party';

interface ConstituencyAnalysisProps {
  year: number;
}

export function ConstituencyAnalysis({ year }: ConstituencyAnalysisProps) {
  const [constituencyId, setConstituencyId] = useState(1);
  const [constituencyNumber, setConstituencyNumber] = useState<number | null>(null);
  const [constituencyQuery, setConstituencyQuery] = useState('');
  const [showSingleVotes, setShowSingleVotes] = useState(false);
  const [mapVoteType, setMapVoteType] = useState<'first' | 'second'>('first');

  const { data: constituencyList, isLoading: loadingConstituencyList, error: constituencyListError } = useConstituencyList(year);
  const { data: overview, isLoading: loadingOverview } = useConstituencyOverview(constituencyId, year);
  const { data: winners } = useConstituencyWinners(year);
  const { data: votesBulk } = useConstituencyVotesBulk(year);
  const { data: closest } = useClosestWinners(year, 10);
  const { data: lostMandates } = useDirectWithoutCoverage(year);

  // For Q7: Single votes
  const singleVoteIds = useMemo(() => {
    if (!constituencyNumber) return undefined;
    return String(constituencyNumber);
  }, [constituencyNumber]);
  const { data: singleVotesData, isLoading: loadingSingleVotes } = useConstituenciesSingle(year, singleVoteIds);

  const constituencyItems: ConstituencyListItem[] = constituencyList?.data ?? [];
  const winnersData = winners?.data ?? [];
  const getConstituencyLabel = (c: ConstituencyListItem) => `${c.number} — ${c.name} (${c.state_name})`;

  // Create lookup from number to item
  const numberToItem = useMemo(() => {
    const map = new Map<number, ConstituencyListItem>();
    constituencyItems.forEach(c => map.set(c.number, c));
    return map;
  }, [constituencyItems]);

  const [didInitQuery, setDidInitQuery] = useState(false);
  useEffect(() => {
    if (didInitQuery) return;
    if (constituencyItems.length === 0) return;
    const selected = constituencyItems.find((c) => c.id === constituencyId) ?? constituencyItems[0];
    setConstituencyId(selected.id);
    setConstituencyNumber(selected.number);
    setConstituencyQuery(getConstituencyLabel(selected));
    setDidInitQuery(true);
  }, [constituencyId, constituencyItems, didInitQuery]);

  // Handle map click - find constituency by number
  const handleMapSelect = (number: number) => {
    const item = numberToItem.get(number);
    if (item) {
      setConstituencyId(item.id);
      setConstituencyNumber(item.number);
      setConstituencyQuery(getConstituencyLabel(item));
    }
  };

  const partyOpts = { combineCduCsu: true };
  const singleConstituency = singleVotesData?.data?.[0];

  return (
    <div className="constituency-analysis">
      {/* Map + Details Main Grid */}
      <div className="constituency-main-grid">
        {/* Map Card */}
        <div className="card constituency-map-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                <MapPin size={20} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Constituency Map
              </h2>
              <div className="card-subtitle">Click a constituency to view details</div>
            </div>
            <div className="map-vote-toggle">
              <button
                className={`vote-toggle-btn ${mapVoteType === 'first' ? 'active' : ''}`}
                onClick={() => setMapVoteType('first')}
              >
                First Vote
              </button>
              <button
                className={`vote-toggle-btn ${mapVoteType === 'second' ? 'active' : ''}`}
                onClick={() => setMapVoteType('second')}
              >
                Second Vote
              </button>
            </div>
          </div>
          <ConstituencyMap
            year={year}
            winners={winnersData}
            votesBulk={votesBulk?.data ?? []}
            selectedConstituencyNumber={constituencyNumber}
            onSelectConstituency={handleMapSelect}
            voteType={mapVoteType}
          />
        </div>

        {/* Details Panel */}
        <div className="constituency-details-panel">
          {/* Selector Card */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Constituency Details</h2>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <Autocomplete
                id="constituency"
                label="Search by number or name"
                items={constituencyItems}
                value={constituencyQuery}
                onChange={setConstituencyQuery}
                onSelect={(item) => {
                  setConstituencyId(item.id);
                  setConstituencyNumber(item.number);
                  setConstituencyQuery(getConstituencyLabel(item));
                }}
                getItemLabel={getConstituencyLabel}
                placeholder={loadingConstituencyList ? 'Loading…' : 'e.g. 75 or Berlin'}
                disabled={loadingConstituencyList}
              />
            </div>
            {constituencyListError && (
              <div className="warning-box" style={{ marginTop: '0.75rem' }}>
                <div className="warning-box-title">Could not load constituencies</div>
                <div>Backend may be unreachable.</div>
              </div>
            )}
          </div>

          {/* Overview Stats */}
          {loadingOverview ? (
            <div className="card">
              <div className="loading">
                <div className="spinner"></div>
                <div className="loading-text">Loading...</div>
              </div>
            </div>
          ) : overview ? (
            <>
              {/* Name and State Header */}
              <div className="card">
                <div className="constituency-name-header">
                  <h3>{overview.constituency.name}</h3>
                  <span className="constituency-state-badge">{overview.constituency.state}</span>
                </div>

                <div className="stats-grid stats-grid-compact">
                  <div className="stat-card stat-card-compact">
                    <div className="stat-icon"><Users size={18} /></div>
                    <div>
                      <div className="stat-label">Turnout</div>
                      <div className="stat-value">{overview.election_stats.turnout_percent?.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="stat-card stat-card-compact">
                    <div className="stat-icon"><Vote size={18} /></div>
                    <div>
                      <div className="stat-label">Voters</div>
                      <div className="stat-value">{overview.election_stats.total_voters?.toLocaleString()}</div>
                    </div>
                  </div>
                </div>

                {/* Winner */}
                {overview.winner && (
                  <div
                    className="constituency-winner-card"
                    style={{ borderLeftColor: getPartyColor(overview.winner.party_name, partyOpts) }}
                  >
                    <div className="constituency-winner-header">
                      <span className="party-badge" style={partyBadgeStyle(overview.winner.party_name, partyOpts)}>
                        {getPartyDisplayName(overview.winner.party_name, partyOpts)}
                      </span>
                      <span className={`seat-badge ${overview.winner.got_seat ? 'seat-direct' : 'seat-none'}`}>
                        {overview.winner.got_seat ? 'Seat awarded' : 'No seat'}
                      </span>
                    </div>
                    <div className="constituency-winner-name">{overview.winner.full_name}</div>
                    <div className="constituency-winner-votes">
                      <strong>{overview.winner.first_votes?.toLocaleString()}</strong> votes
                      ({overview.winner.percent_of_valid?.toFixed(1)}%)
                    </div>
                  </div>
                )}

                {/* Comparison to 2021 */}
                {overview.comparison_to_2021 && (
                  <div className="info-box" style={{ marginTop: '1rem' }}>
                    <div className="info-box-title">
                      <TrendingUp size={16} style={{ marginRight: '0.5rem' }} />
                      vs 2021
                    </div>
                    <div className="info-box-text">
                      Turnout: {overview.comparison_to_2021.turnout_diff_pts > 0 ? '+' : ''}
                      {overview.comparison_to_2021.turnout_diff_pts.toFixed(1)} pts
                      <br />
                      Previous winner: {overview.comparison_to_2021.winner_2021}
                      <br />
                      {overview.comparison_to_2021.winner_changed ? '✓ Winner changed' : '○ Same winner'}
                    </div>
                  </div>
                )}
              </div>

              {/* Vote Distribution with Toggle */}
              <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="card-title" style={{ fontSize: '1rem', margin: 0 }}>Vote Distribution</h3>
                  <button
                    className="toggle-btn"
                    onClick={() => setShowSingleVotes(!showSingleVotes)}
                    title={showSingleVotes ? 'Show aggregated votes' : 'Show single ballot votes (Q7)'}
                  >
                    <span>{showSingleVotes ? 'Switch to Aggregated' : 'Switch to Single Votes'}</span>
                  </button>
                </div>

                {showSingleVotes ? (
                  loadingSingleVotes ? (
                    <div className="loading">
                      <div className="spinner"></div>
                    </div>
                  ) : singleConstituency ? (
                    <div className="table-container">
                      <table className="table-compact">
                        <thead>
                          <tr>
                            <th>Candidate</th>
                            <th className="text-right">Votes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {singleConstituency.candidates.map((c, idx) => (
                            <tr key={idx} className={c.is_winner ? 'row-highlight' : ''}>
                              <td>
                                {c.person_name}
                                <br />
                                <span
                                  className="party-badge party-badge-sm"
                                  style={partyBadgeStyle(c.party_name, partyOpts)}
                                >
                                  {getPartyDisplayName(c.party_name, partyOpts)}
                                </span>
                              </td>
                              <td className="text-right">{c.vote_count?.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Total first votes: {singleConstituency.total_first_votes?.toLocaleString()}
                      </div>
                    </div>
                  ) : (
                    <div className="error">No single vote data available</div>
                  )
                ) : (
                  <div className="table-container">
                    <table className="table-compact">
                      <thead>
                        <tr>
                          <th>Party</th>
                          <th className="text-right">First</th>
                          <th className="text-right">Second</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.vote_distribution.map((party: VoteDistributionItem, idx: number) => (
                          <tr key={idx}>
                            <td>
                              <span
                                className="party-badge party-badge-sm"
                                style={partyBadgeStyle(party.party_name, partyOpts)}
                              >
                                {getPartyDisplayName(party.party_name, partyOpts)}
                              </span>
                            </td>
                            <td className="text-right">
                              {party.first_votes?.toLocaleString()}
                              <br />
                              <span className="text-muted">{party.first_percent?.toFixed(1)}%</span>
                            </td>
                            <td className="text-right">
                              {party.second_votes?.toLocaleString()}
                              <br />
                              <span className="text-muted">{party.second_percent?.toFixed(1)}%</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="card">
              <div className="error">Constituency not found</div>
            </div>
          )}
        </div>
      </div>

      {/* Closest Winners (Q6) */}
      {closest && closest.data.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <Award size={20} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Closest Races (Top 10)
            </h2>
            <div className="card-subtitle">Narrowest winning margins across all constituencies</div>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Constituency</th>
                  <th>Winner</th>
                  <th>Runner-up</th>
                  <th className="text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {closest.data.map((race: ClosestWinnerItem) => (
                  <tr
                    key={race.rank}
                    className="clickable-row"
                    onClick={() => {
                      // Parse constituency number from name if possible
                      const item = constituencyItems.find(c =>
                        race.constituency_name.includes(c.name) ||
                        race.constituency_name.startsWith(`${c.number} `)
                      );
                      if (item) handleMapSelect(item.number);
                    }}
                  >
                    <td>{race.rank}</td>
                    <td>{race.constituency_name}</td>
                    <td>
                      {race.winner_name}
                      <br />
                      <span className="party-badge party-badge-sm" style={partyBadgeStyle(race.winner_party, partyOpts)}>
                        {getPartyDisplayName(race.winner_party, partyOpts)}
                      </span>
                    </td>
                    <td>
                      {race.runner_up_name}
                      <br />
                      <span className="party-badge party-badge-sm" style={partyBadgeStyle(race.runner_up_party, partyOpts)}>
                        {getPartyDisplayName(race.runner_up_party, partyOpts)}
                      </span>
                    </td>
                    <td className="text-right">
                      <strong>{race.margin_votes?.toLocaleString()}</strong> votes
                      <br />
                      <span className="text-muted">({race.margin_percent?.toFixed(3)}%)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Direct Winners Without Coverage (Q5) */}
      {lostMandates && lostMandates.total_lost_mandates > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <AlertTriangle size={20} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Direct Winners Without Second-Vote Coverage
            </h2>
            <div className="card-subtitle">
              {lostMandates.total_lost_mandates} constituency winners did not receive a seat
            </div>
          </div>
          <div className="warning-box">
            <div className="warning-box-title">2023 Electoral Reform</div>
            <div>
              These candidates won their constituency but did not receive a seat because their party
              did not have enough second votes in the state (second-vote coverage rule).
            </div>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Constituency</th>
                  <th>Winner</th>
                  <th>Party</th>
                  <th>State</th>
                  <th className="text-right">First Votes</th>
                </tr>
              </thead>
              <tbody>
                {lostMandates.data.map((mandate, idx: number) => (
                  <tr key={idx}>
                    <td>{mandate.constituency_name}</td>
                    <td>{mandate.winner_name}</td>
                    <td>
                      <span className="party-badge party-badge-sm" style={partyBadgeStyle(mandate.party_name, partyOpts)}>
                        {getPartyDisplayName(mandate.party_name, partyOpts)}
                      </span>
                    </td>
                    <td>{mandate.state_name}</td>
                    <td className="text-right">
                      {mandate.first_votes?.toLocaleString()}
                      <br />
                      <span className="text-muted">({mandate.percent_first_votes?.toFixed(1)}%)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
