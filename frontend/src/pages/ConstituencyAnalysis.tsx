import { useEffect, useMemo, useState, useCallback } from 'react';
import { MapPin, TrendingUp, TrendingDown, Award, AlertTriangle, ChevronLeft, ChevronRight, X, UserPlus, Check, Target } from 'lucide-react';
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
  useNearMisses,
} from '../hooks/useQueries';
import type { ClosestWinnerItem, ConstituencyListItem, VoteDistributionItem, NearMissItem } from '../types/api';
import { getPartyDisplayName, getPartyColor, partyBadgeStyle } from '../utils/party';

interface ConstituencyAnalysisProps {
  year: number;
}

const CLOSEST_WINNERS_LIMIT = 50;
const CLOSEST_WINNERS_PER_PAGE = 10;

export function ConstituencyAnalysis({ year }: ConstituencyAnalysisProps) {
  const [constituencyId, setConstituencyId] = useState(1);
  const [constituencyNumber, setConstituencyNumber] = useState<number | null>(null);
  const [constituencyQuery, setConstituencyQuery] = useState('');
  const [showSingleVotes, setShowSingleVotes] = useState(false);
  const [mapVoteType, setMapVoteType] = useState<'first' | 'second'>('first');

  // State filter
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());

  // Pagination for closest winners
  const [closestPage, setClosestPage] = useState(1);

  const { data: constituencyList, isLoading: loadingConstituencyList, error: constituencyListError } = useConstituencyList(year);
  const { data: overview, isLoading: loadingOverview } = useConstituencyOverview(constituencyId, year);
  const { data: winners } = useConstituencyWinners(year);
  const { data: votesBulk } = useConstituencyVotesBulk(year);
  const { data: closest } = useClosestWinners(year, CLOSEST_WINNERS_LIMIT);
  const { data: lostMandates } = useDirectWithoutCoverage(year);
  const { data: nearMisses } = useNearMisses(year, 5);

  // For Q7: Single votes
  const singleVoteIds = useMemo(() => {
    if (!constituencyNumber) return undefined;
    return String(constituencyNumber);
  }, [constituencyNumber]);
  const { data: singleVotesData, isLoading: loadingSingleVotes } = useConstituenciesSingle(year, singleVoteIds);

  const constituencyItems: ConstituencyListItem[] = constituencyList?.data ?? [];
  const winnersData = winners?.data ?? [];
  const getConstituencyLabel = (c: ConstituencyListItem) => `${c.number} — ${c.name} (${c.state_name})`;

  // Extract unique states from constituency list
  const uniqueStates = useMemo(() => {
    const statesSet = new Set<string>();
    constituencyItems.forEach(c => statesSet.add(c.state_name));
    return Array.from(statesSet).sort();
  }, [constituencyItems]);

  // Toggle state filter
  const toggleState = useCallback((state: string) => {
    setSelectedStates(prev => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  }, []);

  // Clear all state filters
  const clearStateFilters = useCallback(() => {
    setSelectedStates(new Set());
  }, []);

  // Create lookup from number to item
  const numberToItem = useMemo(() => {
    const map = new Map<number, ConstituencyListItem>();
    constituencyItems.forEach(c => map.set(c.number, c));
    return map;
  }, [constituencyItems]);

  // Closest winners pagination
  const closestData = closest?.data ?? [];
  const closestTotalPages = Math.ceil(closestData.length / CLOSEST_WINNERS_PER_PAGE);
  const paginatedClosest = useMemo(() => {
    const start = (closestPage - 1) * CLOSEST_WINNERS_PER_PAGE;
    return closestData.slice(start, start + CLOSEST_WINNERS_PER_PAGE);
  }, [closestData, closestPage]);

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
            <button
              className="vote-type-switch"
              onClick={() => setMapVoteType(prev => prev === 'first' ? 'second' : 'first')}
              title={mapVoteType === 'first' ? 'Switch to Second Vote' : 'Switch to First Vote'}
            >
              <span className={`vote-switch-label ${mapVoteType === 'first' ? 'active' : ''}`}>1st</span>
              <span className="vote-switch-toggle">
                <span className={`vote-switch-dot ${mapVoteType === 'second' ? 'right' : ''}`} />
              </span>
              <span className={`vote-switch-label ${mapVoteType === 'second' ? 'active' : ''}`}>2nd</span>
            </button>
          </div>

          <ConstituencyMap
            year={year}
            winners={winnersData}
            votesBulk={votesBulk?.data ?? []}
            selectedConstituencyNumber={constituencyNumber}
            onSelectConstituency={handleMapSelect}
            voteType={mapVoteType}
            filteredStates={selectedStates}
          />
        </div>

        {/* Details Panel */}
        <div className="constituency-details-panel">
          {/* Combined Selector + Overview Card */}
          <div className="card constituency-combined-card">
            <div className="constituency-selector-row">
              <Autocomplete
                id="constituency"
                label=""
                items={constituencyItems}
                value={constituencyQuery}
                onChange={setConstituencyQuery}
                onSelect={(item) => {
                  setConstituencyId(item.id);
                  setConstituencyNumber(item.number);
                  setConstituencyQuery(getConstituencyLabel(item));
                }}
                getItemLabel={getConstituencyLabel}
                placeholder={loadingConstituencyList ? 'Loading…' : 'Search constituency...'}
                disabled={loadingConstituencyList}
              />
            </div>


            {constituencyListError && (
              <div className="warning-box" style={{ marginTop: '0.75rem' }}>
                <div className="warning-box-title">Could not load constituencies</div>
                <div>Backend may be unreachable.</div>
              </div>
            )}

            {/* Overview Stats */}
            {loadingOverview ? (
              <div className="loading" style={{ marginTop: '1rem' }}>
                <div className="spinner"></div>
                <div className="loading-text">Loading...</div>
              </div>
            ) : overview ? (
              <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '0.75rem', paddingTop: '0.75rem' }}>
                {/* Header row */}
                <div className="constituency-overview-header">
                  <div className="constituency-overview-title">
                    <span className="constituency-number">{overview.constituency.number}</span>
                    <h3>{overview.constituency.name}</h3>
                  </div>
                  <span className="constituency-state-badge">{overview.constituency.state}</span>
                </div>

                {/* Stats row */}
                <div className="constituency-stats-row">
                  <div className="constituency-stat">
                    <span className="constituency-stat-value">{overview.election_stats.turnout_percent?.toFixed(1)}%</span>
                    <span className="constituency-stat-label">Turnout</span>
                    {overview.comparison_to_2021 && (
                      <span className={`constituency-stat-diff ${overview.comparison_to_2021.turnout_diff_pts >= 0 ? 'positive' : 'negative'}`}>
                        {overview.comparison_to_2021.turnout_diff_pts > 0 ? '+' : ''}{overview.comparison_to_2021.turnout_diff_pts.toFixed(1)}pp
                      </span>
                    )}
                  </div>
                  <div className="constituency-stat">
                    <span className="constituency-stat-value">{overview.election_stats.total_voters?.toLocaleString()}</span>
                    <span className="constituency-stat-label">Voters</span>
                  </div>
                  <div className="constituency-stat">
                    <span className="constituency-stat-value">{overview.election_stats.valid_first?.toLocaleString() ?? '—'}</span>
                    <span className="constituency-stat-label">Valid 1st</span>
                  </div>
                  <div className="constituency-stat">
                    <span className="constituency-stat-value">{overview.election_stats.valid_second?.toLocaleString() ?? '—'}</span>
                    <span className="constituency-stat-label">Valid 2nd</span>
                  </div>
                </div>

                {/* Winner row */}
                {overview.winner && (
                  <div className="constituency-winner-row">
                    <div
                      className="constituency-winner-indicator"
                      style={{ backgroundColor: getPartyColor(overview.winner.party_name, partyOpts) }}
                    />
                    <div className="constituency-winner-info">
                      <div className="constituency-winner-name-row">
                        <span className="constituency-winner-name">{overview.winner.full_name}</span>
                        <span className="party-badge party-badge-sm" style={partyBadgeStyle(overview.winner.party_name, partyOpts)}>
                          {getPartyDisplayName(overview.winner.party_name, partyOpts)}
                        </span>
                      </div>
                      <div className="constituency-winner-details">
                        <span className="constituency-winner-votes">
                          <strong>{overview.winner.first_votes?.toLocaleString()}</strong> votes ({overview.winner.percent_of_valid?.toFixed(1)}%)
                        </span>
                        <span className={`seat-badge-inline ${overview.winner.got_seat ? 'seat-yes' : 'seat-no'}`}>
                          {overview.winner.got_seat ? '✓ Seat' : '✗ No seat'}
                        </span>
                      </div>
                    </div>
                    {overview.comparison_to_2021 && (
                      <div className="constituency-comparison-badge">
                        {overview.comparison_to_2021.winner_changed ? (
                          <span className="comparison-changed">
                            <UserPlus size={14} />
                            Changed
                          </span>
                        ) : (
                          <span className="comparison-same">
                            <Check size={14} />
                            Same
                          </span>
                        )}
                        <span className="comparison-prev">2021: {overview.comparison_to_2021.winner_2021}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="error" style={{ marginTop: '1rem' }}>Constituency not found</div>
            )}
            {/* State Filter Chips */}
            {uniqueStates.length > 0 && (
              <div className="state-filter-inline">
                <div className="state-filter-header">
                  <span className="state-filter-label">Filter by Federal State - Click to filter (multi-select)</span>
                  {selectedStates.size > 0 && (
                    <button className="state-filter-clear" onClick={clearStateFilters}>
                      <X size={12} /> Clear
                    </button>
                  )}
                </div>
                <div className="state-chips-container">
                  {uniqueStates.map(state => (
                    <button
                      key={state}
                      className={`state-chip ${selectedStates.has(state) ? 'active' : ''} ${selectedStates.size > 0 && !selectedStates.has(state) ? 'greyed' : ''}`}
                      onClick={() => toggleState(state)}
                    >
                      {state}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Vote Distribution with Toggle */}
          {overview && (
            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="card-title" style={{ fontSize: '1rem', margin: 0 }}>Vote Distribution</h3>
                <button
                  className="vote-type-switch"
                  onClick={() => setShowSingleVotes(!showSingleVotes)}
                  title={showSingleVotes ? 'Show aggregated votes' : 'Show single ballot votes (Q7)'}
                >
                  <span className={`vote-switch-label ${!showSingleVotes ? 'active' : ''}`}>Aggregated</span>
                  <span className="vote-switch-toggle">
                    <span className={`vote-switch-dot ${showSingleVotes ? 'right' : ''}`}></span>
                  </span>
                  <span className={`vote-switch-label ${showSingleVotes ? 'active' : ''}`}>Single</span>
                </button>
              </div>

              {showSingleVotes ? (
                loadingSingleVotes ? (
                  <div className="loading">
                    <div className="spinner"></div>
                  </div>
                ) : singleConstituency ? (
                  <div className="single-votes-container">
                    {/* First Votes (Candidates) */}
                    <div className="single-votes-section">
                      <h4 className="single-votes-title">First Votes (Candidates)</h4>
                      <div className="members-table-wrapper">
                        <div className="members-table-scroll">
                          <table className="table-compact members-table">
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
                        </div>
                        <div style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}>
                          Total: {singleConstituency.total_first_votes?.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    {/* Second Votes (Parties) */}
                    {singleConstituency.party_second_votes && singleConstituency.party_second_votes.length > 0 && (
                      <div className="single-votes-section">
                        <h4 className="single-votes-title">Second Votes (Party Lists)</h4>
                        <div className="members-table-wrapper">
                          <div className="members-table-scroll">
                            <table className="table-compact members-table">
                              <thead>
                                <tr>
                                  <th>Party</th>
                                  <th className="text-right">Votes</th>
                                </tr>
                              </thead>
                              <tbody>
                                {singleConstituency.party_second_votes.map((p, idx) => (
                                  <tr key={idx}>
                                    <td>
                                      <span
                                        className="party-badge party-badge-sm"
                                        style={partyBadgeStyle(p.party_name, partyOpts)}
                                      >
                                        {getPartyDisplayName(p.party_name, partyOpts)}
                                      </span>
                                    </td>
                                    <td className="text-right">{p.vote_count?.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}>
                            Total: {singleConstituency.total_second_votes?.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="error">No single vote data available</div>
                )
              ) : (
                <div className="members-table-wrapper">
                  <div className="members-table-scroll">
                    <table className="table-compact members-table">
                      <thead>
                        <tr>
                          <th>Party</th>
                          <th className="text-right">First</th>
                          <th className="text-right">Second</th>
                          {year === 2025 && <th className="text-right">vs 2021</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {overview.vote_distribution
                          .filter((party: VoteDistributionItem) => (party.first_votes || 0) > 0 || (party.second_votes || 0) > 0)
                          .map((party: VoteDistributionItem, idx: number) => (
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
                              {year === 2025 && (
                                <td className="text-right">
                                  {party.second_diff_pts != null ? (
                                    <span className={`diff-indicator ${party.second_diff_pts > 0 ? 'positive' : party.second_diff_pts < 0 ? 'negative' : ''}`}>
                                      {party.second_diff_pts > 0 ? (
                                        <><TrendingUp size={12} /> +{party.second_diff_pts.toFixed(1)}pp</>
                                      ) : party.second_diff_pts < 0 ? (
                                        <><TrendingDown size={12} /> {party.second_diff_pts.toFixed(1)}pp</>
                                      ) : (
                                        <span className="text-muted">—</span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-muted">—</span>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Closest Winners (Q6) */}
      {closestData.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <Award size={20} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Closest Races
            </h2>
            <div className="card-subtitle">
              Showing {(closestPage - 1) * CLOSEST_WINNERS_PER_PAGE + 1}–{Math.min(closestPage * CLOSEST_WINNERS_PER_PAGE, closestData.length)} of {closestData.length} narrowest margins
            </div>
          </div>
          <div className="members-table-wrapper">
            <div className="members-table-scroll">
              <table className="members-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Constituency</th>
                    <th>Winner</th>
                    <th>Runner-up</th>
                    <th className="text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedClosest.map((race: ClosestWinnerItem) => (
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
          {closestTotalPages > 1 && (
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                onClick={() => setClosestPage(p => Math.max(1, p - 1))}
                disabled={closestPage === 1}
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <span className="pagination-info">
                Page {closestPage} of {closestTotalPages}
              </span>
              <button
                className="pagination-btn"
                onClick={() => setClosestPage(p => Math.min(closestTotalPages, p + 1))}
                disabled={closestPage === closestTotalPages}
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Near Misses - Parties Without Constituency Wins (Q6 Extension)
      {nearMisses && Object.keys(nearMisses.data || {}).length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <Target size={20} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              Near Misses — Parties Without Constituency Wins
            </h2>
            <div className="card-subtitle">
              Closest losses for parties that did not win any direct mandates
            </div>
          </div>
          <div className="near-misses-grid">
            {Object.entries(nearMisses.data).map(([partyName, items]) => (
              <div key={partyName} className="near-miss-party-card">
                <div className="near-miss-party-header">
                  <span
                    className="party-badge"
                    style={partyBadgeStyle(partyName, partyOpts)}
                  >
                    {getPartyDisplayName(partyName, partyOpts)}
                  </span>
                  <span className="text-muted">{items.length} closest</span>
                </div>
                <div className="members-table-wrapper" style={{ marginTop: '0.5rem' }}>
                  <div className="members-table-scroll">
                    <table className="table-compact members-table">
                      <thead>
                        <tr>
                          <th>Constituency</th>
                          <th>Candidate</th>
                          <th className="text-right">Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item: NearMissItem, idx: number) => (
                          <tr
                            key={idx}
                            className="clickable-row"
                            onClick={() => handleMapSelect(item.constituency_number)}
                          >
                            <td>
                              <span className="text-muted">#{item.constituency_number}</span> {item.constituency_name}
                            </td>
                            <td>{item.candidate_name}</td>
                            <td className="text-right">
                              <strong>{item.margin_votes?.toLocaleString()}</strong>
                              <br />
                              <span className="text-muted">({item.margin_percent?.toFixed(2)}%)</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )} */}

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
          <div className="info-callout">
            <div className="info-callout-title">2023 Electoral Reform</div>
            <div className="info-callout-text">
              These candidates won their constituency but did not receive a seat because their party
              did not have enough second votes in the state (second-vote coverage rule).
            </div>
          </div>
          <div className="members-table-wrapper">
            <div className="members-table-scroll">
              <table className="members-table">
                <thead>
                  <tr>
                    <th>Constituency</th>
                    <th>Winner</th>
                    <th>Party</th>
                    <th>State</th>
                    <th className="text-right">First Votes</th>
                    <th className="text-right">Party 2nd Votes</th>
                  </tr>
                </thead>
                <tbody>
                  {lostMandates.data.map((mandate, idx: number) => (
                    <tr
                      key={idx}
                      className="clickable-row"
                      onClick={() => handleMapSelect(mandate.constituency_number)}
                    >
                      <td>
                        <span className="text-muted">#{mandate.constituency_number}</span> {mandate.constituency_name}
                      </td>
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
                      <td className="text-right">
                        {mandate.party_second_votes?.toLocaleString()}
                        <br />
                        <span className="text-muted">({mandate.party_second_percent?.toFixed(1)}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
