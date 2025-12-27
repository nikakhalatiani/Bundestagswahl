import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';
import { useMembers, useSeatDistribution } from '../hooks/useQueries';
import type { SeatDistributionItem } from '../types/api';
import { Hemicycle, type Seat } from '../components/parliament/Hemicycle';
import { SidePanel } from '../components/parliament/SidePanel';
import { getPartyColor, getPartyDisplayName, partyBadgeStyle } from '../utils/party';

interface DashboardProps {
  year: number;
}

export function Dashboard({ year }: DashboardProps) {
  const { data, isLoading, error } = useSeatDistribution(year);
  const { data: membersRes, isLoading: isMembersLoading, error: membersError } = useMembers(year);

  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [showHemicycle, setShowHemicycle] = useState(false);
  const [renderPie, setRenderPie] = useState(true);

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

  const chartData = useMemo(() => {
    return combinedItems.map((party) => ({
      name: party.party_name,
      value: party.seats,
    }));
  }, [combinedItems]);

  const totalSeats = useMemo(() => {
    return combinedItems.reduce((sum, p) => sum + p.seats, 0);
  }, [combinedItems]);

  const seats: Seat[] = useMemo(() => {
    const members = membersRes?.data ?? [];
    return members.map((m) => ({
      id: String(m.person_id),
      party: m.party_name,
      seatType: m.seat_type.toLowerCase().includes('direct') ? 'direct' : 'list',
      memberName: `${m.title ? `${m.title} ` : ''}${m.first_name} ${m.last_name}`,
      region: m.state_name,
      constituency: m.constituency_name || undefined,
      percentage: m.percent_first_votes ?? undefined,
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

  useEffect(() => {
    // One-time fold transition: pie folds out → hemicycle folds in.
    // If members are unavailable, keep the pie.
    if (isMembersLoading) return;
    if (membersError) return;
    if (seats.length === 0) return;

    setShowHemicycle(false);
    setRenderPie(true);
    const t = window.setTimeout(() => setShowHemicycle(true), 380);
    return () => window.clearTimeout(t);
  }, [year, isMembersLoading, membersError, seats.length]);

  useEffect(() => {
    if (!showHemicycle) return;
    const t = window.setTimeout(() => setRenderPie(false), 600);
    return () => window.clearTimeout(t);
  }, [showHemicycle]);

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
            <div className="viz-stage" style={{ height: 400 }}>
              {renderPie && (
                <div className={`viz-pane viz-pane--pie ${showHemicycle ? 'is-hidden' : 'is-visible'}`}>
                  <ResponsiveContainer width="100%" height={400}>
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={120}
                        label={(entry) => `${entry.name}: ${entry.value}`}
                      >
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={getPartyColor(entry.name, partyOpts)} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className={`viz-pane viz-pane--hemi ${showHemicycle ? 'is-visible' : 'is-hidden'}`}>
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
                  />
                )}
              </div>
            </div>
          </div>

          <div>
            <SidePanel
              open={Boolean(selectedSeat)}
              seat={
                selectedSeat
                  ? {
                    id: selectedSeat.id,
                    memberName: selectedSeat.memberName,
                    party: selectedPartyLabel,
                    seatType: selectedSeat.seatType,
                    region: selectedSeat.region,
                    constituency: selectedSeat.constituency,
                    percentage: selectedSeat.percentage,
                  }
                  : null
              }
              partyColor={selectedPartyColor}
              onClose={() => setSelectedSeatId(null)}
            />

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Party</th>
                    <th className="text-right">Seats</th>
                    <th className="text-right">Share (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {combinedItems.map((party) => (
                    <tr key={party.party_name}>
                      <td>
                        <span
                          className="party-badge"
                          style={partyBadgeStyle(party.party_name, partyOpts)}
                        >
                          {party.party_name}
                        </span>
                      </td>
                      <td className="text-right">{party.seats}</td>
                      <td className="text-right">
                        {((party.seats / totalSeats) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
