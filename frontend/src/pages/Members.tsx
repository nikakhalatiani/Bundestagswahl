import { useMemo, useState } from 'react';
import { Users, MapPin, Briefcase, User, Search, Calendar, ListOrdered, Percent, Download, ChevronLeft, ChevronRight, Star, UserPlus } from 'lucide-react';
import { useMembers } from '../hooks/useQueries';
import type { MemberItem } from '../types/api';
import { getPartyDisplayName, getPartyColor, partyBadgeStyle } from '../utils/party';

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
      <div className="loading">
        <div className="spinner"></div>
        <div className="loading-text">Loading members...</div>
      </div>
    );
  }

  if (error) {
    return <div className="error">Failed to load data: {String(error)}</div>;
  }

  if (!data) {
    return <div className="error">No data returned.</div>;
  }

  const hasActiveFilters = selectedParties.size > 0 || selectedStates.size > 0 || filterSeatType !== 'all' || filterGender !== 'all' || filterStatus !== 'all' || searchTerm;

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

      <div className="quickstats-strip mb-1">
        <div className="quick-stats-grid">
          <div className="quick-stat-card">
            <div className="quick-stat-icon">
              <MapPin size={20} />
            </div>
            <div className="quick-stat-content">
              <div className="quick-stat-value">{stats.seatTypeCounts.direct}</div>
              <div className="quick-stat-label">Direct Mandates</div>
            </div>
          </div>
          <div className="quick-stat-card">
            <div className="quick-stat-icon">
              <ListOrdered size={20} />
            </div>
            <div className="quick-stat-content">
              <div className="quick-stat-value">{stats.seatTypeCounts.list}</div>
              <div className="quick-stat-label">List Mandates</div>
            </div>
          </div>
          <div className="quick-stat-card">
            <div className="quick-stat-icon">
              <UserPlus size={20} />
            </div>
            <div className="quick-stat-content">
              <div className="quick-stat-value">{stats.statusCounts.new}</div>
              <div className="quick-stat-label">New Members</div>
            </div>
          </div>
          <div className="quick-stat-card">
            <div className="quick-stat-icon">
              <Users size={20} />
            </div>
            <div className="quick-stat-content">
              <div className="quick-stat-value">{stats.statusCounts.reelected}</div>
              <div className="quick-stat-label">Re-elected</div>
            </div>
          </div>
          <div className="quick-stat-card">
            <div className="quick-stat-icon">
              <Calendar size={20} />
            </div>
            <div className="quick-stat-content">
              <div className="quick-stat-value">{stats.avgAge}</div>
              <div className="quick-stat-label">Avg. Age</div>
            </div>
          </div>
          <div className="quick-stat-card gender-stat-card">
            <div className="quick-stat-content gender-stat-content">
              <div className="quick-stat-label">Gender</div>
              <div className="gender-bar-container">
                <div className="gender-bar-track">
                  <div className="gender-bar-female" style={{ width: `${stats.femalePercent}%` }} title="Female" />
                  <div className="gender-bar-male" title="Male" />
                </div>
              </div>
              <div className="gender-labels">
                <span>{stats.femalePercent}% F</span>
                <span>{(100 - Number(stats.femalePercent)).toFixed(1)}% M</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header members-card-header">
          <div className="members-header-left">
            <h2 className="card-title">Members of the Bundestag {year}</h2>
            <div className="card-subtitle">
              {filteredData.length} of {items.length} members shown
            </div>
          </div>
          <button className="btn btn-secondary export-btn" onClick={exportToCSV} title="Export to CSV">
            <Download size={16} />
            <span>Export CSV</span>
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
                    placeholder="Search by name..."
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                    className="search-input"
                  />
                </div>

                <select
                  value={filterSeatType}
                  onChange={(e) => { setFilterSeatType(e.target.value as 'all' | 'direct' | 'list'); setCurrentPage(1); }}
                  className="filter-select"
                  title="Filter by seat type"
                >
                  <option value="all">All Mandates</option>
                  <option value="direct">Direct Only</option>
                  <option value="list">List Only</option>
                </select>

                <select
                  value={filterGender}
                  onChange={(e) => { setFilterGender(e.target.value as 'all' | 'm' | 'w'); setCurrentPage(1); }}
                  className="filter-select"
                  title="Filter by gender"
                >
                  <option value="all">All Genders</option>
                  <option value="m">Male</option>
                  <option value="w">Female</option>
                </select>

                <select
                  value={filterStatus}
                  onChange={(e) => { setFilterStatus(e.target.value as 'all' | 'new' | 'reelected'); setCurrentPage(1); }}
                  className="filter-select"
                  title="Filter by member status"
                >
                  <option value="all">All Members</option>
                  <option value="new">New Members</option>
                  <option value="reelected">Re-elected</option>
                </select>
              </div>
            </div>

            {hasActiveFilters && (
              <div className="filter-summary">
                <span>{filteredData.length} of {items.length} members match filters</span>
                <button
                  className="filter-clear-btn"
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

            <div className="members-table-wrapper">
              <div className="members-table-scroll">
                <table className="party-table members-table">
                  <thead>
                    <tr>
                      <th>
                        <button className="sortable-header" onClick={() => toggleSort('name')}>
                          <span className="sortable-label">Name</span>
                          <span className="sort-caret">{sortKey === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </th>
                      <th>
                        <button className="sortable-header" onClick={() => toggleSort('party')}>
                          <span className="sortable-label">Party</span>
                          <span className="sort-caret">{sortKey === 'party' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </th>
                      <th>
                        <button className="sortable-header" onClick={() => toggleSort('state')}>
                          <span className="sortable-label">State</span>
                          <span className="sort-caret">{sortKey === 'state' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </th>
                      <th>
                        <button className="sortable-header" onClick={() => toggleSort('mandate')}>
                          <span className="sortable-label">Mandate</span>
                          <span className="sort-caret">{sortKey === 'mandate' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </th>
                      <th>
                        <button className="sortable-header" onClick={() => toggleSort('constituency')}>
                          <span className="sortable-label">Constituency</span>
                          <span className="sort-caret">{sortKey === 'constituency' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </th>
                      <th className="text-center">
                        <button className="sortable-header" onClick={() => toggleSort('age')}>
                          <span className="sortable-label">Age</span>
                          <span className="sort-caret">{sortKey === 'age' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedData.map((member) => {
                      const isSelected = selectedMember?.person_id === member.person_id;
                      const selectedColor = isSelected ? getPartyColor(member.party_name, partyOpts) : undefined;
                      return (
                        <tr
                          key={member.person_id}
                          className={`table-row-interactive ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => setSelectedMember(isSelected ? null : member)}
                          style={isSelected ? { boxShadow: `inset 4px 0 0 ${selectedColor}` } : undefined}
                        >
                          <td>
                            <div className="member-name-display">
                              {member.title ? `${member.title} ` : ''}
                              <strong>{member.last_name}</strong>, {member.first_name}
                            </div>
                            {member.profession && (
                              <div className="member-profession-text">{member.profession}</div>
                            )}
                          </td>
                          <td>
                            <span
                              className="party-badge"
                              style={partyBadgeStyle(member.party_name, partyOpts)}
                            >
                              {displayParty(member.party_name)}
                            </span>
                          </td>
                          <td>{member.state_name}</td>
                          <td>
                            <span
                              className={`seat-badge ${member.seat_type.toLowerCase().includes('direct') ? 'seat-direct' : 'seat-list'}`}
                            >
                              {member.seat_type.toLowerCase().includes('direct') ? 'Direct' : 'List'}
                            </span>
                          </td>
                          <td>{member.constituency_name || '—'}</td>
                          <td className="text-center">
                            {member.birth_year ? year - member.birth_year : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="pagination-controls">
                <button
                  className="pagination-btn"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft size={16} />
                  Prev
                </button>
                <div className="pagination-info">
                  Page {currentPage} of {totalPages}
                  <span className="pagination-range">
                    ({(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, sortedData.length)} of {sortedData.length})
                  </span>
                </div>
                <button
                  className="pagination-btn"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>

          <div className="info-panel">
            <div className="info-panel-header">
              <h3>Analytics</h3>
            </div>
            <div className="info-panel-content">
              {selectedMember && (
                <div className="info-grid mb-1">
                  <div className="panel-title">Member Details</div>
                  <div className="member-panel-header">
                    <div
                      className="member-avatar-large"
                      style={{ backgroundColor: getPartyColor(selectedMember.party_name, partyOpts) }}
                    >
                      {selectedMember.first_name[0]}{selectedMember.last_name[0]}
                    </div>
                    <div className="member-panel-name">
                      <h4>
                        {selectedMember.title ? `${selectedMember.title} ` : ''}
                        {selectedMember.first_name} {selectedMember.last_name}
                      </h4>
                      <span
                        className="party-badge party-badge-fixed"
                        style={partyBadgeStyle(selectedMember.party_name, partyOpts)}
                      >
                        {displayParty(selectedMember.party_name)}
                      </span>
                    </div>
                  </div>

                  <div className="member-badges">
                    <span className={`seat-badge ${selectedMember.seat_type.toLowerCase().includes('direct') ? 'seat-direct' : 'seat-list'}`}>
                      {selectedMember.seat_type.toLowerCase().includes('direct') ? 'Direct Mandate' : 'List Mandate'}
                    </span>
                    {selectedMember.previously_elected ? (
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
                      <div className="info-content">
                        <div className="info-label">Region / Constituency</div>
                        <div className="info-value">{selectedMember.constituency_name || selectedMember.state_name}</div>
                      </div>
                    </div>

                    {selectedMember.profession && (
                      <div className="info-item">
                        <div className="info-icon">
                          <Briefcase size={18} />
                        </div>
                        <div className="info-content">
                          <div className="info-label">Profession</div>
                          <div className="info-value">{selectedMember.profession}</div>
                        </div>
                      </div>
                    )}

                    {(selectedMember.birth_year || selectedMember.gender) && (
                      <div className="info-item">
                        <div className="info-icon">
                          <User size={18} />
                        </div>
                        <div className="info-content">
                          <div className="info-label">Personal Details</div>
                          <div className="info-value">
                            {selectedMember.gender ? `${selectedMember.gender.toLowerCase() === 'm' ? 'Male' : selectedMember.gender.toLowerCase() === 'w' ? 'Female' : selectedMember.gender}` : ''}
                            {selectedMember.gender && selectedMember.birth_year ? ', ' : ''}
                            {selectedMember.birth_year ? `${year - selectedMember.birth_year} years old` : ''}
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedMember.percent_first_votes != null && selectedMember.seat_type.toLowerCase().includes('direct') && (
                      <div className="info-item">
                        <div className="info-icon">
                          <Percent size={18} />
                        </div>
                        <div className="info-content">
                          <div className="info-label">First Vote Share</div>
                          <div className="info-value">{selectedMember.percent_first_votes.toFixed(1)}%</div>
                        </div>
                      </div>
                    )}

                    {selectedMember.list_position != null && (
                      <div className="info-item">
                        <div className="info-icon">
                          <ListOrdered size={18} />
                        </div>
                        <div className="info-content">
                          <div className="info-label">List Position</div>
                          <div className="info-value">{selectedMember.list_position}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Party Distribution */}
              <div className="sidebar-section">
                <div className="panel-title">Party Distribution</div>
                <div className="party-dist-vertical">
                  {Object.entries(allPartyStats)
                    .sort((a, b) => b[1] - a[1])
                    .map(([party, count]) => {
                      const pct = items.length > 0 ? (count / items.length) * 100 : 0;
                      const isSelected = selectedParties.has(party);
                      const isDimmed = selectedParties.size > 0 && !isSelected;
                      return (
                        <div
                          key={party}
                          className={`party-dist-card ${isSelected ? 'is-selected' : ''} ${isDimmed ? 'is-greyed' : ''}`}
                          onClick={() => toggleParty(party)}
                        >
                          <div className="party-dist-bar-bg">
                            <div
                              className="party-dist-bar-fill"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: getPartyColor(party, partyOpts)
                              }}
                            />
                          </div>
                          <div className="party-dist-info">
                            <span
                              className="party-badge"
                              style={partyBadgeStyle(party, partyOpts)}
                            >
                              {party}
                            </span>
                            <span className="party-dist-count-text">{count} ({pct.toFixed(1)}%)</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
