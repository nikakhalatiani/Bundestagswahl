import { useMemo, useState } from 'react';
import { Users, MapPin, Briefcase, User, Search, Award, Calendar, ListOrdered, Percent } from 'lucide-react';
import { useMembers } from '../hooks/useQueries';
import type { MemberItem } from '../types/api';
import { getPartyDisplayName, getPartyColor, partyBadgeStyle } from '../utils/party';

interface MembersProps {
  year: number;
}

export function Members({ year }: MembersProps) {
  const { data, isLoading, error } = useMembers(year);
  const [filterParty, setFilterParty] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterSeatType, setFilterSeatType] = useState<'all' | 'direct' | 'list'>('all');
  const [filterGender, setFilterGender] = useState<'all' | 'm' | 'w'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'new' | 'reelected'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'party' | 'state' | 'mandate' | 'constituency' | 'age'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedMember, setSelectedMember] = useState<MemberItem | null>(null);

  const partyOpts = useMemo(() => ({ combineCduCsu: true }), []);

  const items: MemberItem[] = useMemo(() => data?.data ?? [], [data]);

  const displayParty = (partyName: string) => getPartyDisplayName(partyName, partyOpts);

  const parties = useMemo(() =>
    [...new Set(items.map((m) => displayParty(m.party_name)))].sort(),
    [items]
  );
  const states = useMemo(() =>
    [...new Set(items.map((m) => m.state_name))].sort(),
    [items]
  );

  const filteredData = useMemo(() => {
    return items.filter((member) => {
      if (filterParty && displayParty(member.party_name) !== filterParty) return false;
      if (filterState && member.state_name !== filterState) return false;
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
  }, [items, filterParty, filterState, filterSeatType, filterGender, filterStatus, searchTerm]);

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

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const stats = useMemo(() => {
    const genderCounts = { m: 0, w: 0 };
    const seatTypeCounts = { direct: 0, list: 0 };
    let totalAge = 0;
    let ageCount = 0;
    const partyStats: Record<string, number> = {};

    filteredData.forEach(m => {
      if (m.gender) {
        const g = m.gender.toLowerCase();
        if (g === 'm') genderCounts.m++;
        else if (g === 'w') genderCounts.w++;
      }
      if (m.seat_type.toLowerCase().includes('direct')) seatTypeCounts.direct++;
      else seatTypeCounts.list++;
      if (m.birth_year) {
        totalAge += (year - m.birth_year);
        ageCount++;
      }
      const party = displayParty(m.party_name);
      partyStats[party] = (partyStats[party] || 0) + 1;
    });

    const avgAge = ageCount > 0 ? (totalAge / ageCount).toFixed(1) : 'N/A';
    const femalePercent = filteredData.length > 0
      ? ((genderCounts.w / filteredData.length) * 100).toFixed(1)
      : '0';

    return { genderCounts, seatTypeCounts, avgAge, femalePercent, partyStats };
  }, [filteredData, year]);

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

  return (
    <div>
      <div className="card mb-1">
        <div className="card-header">
          <h2 className="card-title">Members of the Bundestag {year}</h2>
          <div className="card-subtitle">
            {filteredData.length} of {items.length} members shown
          </div>
        </div>
        <div className="quick-stats-grid">
          <div className="quick-stat-card">
            <div className="quick-stat-icon">
              <Users size={20} />
            </div>
            <div className="quick-stat-content">
              <div className="quick-stat-value">{filteredData.length}</div>
              <div className="quick-stat-label">Total Members</div>
            </div>
          </div>
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
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                </div>

                <select
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                  className="filter-select"
                  title="Filter by state"
                >
                  <option value="">All States</option>
                  {states.map((state: string) => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>

                <select
                  value={filterSeatType}
                  onChange={(e) => setFilterSeatType(e.target.value as 'all' | 'direct' | 'list')}
                  className="filter-select"
                  title="Filter by seat type"
                >
                  <option value="all">All Mandates</option>
                  <option value="direct">Direct Only</option>
                  <option value="list">List Only</option>
                </select>

                <select
                  value={filterGender}
                  onChange={(e) => setFilterGender(e.target.value as 'all' | 'm' | 'w')}
                  className="filter-select"
                  title="Filter by gender"
                >
                  <option value="all">All Genders</option>
                  <option value="m">Male</option>
                  <option value="w">Female</option>
                </select>

                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as 'all' | 'new' | 'reelected')}
                  className="filter-select"
                  title="Filter by member status"
                >
                  <option value="all">All Members</option>
                  <option value="new">New Members</option>
                  <option value="reelected">Re-elected</option>
                </select>
              </div>
            </div>

            {(filterParty || filterState || filterSeatType !== 'all' || filterGender !== 'all' || filterStatus !== 'all' || searchTerm) && (
              <div className="filter-summary">
                <span>{filteredData.length} of {items.length} members match filters</span>
                <button
                  className="filter-clear-btn"
                  onClick={() => {
                    setFilterParty('');
                    setFilterState('');
                    setFilterSeatType('all');
                    setFilterGender('all');
                    setFilterStatus('all');
                    setSearchTerm('');
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
                    {sortedData.slice(0, 100).map((member) => {
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
            {sortedData.length > 100 && (
              <div className="table-pagination-info">
                Showing first 100 of {sortedData.length} members. Use filters to refine.
              </div>
            )}
          </div>

          <div className="info-panel">
            <div className="info-panel-header">
              <h3>Members & Parties</h3>
            </div>
            <div className="info-panel-content">
              {selectedMember && (
                <div className="info-grid">
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

              <div className={`party-dist-vertical ${selectedMember ? 'mt-1' : ''}`}>
                <div className="panel-title">Party Distribution</div>
                {Object.entries(stats.partyStats)
                  .sort((a, b) => b[1] - a[1])
                  .map(([party, count]) => {
                    const pct = filteredData.length > 0 ? (count / filteredData.length) * 100 : 0;
                    return (
                      <div
                        key={party}
                        className={`party-dist-card ${filterParty === party ? 'is-selected' : ''}`}
                        onClick={() => setFilterParty(filterParty === party ? '' : party)}
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
                          <span className="party-dist-count-text">{count} seats ({pct.toFixed(1)}%)</span>
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
  );
}
