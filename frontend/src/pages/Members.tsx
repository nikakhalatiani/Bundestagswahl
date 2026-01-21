import { Fragment, useMemo, useState } from 'react';
import { Users, MapPin, Briefcase, User, Search, Calendar, ListOrdered, Percent, Download, ChevronLeft, ChevronRight, UserPlus } from 'lucide-react';
import { useMembers } from '../hooks/useQueries';
import type { MemberItem } from '../types/api';
import { getPartyDisplayName, getPartyColor } from '../utils/party';
import { cn } from '../utils/cn';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardSubtitle, CardTitle } from '../components/ui/Card';
import { PartyBadge } from '../components/ui/PartyBadge';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../components/ui/Table';

interface MembersProps {
  year: number;
}

const ITEMS_PER_PAGE = 50;

export function Members({ year }: MembersProps) {
  const { data, isLoading, error } = useMembers(year);
  const [selectedParties, setSelectedParties] = useState<Set<string>>(new Set());
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [filterSeatType, setFilterSeatType] = useState<'all' | 'direct' | 'list'>('all');
  const [filterGender, setFilterGender] = useState<'all' | 'm' | 'w'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'new' | 'reelected'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'party' | 'state' | 'mandate' | 'constituency' | 'age'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedMember, setSelectedMember] = useState<MemberItem | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const partyOpts = useMemo(() => ({ combineCduCsu: true }), []);

  const items: MemberItem[] = useMemo(() => data?.data ?? [], [data]);

  const displayParty = (partyName: string) => getPartyDisplayName(partyName, partyOpts);

  // Toggle party multi-select
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
    setCurrentPage(1);
  };

  // Toggle state multi-select
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
    setCurrentPage(1);
  };

  const filteredData = useMemo(() => {
    return items.filter((member) => {
      const partyName = displayParty(member.party_name);
      if (selectedParties.size > 0 && !selectedParties.has(partyName)) return false;
      if (selectedStates.size > 0 && !selectedStates.has(member.state_name)) return false;
      if (filterSeatType !== 'all') {
        const isDirect = member.seat_type.toLowerCase().includes('direct');
        if (filterSeatType === 'direct' && !isDirect) return false;
        if (filterSeatType === 'list' && isDirect) return false;
      }
      if (filterGender !== 'all' && member.gender?.toLowerCase() !== filterGender) return false;
      if (filterStatus === 'new' && member.previously_elected) return false;
      if (filterStatus === 'reelected' && !member.previously_elected) return false;
      if (searchTerm) {
        const fullName = `${member.first_name} ${member.last_name}`.toLowerCase();
        if (!fullName.includes(searchTerm.toLowerCase())) return false;
      }
      return true;
    });
  }, [items, selectedParties, selectedStates, filterSeatType, filterGender, filterStatus, searchTerm]);

  // Party distribution should always show all parties, even when filters are active
  const allPartyStats = useMemo(() => {
    const totals: Record<string, number> = {};
    items.forEach(member => {
      const partyName = displayParty(member.party_name);
      totals[partyName] = (totals[partyName] || 0) + 1;
    });
    return totals;
  }, [items, displayParty]);

  const sortedData = useMemo(() => {
    const getAge = (m: MemberItem) => (m.birth_year ? year - m.birth_year : null);

    const compare = (a: MemberItem, b: MemberItem) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const nameA = `${a.last_name} ${a.first_name}`;
      const nameB = `${b.last_name} ${b.first_name}`;
      const partyA = displayParty(a.party_name);
      const partyB = displayParty(b.party_name);
      const ageA = getAge(a);
      const ageB = getAge(b);

      switch (sortKey) {
        case 'party':
          return partyA.localeCompare(partyB) * dir;
        case 'state':
          return a.state_name.localeCompare(b.state_name) * dir;
        case 'mandate': {
          const mandateA = a.seat_type.toLowerCase();
          const mandateB = b.seat_type.toLowerCase();
          return mandateA.localeCompare(mandateB) * dir;
        }
        case 'constituency':
          return (a.constituency_name || '').localeCompare(b.constituency_name || '') * dir;
        case 'age': {
          if (ageA == null && ageB == null) return 0;
          if (ageA == null) return 1;
          if (ageB == null) return -1;
          return (ageA - ageB) * dir;
        }
        case 'name':
        default:
          return nameA.localeCompare(nameB) * dir;
      }
    };

    return [...filteredData].sort(compare);
  }, [filteredData, sortDir, sortKey, displayParty, year]);

  // Pagination
  const totalPages = Math.ceil(sortedData.length / ITEMS_PER_PAGE);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedData.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedData, currentPage]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };

  // Stats including new/reelected and age distribution
  const stats = useMemo(() => {
    const genderCounts = { m: 0, w: 0 };
    const seatTypeCounts = { direct: 0, list: 0 };
    const statusCounts = { new: 0, reelected: 0 };
    let totalAge = 0;
    let ageCount = 0;
    const partyStats: Record<string, number> = {};
    const professionStats: Record<string, number> = {};
    const stateStats: Record<string, { total: number; direct: number; list: number }> = {};
    const ageRanges: Record<string, number> = {
      '18-29': 0,
      '30-39': 0,
      '40-49': 0,
      '50-59': 0,
      '60-69': 0,
      '70+': 0,
    };

    filteredData.forEach(m => {
      if (m.gender) {
        const g = m.gender.toLowerCase();
        if (g === 'm') genderCounts.m++;
        else if (g === 'w') genderCounts.w++;
      }
      const isDirect = m.seat_type.toLowerCase().includes('direct');
      if (isDirect) seatTypeCounts.direct++;
      else seatTypeCounts.list++;

      if (m.previously_elected) statusCounts.reelected++;
      else statusCounts.new++;

      if (m.birth_year) {
        const age = year - m.birth_year;
        totalAge += age;
        ageCount++;
        if (age < 30) ageRanges['18-29']++;
        else if (age < 40) ageRanges['30-39']++;
        else if (age < 50) ageRanges['40-49']++;
        else if (age < 60) ageRanges['50-59']++;
        else if (age < 70) ageRanges['60-69']++;
        else ageRanges['70+']++;
      }

      const party = displayParty(m.party_name);
      partyStats[party] = (partyStats[party] || 0) + 1;

      if (m.profession) {
        professionStats[m.profession] = (professionStats[m.profession] || 0) + 1;
      }

      if (!stateStats[m.state_name]) {
        stateStats[m.state_name] = { total: 0, direct: 0, list: 0 };
      }
      stateStats[m.state_name].total++;
      if (isDirect) stateStats[m.state_name].direct++;
      else stateStats[m.state_name].list++;
    });

    const avgAge = ageCount > 0 ? (totalAge / ageCount).toFixed(1) : 'N/A';
    const femalePercent = filteredData.length > 0
      ? ((genderCounts.w / filteredData.length) * 100).toFixed(1)
      : '0';

    const topProfessions = Object.entries(professionStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const stateDistribution = Object.entries(stateStats)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total);

    return { genderCounts, seatTypeCounts, statusCounts, avgAge, femalePercent, partyStats, ageRanges, topProfessions, stateDistribution };
  }, [filteredData, year, displayParty]);

  // All states distribution (from all items, not filtered) for greyed out display
  const allStateDistribution = useMemo(() => {
    const stateStats: Record<string, { total: number; direct: number; list: number }> = {};
    items.forEach(m => {
      const isDirect = m.seat_type.toLowerCase().includes('direct');
      if (!stateStats[m.state_name]) {
        stateStats[m.state_name] = { total: 0, direct: 0, list: 0 };
      }
      stateStats[m.state_name].total++;
      if (isDirect) stateStats[m.state_name].direct++;
      else stateStats[m.state_name].list++;
    });
    return Object.entries(stateStats)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [items]);

  // Export to CSV
  const exportToCSV = () => {
    const headers = ['Title', 'First Name', 'Last Name', 'Party', 'State', 'Seat Type', 'Constituency', 'Age', 'Gender', 'Profession', 'Status'];
    const rows = sortedData.map(m => [
      m.title || '',
      m.first_name,
      m.last_name,
      displayParty(m.party_name),
      m.state_name,
      m.seat_type.toLowerCase().includes('direct') ? 'Direct' : 'List',
      m.constituency_name || '',
      m.birth_year ? String(year - m.birth_year) : '',
      m.gender || '',
      m.profession || '',
      m.previously_elected ? 'Re-elected' : 'New'
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bundestag_members_${year}.csv`;
    link.click();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center px-8 py-16">
        <div className="h-[50px] w-[50px] animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-surface-accent border-t-brand-black"></div>
        <div className="mt-4 font-medium text-ink-muted">Loading members...</div>
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

  const hasActiveFilters = selectedParties.size > 0 || selectedStates.size > 0 || filterSeatType !== 'all' || filterGender !== 'all' || filterStatus !== 'all' || searchTerm;
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

      <div className="w-full">
        <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-ink-muted">
              <MapPin size={20} />
            </div>
            <div className="flex flex-col">
              <div className="text-[1.1rem] font-bold leading-tight text-ink">{stats.seatTypeCounts.direct}</div>
              <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">Direct Mandates</div>
            </div>
          </div>
          <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-ink-muted">
              <ListOrdered size={20} />
            </div>
            <div className="flex flex-col">
              <div className="text-[1.1rem] font-bold leading-tight text-ink">{stats.seatTypeCounts.list}</div>
              <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">List Mandates</div>
            </div>
          </div>
          <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-ink-muted">
              <UserPlus size={20} />
            </div>
            <div className="flex flex-col">
              <div className="text-[1.1rem] font-bold leading-tight text-ink">{stats.statusCounts.new}</div>
              <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">New Members</div>
            </div>
          </div>
          <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-ink-muted">
              <Users size={20} />
            </div>
            <div className="flex flex-col">
              <div className="text-[1.1rem] font-bold leading-tight text-ink">{stats.statusCounts.reelected}</div>
              <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">Re-elected</div>
            </div>
          </div>
          <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-ink-muted">
              <Calendar size={20} />
            </div>
            <div className="flex flex-col">
              <div className="text-[1.1rem] font-bold leading-tight text-ink">{stats.avgAge}</div>
              <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">Avg. Age</div>
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-col items-stretch gap-2 rounded-lg border border-line bg-surface p-4">
            <div className="text-[0.75rem] uppercase tracking-[0.5px] text-ink-faint">Gender</div>
            <div className="flex items-center gap-2">
              <div className="flex h-2 flex-1 overflow-hidden rounded bg-[#eeeeee]">
                <div className="bg-[#e91e63]" style={{ width: `${stats.femalePercent}%` }} title="Female" />
                <div className="flex-1 bg-[#2196f3]" title="Male" />
              </div>
            </div>
            <div className="flex justify-between text-xs text-ink-muted">
              <span>{stats.femalePercent}% F</span>
              <span>{(100 - Number(stats.femalePercent)).toFixed(1)}% M</span>
            </div>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>Members of the Bundestag {year}</CardTitle>
            <CardSubtitle>
              {filteredData.length} of {items.length} members shown
            </CardSubtitle>
          </div>
          <Button variant="secondary" className="ml-auto self-start" onClick={exportToCSV} title="Export to CSV">
            <Download size={16} />
            <span>Export CSV</span>
          </Button>
        </CardHeader>
        <div className="flex flex-col gap-6">
          <div className="min-w-0">
            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <input
                    type="text"
                    placeholder="Search by name..."
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                    className="w-full rounded-md border border-line bg-surface-muted px-3 py-2 pl-9 text-[0.9rem] transition focus:border-ink-faint focus:bg-surface focus:outline-none focus:ring-2 focus:ring-black/5"
                  />
                </div>

                <select
                  value={filterSeatType}
                  onChange={(e) => { setFilterSeatType(e.target.value as 'all' | 'direct' | 'list'); setCurrentPage(1); }}
                  className={filterSelectClass}
                  title="Filter by seat type"
                >
                  <option value="all">All Mandates</option>
                  <option value="direct">Direct Only</option>
                  <option value="list">List Only</option>
                </select>

                <select
                  value={filterGender}
                  onChange={(e) => { setFilterGender(e.target.value as 'all' | 'm' | 'w'); setCurrentPage(1); }}
                  className={filterSelectClass}
                  title="Filter by gender"
                >
                  <option value="all">All Genders</option>
                  <option value="m">Male</option>
                  <option value="w">Female</option>
                </select>

                <select
                  value={filterStatus}
                  onChange={(e) => { setFilterStatus(e.target.value as 'all' | 'new' | 'reelected'); setCurrentPage(1); }}
                  className={filterSelectClass}
                  title="Filter by member status"
                >
                  <option value="all">All Members</option>
                  <option value="new">New Members</option>
                  <option value="reelected">Re-elected</option>
                </select>
              </div>
            </div>

            {hasActiveFilters && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-surface-accent px-3 py-2 text-[0.85rem] text-ink-muted">
                <span>{filteredData.length} of {items.length} members match filters</span>
                <button
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[0.8rem] font-semibold text-ink-muted transition hover:bg-black/5 hover:text-ink"
                  onClick={() => {
                    setSelectedParties(new Set());
                    setSelectedStates(new Set());
                    setFilterSeatType('all');
                    setFilterGender('all');
                    setFilterStatus('all');
                    setSearchTerm('');
                    setCurrentPage(1);
                  }}
                >
                  ✕ Clear
                </button>
              </div>
            )}

            <div className="mt-4 overflow-hidden rounded-[14px] border border-line bg-surface shadow-sm">
              <div className="overflow-x-auto">
                <Table variant="members">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>
                        <button className="inline-flex items-center gap-1.5 text-left font-bold tracking-[0.2px] text-ink hover:text-ink-muted" onClick={() => toggleSort('name')}>
                          <span>Name</span>
                          <span className="text-[0.85rem] leading-none">{sortKey === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </TableHeaderCell>
                      <TableHeaderCell>
                        <button className="inline-flex items-center gap-1.5 text-left font-bold tracking-[0.2px] text-ink hover:text-ink-muted" onClick={() => toggleSort('party')}>
                          <span>Party</span>
                          <span className="text-[0.85rem] leading-none">{sortKey === 'party' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </TableHeaderCell>
                      <TableHeaderCell>
                        <button className="inline-flex items-center gap-1.5 text-left font-bold tracking-[0.2px] text-ink hover:text-ink-muted" onClick={() => toggleSort('state')}>
                          <span>State</span>
                          <span className="text-[0.85rem] leading-none">{sortKey === 'state' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </TableHeaderCell>
                      <TableHeaderCell>
                        <button className="inline-flex items-center gap-1.5 text-left font-bold tracking-[0.2px] text-ink hover:text-ink-muted" onClick={() => toggleSort('mandate')}>
                          <span>Mandate</span>
                          <span className="text-[0.85rem] leading-none">{sortKey === 'mandate' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </TableHeaderCell>
                      <TableHeaderCell>
                        <button className="inline-flex items-center gap-1.5 text-left font-bold tracking-[0.2px] text-ink hover:text-ink-muted" onClick={() => toggleSort('constituency')}>
                          <span>Constituency</span>
                          <span className="text-[0.85rem] leading-none">{sortKey === 'constituency' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </TableHeaderCell>
                      <TableHeaderCell className="text-center">
                        <button className="inline-flex items-center gap-1.5 text-left font-bold tracking-[0.2px] text-ink hover:text-ink-muted" onClick={() => toggleSort('age')}>
                          <span>Age</span>
                          <span className="text-[0.85rem] leading-none">{sortKey === 'age' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {paginatedData.map((member) => {
                      const isSelected = selectedMember?.person_id === member.person_id;
                      const selectedColor = isSelected ? getPartyColor(member.party_name, partyOpts) : undefined;
                      const isDirect = member.seat_type.toLowerCase().includes('direct');

                      return (
                        <Fragment key={member.person_id}>
                          <TableRow
                            className={cn(
                              'cursor-pointer transition-colors hover:bg-surface-accent',
                              isSelected && 'bg-surface-accent'
                            )}
                            onClick={() => setSelectedMember(isSelected ? null : member)}
                            style={isSelected ? { boxShadow: `inset 4px 0 0 ${selectedColor}` } : undefined}
                          >
                            <TableCell>
                              <div className="text-ink">
                                {member.title ? `${member.title} ` : ''}
                                <strong className="font-semibold">{member.last_name}</strong>, {member.first_name}
                              </div>
                              {member.profession && (
                                <div className="mt-0.5 max-w-[200px] truncate text-[0.8rem] text-ink-faint">{member.profession}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              <PartyBadge party={member.party_name} combineCduCsu>
                                {displayParty(member.party_name)}
                              </PartyBadge>
                            </TableCell>
                            <TableCell>{member.state_name}</TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  'inline-block rounded px-2 py-1 text-[0.75rem] font-semibold uppercase tracking-[0.5px] text-white',
                                  isDirect ? 'bg-[#4caf50]' : 'bg-[#2196f3]'
                                )}
                              >
                                {isDirect ? 'Direct' : 'List'}
                              </span>
                            </TableCell>
                            <TableCell>{member.constituency_name || '—'}</TableCell>
                            <TableCell className="text-center">
                              {member.birth_year ? year - member.birth_year : '—'}
                            </TableCell>
                          </TableRow>
                          {isSelected && (
                            <TableRow>
                              <TableCell colSpan={6} className="p-0">
                                <div className="border-t border-line bg-surface-muted px-6 py-4">
                                  <div className="flex flex-wrap items-center justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                      <div
                                        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
                                        style={{ backgroundColor: getPartyColor(member.party_name, partyOpts) }}
                                      >
                                        {member.first_name[0]}{member.last_name[0]}
                                      </div>
                                      <div className="flex flex-col gap-1">
                                        <div className="text-[1rem] font-semibold text-ink">
                                          {member.title ? `${member.title} ` : ''}
                                          {member.first_name} {member.last_name}
                                        </div>
                                        <PartyBadge party={member.party_name} combineCduCsu size="sm">
                                          {displayParty(member.party_name)}
                                        </PartyBadge>
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <span
                                        className={cn(
                                          'inline-block rounded px-2 py-1 text-[0.75rem] font-semibold uppercase tracking-[0.5px] text-white',
                                          isDirect ? 'bg-[#4caf50]' : 'bg-[#2196f3]'
                                        )}
                                      >
                                        {isDirect ? 'Direct Mandate' : 'List Mandate'}
                                      </span>
                                      {member.previously_elected ? (
                                        <span className="inline-block rounded px-2 py-1 text-[0.75rem] font-semibold uppercase tracking-[0.5px] text-white bg-[#9613a2]">
                                          Re-elected
                                        </span>
                                      ) : (
                                        <span className="inline-block rounded px-2 py-1 text-[0.75rem] font-semibold uppercase tracking-[0.5px] text-white bg-[#ff9800]">
                                          New Member
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <div className="flex items-start gap-3 text-ink-muted">
                                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface text-ink-muted">
                                        <MapPin size={18} />
                                      </div>
                                      <div>
                                        <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">Region / Constituency</div>
                                        <div className="font-medium text-ink">{member.constituency_name || member.state_name}</div>
                                      </div>
                                    </div>

                                    {member.profession && (
                                      <div className="flex items-start gap-3 text-ink-muted">
                                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface text-ink-muted">
                                          <Briefcase size={18} />
                                        </div>
                                        <div>
                                          <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">Profession</div>
                                          <div className="font-medium text-ink">{member.profession}</div>
                                        </div>
                                      </div>
                                    )}

                                    {(member.birth_year || member.gender) && (
                                      <div className="flex items-start gap-3 text-ink-muted">
                                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface text-ink-muted">
                                          <User size={18} />
                                        </div>
                                        <div>
                                          <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">Personal Details</div>
                                          <div className="font-medium text-ink">
                                            {member.gender ? `${member.gender.toLowerCase() === 'm' ? 'Male' : member.gender.toLowerCase() === 'w' ? 'Female' : member.gender}` : ''}
                                            {member.gender && member.birth_year ? ', ' : ''}
                                            {member.birth_year ? `${year - member.birth_year} years old` : ''}
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    {member.percent_first_votes != null && isDirect && (
                                      <div className="flex items-start gap-3 text-ink-muted">
                                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface text-ink-muted">
                                          <Percent size={18} />
                                        </div>
                                        <div>
                                          <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">First Vote Share</div>
                                          <div className="font-medium text-ink">{member.percent_first_votes.toFixed(1)}%</div>
                                        </div>
                                      </div>
                                    )}

                                    {member.list_position != null && (
                                      <div className="flex items-start gap-3 text-ink-muted">
                                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface text-ink-muted">
                                          <ListOrdered size={18} />
                                        </div>
                                        <div>
                                          <div className="text-xs uppercase tracking-[0.5px] text-ink-muted">List Position</div>
                                          <div className="font-medium text-ink">{member.list_position}</div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3 px-4 py-3">
                <button
                  className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 py-2 text-[0.85rem] font-medium text-ink transition hover:border-ink-muted hover:bg-surface-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-50"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft size={16} />
                  Prev
                </button>
                <div className="text-[0.85rem] font-medium text-ink-muted">
                  Page {currentPage} of {totalPages}
                  <span className="ml-2 text-[0.8rem] text-ink-faint">
                    ({(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, sortedData.length)} of {sortedData.length})
                  </span>
                </div>
                <button
                  className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 py-2 text-[0.85rem] font-medium text-ink transition hover:border-ink-muted hover:bg-surface-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-50"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Party Distribution</CardTitle>
          <CardSubtitle>Share of all members by party</CardSubtitle>
        </CardHeader>
        <div className="flex flex-col gap-3">
          {Object.entries(allPartyStats)
            .sort((a, b) => b[1] - a[1])
            .map(([party, count]) => {
              const pct = items.length > 0 ? (count / items.length) * 100 : 0;
              const isSelected = selectedParties.has(party);
              const isDimmed = selectedParties.size > 0 && !isSelected;
              return (
                <div
                  key={party}
                  className={cn(
                    'cursor-pointer rounded-lg border border-line bg-surface-muted p-4 transition hover:border-ink-faint hover:shadow-sm',
                    isSelected && 'border-ink shadow-[0_0_0_2px_rgba(0,0,0,0.1)]',
                    isDimmed && 'opacity-[0.45]'
                  )}
                  onClick={() => toggleParty(party)}
                >
                  <div className="mb-3 h-2 overflow-hidden rounded bg-surface-accent">
                    <div
                      className="h-full rounded transition-[width] duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: getPartyColor(party, partyOpts)
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <PartyBadge party={party} combineCduCsu>
                      {party}
                    </PartyBadge>
                    <span className="text-[0.85rem] font-medium text-ink-muted">{count} ({pct.toFixed(1)}%)</span>
                  </div>
                </div>
              );
            })}
        </div>
      </Card>
    </div>
  );
}
