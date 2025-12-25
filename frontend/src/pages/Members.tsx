import { useState } from 'react';
import { useMembers } from '../hooks/useQueries';
import type { MemberItem } from '../types/api';

interface MembersProps {
  year: number;
}

export function Members({ year }: MembersProps) {
  const { data, isLoading, error } = useMembers(year);
  const [filterParty, setFilterParty] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterSeatType, setFilterSeatType] = useState('');

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

  const items: MemberItem[] = data.data;

  // Get unique values for filters
  const parties = [...new Set(items.map((m) => m.party_name))].sort();
  const states = [...new Set(items.map((m) => m.state_name))].sort();
  const seatTypes = [...new Set(items.map((m) => m.seat_type))].sort();

  // Apply filters
  const filteredData = items.filter((member) => {
    if (filterParty && member.party_name !== filterParty) return false;
    if (filterState && member.state_name !== filterState) return false;
    if (filterSeatType && member.seat_type !== filterSeatType) return false;
    return true;
  });

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Members of Parliament {year}</h2>
          <div className="card-subtitle">Total: {filteredData.length} of {items.length} members</div>
        </div>

        <div className="stats-grid">
          <div className="form-group">
            <label className="form-label">Filter by party</label>
            <select
              className="form-input"
              value={filterParty}
              onChange={(e) => setFilterParty(e.target.value)}
            >
              <option value="">All parties</option>
              {parties.map((party: string) => (
                <option key={party} value={party}>{party}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Filter by state</label>
            <select
              className="form-input"
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
            >
              <option value="">All states</option>
              {states.map((state: string) => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Filter by seat type</label>
            <select
              className="form-input"
              value={filterSeatType}
              onChange={(e) => setFilterSeatType(e.target.value)}
            >
              <option value="">All types</option>
              {seatTypes.map((type: string) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Party</th>
                <th>State</th>
                <th>Seat Type</th>
                <th>Constituency</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((member) => (
                <tr key={member.person_id}>
                  <td>
                    {member.title ? `${member.title} ` : ''}
                    {member.first_name} {member.last_name}
                  </td>
                  <td>
                    <span
                      className={`party-badge party-${member.party_name.toLowerCase().replace(/ü/g, 'u').replace(/\s/g, '')}`}
                    >
                      {member.party_name}
                    </span>
                  </td>
                  <td>{member.state_name}</td>
                  <td>
                    <span
                      className={`seat-badge ${member.seat_type.includes('Direct') ? 'seat-direct' : 'seat-list'
                        }`}
                    >
                      {member.seat_type.includes('Direct') ? 'Direct mandate' : 'List seat'}
                    </span>
                  </td>
                  <td>{member.constituency_name || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
