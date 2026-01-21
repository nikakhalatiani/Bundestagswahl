import { useEffect, useMemo, useState, useCallback } from 'react';
import {TrendingUp, TrendingDown, Award, AlertTriangle, ChevronLeft, ChevronRight, X, UserPlus, Check } from 'lucide-react';
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
import { getPartyDisplayName, getPartyColor } from '../utils/party';
import { cn } from '../utils/cn';
import { Card, CardHeader, CardSubtitle, CardTitle } from '../components/ui/Card';
import { PartyBadge } from '../components/ui/PartyBadge';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../components/ui/Table';

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
    <div className="flex flex-col gap-6">
      {/* Map + Details Main Grid */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        {/* Map Card */}
        <Card className="overflow-hidden xl:sticky xl:top-[167px] xl:max-h-[110vh] xl:self-start xl:z-10">
          <CardHeader className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>
                Constituency Map
              </CardTitle>
              <CardSubtitle>Click a constituency to view details</CardSubtitle>
            </div>
            <button
              className="flex items-center gap-2 rounded-full border border-line bg-surface-muted px-2 py-1.5 transition hover:border-ink-muted"
              onClick={() => setMapVoteType(prev => prev === 'first' ? 'second' : 'first')}
              title={mapVoteType === 'first' ? 'Switch to Second Vote' : 'Switch to First Vote'}
            >
              <span className={cn('text-[0.75rem] font-semibold text-ink-faint', mapVoteType === 'first' && 'text-ink')}>1st</span>
              <span className="relative h-[18px] w-8 rounded-full bg-surface-accent transition">
                <span className={cn('absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-brand-black transition-[left]', mapVoteType === 'second' && 'left-4')} />
              </span>
              <span className={cn('text-[0.75rem] font-semibold text-ink-faint', mapVoteType === 'second' && 'text-ink')}>2nd</span>
            </button>
          </CardHeader>

          <ConstituencyMap
            year={year}
            winners={winnersData}
            votesBulk={votesBulk?.data ?? []}
            selectedConstituencyNumber={constituencyNumber}
            onSelectConstituency={handleMapSelect}
            voteType={mapVoteType}
            filteredStates={selectedStates}
          />
        </Card>

        {/* Details Panel */}
        <div className="flex flex-col gap-4">
          {/* Combined Selector + Overview Card */}
          <Card className="p-3">
            <div>
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
                className="mb-0"
                inputClassName="px-3 py-2 text-[0.85rem]"
              />
            </div>


            {constituencyListError && (
              <div className="mt-3 rounded border-l-4 border-[#ff9800] bg-[#fff3e0] p-4">
                <div className="mb-2 font-semibold text-[#f57c00]">Could not load constituencies</div>
                <div>Backend may be unreachable.</div>
              </div>
            )}

            {/* Overview Stats */}
            {loadingOverview ? (
              <div className="mt-4 flex flex-col items-center justify-center px-8 py-10">
                <div className="h-[50px] w-[50px] animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-surface-accent border-t-brand-black"></div>
                <div className="mt-4 font-medium text-ink-muted">Loading...</div>
              </div>
            ) : overview ? (
              <div className="mt-3 border-t border-line pt-3">
                {/* Header row */}
                <div className="mb-3 flex items-center justify-between gap-3 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-surface-accent px-1.5 py-0.5 text-xs font-semibold text-ink-faint">{overview.constituency.number}</span>
                    <h3 className="text-[1.1rem] font-bold text-ink">{overview.constituency.name}</h3>
                  </div>
                  <span className="rounded bg-surface-accent px-3 py-1 text-[0.8rem] font-medium text-ink-muted">{overview.constituency.state}</span>
                </div>

                {/* Stats row */}
                <div className="mb-3 grid grid-cols-2 gap-2 pb-3 sm:grid-cols-4">
                  <div className="flex flex-col items-center justify-center gap-1 rounded border border-line bg-surface px-2 py-3 text-center">
                    <span className="text-base font-bold text-ink">{overview.election_stats.turnout_percent?.toFixed(1)}%</span>
                    <span className="text-[0.65rem] uppercase tracking-[0.03em] text-ink-faint">Turnout</span>
                    {overview.comparison_to_2021 && (
                      <span
                        className={cn(
                          'rounded px-1 py-0.5 text-[0.7rem] font-semibold',
                          overview.comparison_to_2021.turnout_diff_pts >= 0
                            ? 'bg-[#2e7d321a] text-[#2e7d32]'
                            : 'bg-[#c628281a] text-[#c62828]'
                        )}
                      >
                        {overview.comparison_to_2021.turnout_diff_pts > 0 ? '+' : ''}{overview.comparison_to_2021.turnout_diff_pts.toFixed(1)}pp
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-center justify-center gap-1 rounded border border-line bg-surface px-2 py-3 text-center">
                    <span className="text-base font-bold text-ink">{overview.election_stats.total_voters?.toLocaleString()}</span>
                    <span className="text-[0.65rem] uppercase tracking-[0.03em] text-ink-faint">Voters</span>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-1 rounded border border-line bg-surface px-2 py-3 text-center">
                    <span className="text-base font-bold text-ink">{overview.election_stats.valid_first?.toLocaleString() ?? '—'}</span>
                    <span className="text-[0.65rem] uppercase tracking-[0.03em] text-ink-faint">Valid 1st</span>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-1 rounded border border-line bg-surface px-2 py-3 text-center">
                    <span className="text-base font-bold text-ink">{overview.election_stats.valid_second?.toLocaleString() ?? '—'}</span>
                    <span className="text-[0.65rem] uppercase tracking-[0.03em] text-ink-faint">Valid 2nd</span>
                  </div>
                </div>

                {/* Winner row */}
                {overview.winner && (
                  <div className="flex items-stretch gap-3">
                    <div
                      className="w-1 flex-shrink-0 rounded"
                      style={{ backgroundColor: getPartyColor(overview.winner.party_name, partyOpts) }}
                    />
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.95rem] font-semibold text-ink">{overview.winner.full_name}</span>
                        <PartyBadge party={overview.winner.party_name} combineCduCsu size="sm">
                          {getPartyDisplayName(overview.winner.party_name, partyOpts)}
                        </PartyBadge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-[0.85rem] text-ink-muted">
                          <strong>{overview.winner.first_votes?.toLocaleString()}</strong> votes ({overview.winner.percent_of_valid?.toFixed(1)}%)
                        </span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[0.7rem] font-semibold',
                            overview.winner.got_seat ? 'bg-[#2e7d321f] text-[#2e7d32]' : 'bg-[#c628281f] text-[#c62828]'
                          )}
                        >
                          {overview.winner.got_seat ? '✓ Seat' : '✗ No seat'}
                        </span>
                      </div>
                    </div>
                    {overview.comparison_to_2021 && (
                      <div className="ml-auto flex flex-col items-end gap-1">
                        {overview.comparison_to_2021.winner_changed ? (
                          <span className="flex items-center gap-1 rounded bg-[#f57c001f] px-1.5 py-0.5 text-[0.7rem] font-semibold text-[#f57c00]">
                            <UserPlus size={14} />
                            Changed
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 rounded bg-[#2e7d321f] px-1.5 py-0.5 text-[0.7rem] font-semibold text-[#2e7d32]">
                            <Check size={14} />
                            Same
                          </span>
                        )}
                        <span className="text-[0.65rem] text-ink-faint">2021: {overview.comparison_to_2021.winner_2021}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border-2 border-[#d00] bg-[#fee] p-4 font-medium text-[#d00]">Constituency not found</div>
            )}
            {/* State Filter Chips */}
            {uniqueStates.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-ink-muted">Filter by Federal State - Click to filter (multi-select)</span>
                  {selectedStates.size > 0 && (
                    <button className="flex items-center gap-1 rounded px-2 py-1 text-[0.75rem] font-medium text-brand-red transition hover:bg-[#d000001a]" onClick={clearStateFilters}>
                      <X size={12} /> Clear
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {uniqueStates.map(state => {
                    const isSelected = selectedStates.has(state);
                    const isGreyed = selectedStates.size > 0 && !isSelected;
                    return (
                      <button
                        key={state}
                        className={cn(
                          'whitespace-nowrap rounded border border-line bg-surface-muted px-2 py-1 text-[0.65rem] font-medium text-ink-muted transition hover:border-ink-muted hover:bg-surface-accent',
                          isSelected && 'border-brand-black bg-brand-black text-white',
                          isGreyed && 'opacity-[0.4] hover:opacity-[0.7]'
                        )}
                        onClick={() => toggleState(state)}
                      >
                        {state}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* Vote Distribution with Toggle */}
          {overview && (
            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle className="text-base">Vote Distribution</CardTitle>
                <button
                  className="flex items-center gap-2 rounded-full border border-line bg-surface-muted px-2 py-1.5 transition hover:border-ink-muted"
                  onClick={() => setShowSingleVotes(!showSingleVotes)}
                  title={showSingleVotes ? 'Show aggregated votes' : 'Show single ballot votes (Q7)'}
                >
                  <span className={cn('text-[0.75rem] font-semibold text-ink-faint', !showSingleVotes && 'text-ink')}>Aggregated</span>
                  <span className="relative h-[18px] w-8 rounded-full bg-surface-accent transition">
                    <span className={cn('absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-brand-black transition-[left]', showSingleVotes && 'left-4')}></span>
                  </span>
                  <span className={cn('text-[0.75rem] font-semibold text-ink-faint', showSingleVotes && 'text-ink')}>Single</span>
                </button>
              </CardHeader>

              {showSingleVotes ? (
                loadingSingleVotes ? (
                  <div className="flex flex-col items-center justify-center px-8 py-10">
                    <div className="h-[50px] w-[50px] animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-surface-accent border-t-brand-black"></div>
                  </div>
                ) : singleConstituency ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* First Votes (Candidates) */}
                    <div className="min-w-0">
                      <h4 className="mb-2 pl-1 text-[0.85rem] font-semibold text-ink-muted">First Votes (Candidates)</h4>
                      <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
                        <div className="overflow-x-auto">
                          <Table variant="compact">
                            <TableHead>
                              <TableRow>
                                <TableHeaderCell>Candidate</TableHeaderCell>
                                <TableHeaderCell className="text-right">Votes</TableHeaderCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {singleConstituency.candidates.map((c, idx) => (
                                <TableRow key={idx} className={cn(c.is_winner && 'bg-[rgba(255,206,0,0.1)] font-semibold')}>
                                  <TableCell>
                                    {c.person_name}
                                    <br />
                                    <PartyBadge party={c.party_name} combineCduCsu size="sm">
                                      {getPartyDisplayName(c.party_name, partyOpts)}
                                    </PartyBadge>
                                  </TableCell>
                                  <TableCell className="text-right">{c.vote_count?.toLocaleString()}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        <div className="border-t border-line px-4 py-3 text-[0.8rem] text-ink-faint">
                          Total: {singleConstituency.total_first_votes?.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    {/* Second Votes (Parties) */}
                    {singleConstituency.party_second_votes && singleConstituency.party_second_votes.length > 0 && (
                      <div className="min-w-0">
                        <h4 className="mb-2 pl-1 text-[0.85rem] font-semibold text-ink-muted">Second Votes (Party Lists)</h4>
                        <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
                          <div className="overflow-x-auto">
                            <Table variant="compact">
                              <TableHead>
                                <TableRow>
                                  <TableHeaderCell>Party</TableHeaderCell>
                                  <TableHeaderCell className="text-right">Votes</TableHeaderCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {singleConstituency.party_second_votes.map((p, idx) => (
                                  <TableRow key={idx}>
                                    <TableCell>
                                      <PartyBadge party={p.party_name} combineCduCsu size="sm">
                                        {getPartyDisplayName(p.party_name, partyOpts)}
                                      </PartyBadge>
                                    </TableCell>
                                    <TableCell className="text-right">{p.vote_count?.toLocaleString()}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          <div className="border-t border-line px-4 py-3 text-[0.8rem] text-ink-faint">
                            Total: {singleConstituency.total_second_votes?.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border-2 border-[#d00] bg-[#fee] p-4 font-medium text-[#d00]">No single vote data available</div>
                )
              ) : (
                <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
                  <div className="overflow-x-auto">
                    <Table variant="compact">
                      <TableHead>
                        <TableRow>
                          <TableHeaderCell>Party</TableHeaderCell>
                          <TableHeaderCell className="text-right">First</TableHeaderCell>
                          <TableHeaderCell className="text-right">Second</TableHeaderCell>
                          {year === 2025 && <TableHeaderCell className="text-right">vs 2021</TableHeaderCell>}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {overview.vote_distribution
                          .filter((party: VoteDistributionItem) => (party.first_votes || 0) > 0 || (party.second_votes || 0) > 0)
                          .map((party: VoteDistributionItem, idx: number) => (
                            <TableRow key={idx}>
                              <TableCell>
                                <PartyBadge party={party.party_name} combineCduCsu size="sm">
                                  {getPartyDisplayName(party.party_name, partyOpts)}
                                </PartyBadge>
                              </TableCell>
                              <TableCell className="text-right">
                                {party.first_votes?.toLocaleString()}
                                <br />
                                <span className="text-[0.8rem] text-ink-faint">{party.first_percent?.toFixed(1)}%</span>
                              </TableCell>
                              <TableCell className="text-right">
                                {party.second_votes?.toLocaleString()}
                                <br />
                                <span className="text-[0.8rem] text-ink-faint">{party.second_percent?.toFixed(1)}%</span>
                              </TableCell>
                              {year === 2025 && (
                                <TableCell className="text-right">
                                  {party.second_diff_pts != null ? (
                                    <span className={cn(
                                      'inline-flex items-center gap-1 text-[0.8rem] font-medium',
                                      party.second_diff_pts > 0 ? 'text-[#16a34a]' : party.second_diff_pts < 0 ? 'text-[#dc2626]' : 'text-ink-faint'
                                    )}>
                                      {party.second_diff_pts > 0 ? (
                                        <><TrendingUp size={12} /> +{party.second_diff_pts.toFixed(1)}pp</>
                                      ) : party.second_diff_pts < 0 ? (
                                        <><TrendingDown size={12} /> {party.second_diff_pts.toFixed(1)}pp</>
                                      ) : (
                                        <span className="text-ink-faint">—</span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-ink-faint">—</span>
                                  )}
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Closest Winners (Q6) */}
      {closestData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Award size={20} className="mr-2 inline-block align-middle" />
              Closest Races
            </CardTitle>
            <CardSubtitle>
              Showing {(closestPage - 1) * CLOSEST_WINNERS_PER_PAGE + 1}–{Math.min(closestPage * CLOSEST_WINNERS_PER_PAGE, closestData.length)} of {closestData.length} narrowest margins
            </CardSubtitle>
          </CardHeader>
          <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
            <div className="overflow-x-auto">
              <Table variant="members">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>№</TableHeaderCell>
                    <TableHeaderCell>Constituency</TableHeaderCell>
                    <TableHeaderCell>Winner</TableHeaderCell>
                    <TableHeaderCell>Runner-up</TableHeaderCell>
                    <TableHeaderCell className="text-right">Margin</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedClosest.map((race: ClosestWinnerItem) => (
                    <TableRow
                      key={race.rank}
                      className="cursor-pointer transition-colors hover:bg-surface-muted"
                      onClick={() => {
                        // Parse constituency number from name if possible
                        const item = constituencyItems.find(c =>
                          race.constituency_name.includes(c.name) ||
                          race.constituency_name.startsWith(`${c.number} `)
                        );
                        if (item) handleMapSelect(item.number);
                      }}
                    >
                      <TableCell>{race.rank}</TableCell>
                      <TableCell>{race.constituency_name}</TableCell>
                      <TableCell>
                        {race.winner_name}
                        <br />
                        <PartyBadge party={race.winner_party} combineCduCsu size="sm">
                          {getPartyDisplayName(race.winner_party, partyOpts)}
                        </PartyBadge>
                      </TableCell>
                      <TableCell>
                        {race.runner_up_name}
                        <br />
                        <PartyBadge party={race.runner_up_party} combineCduCsu size="sm">
                          {getPartyDisplayName(race.runner_up_party, partyOpts)}
                        </PartyBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        <strong>{race.margin_votes?.toLocaleString()}</strong> votes
                        <br />
                        <span className="text-ink-faint">({race.margin_percent?.toFixed(3)}%)</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          {closestTotalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 px-4 py-3">
              <button
                className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 py-2 text-[0.85rem] font-medium text-ink transition hover:border-ink-muted hover:bg-surface-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-50"
                onClick={() => setClosestPage(p => Math.max(1, p - 1))}
                disabled={closestPage === 1}
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <span className="text-[0.85rem] font-medium text-ink-muted">
                Page {closestPage} of {closestTotalPages}
              </span>
              <button
                className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 py-2 text-[0.85rem] font-medium text-ink transition hover:border-ink-muted hover:bg-surface-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-50"
                onClick={() => setClosestPage(p => Math.min(closestTotalPages, p + 1))}
                disabled={closestPage === closestTotalPages}
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          )}
        </Card>
      )}

      {/* Direct Winners Without Coverage (Q5) */}
      {lostMandates && lostMandates.total_lost_mandates > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <AlertTriangle size={20} className="mr-2 inline-block align-middle" />
              Direct Winners Without Second-Vote Coverage
            </CardTitle>
            <CardSubtitle>
              {lostMandates.total_lost_mandates} constituency winners did not receive a seat
            </CardSubtitle>
          </CardHeader>
          <div className="mt-3 rounded border-l-4 border-brand-gold bg-surface-muted px-4 py-3">
            <div className="mb-1 text-[0.9rem] font-semibold text-ink">2023 Electoral Reform</div>
            <div className="text-[0.85rem] text-ink-muted">
              These candidates won their constituency but did not receive a seat because their party
              did not have enough second votes in the state (second-vote coverage rule).
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
            <div className="overflow-x-auto">
              <Table variant="members">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Constituency</TableHeaderCell>
                    <TableHeaderCell>Winner</TableHeaderCell>
                    <TableHeaderCell>Party</TableHeaderCell>
                    <TableHeaderCell>State</TableHeaderCell>
                    <TableHeaderCell className="text-right">First Votes</TableHeaderCell>
                    <TableHeaderCell className="text-right">Party 2nd Votes</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lostMandates.data.map((mandate, idx: number) => (
                    <TableRow
                      key={idx}
                      className="cursor-pointer transition-colors hover:bg-surface-muted"
                      onClick={() => handleMapSelect(mandate.constituency_number)}
                    >
                      <TableCell>
                        <span className="text-ink-faint">{mandate.constituency_number}</span> {mandate.constituency_name}
                      </TableCell>
                      <TableCell>{mandate.winner_name}</TableCell>
                      <TableCell>
                        <PartyBadge party={mandate.party_name} combineCduCsu size="sm">
                          {getPartyDisplayName(mandate.party_name, partyOpts)}
                        </PartyBadge>
                      </TableCell>
                      <TableCell>{mandate.state_name}</TableCell>
                      <TableCell className="text-right">
                        {mandate.first_votes?.toLocaleString()}
                        <br />
                        <span className="text-ink-faint">({mandate.percent_first_votes?.toFixed(1)}%)</span>
                      </TableCell>
                      <TableCell className="text-right">
                        {mandate.party_second_votes?.toLocaleString()}
                        <br />
                        <span className="text-ink-faint">({mandate.party_second_percent?.toFixed(1)}%)</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
