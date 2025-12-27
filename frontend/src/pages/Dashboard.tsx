import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';
import { useSeatDistribution } from '../hooks/useQueries';
import type { SeatDistributionItem } from '../types/api';
import { getPartyColor, getPartyDisplayName, partyBadgeStyle } from '../utils/party';

interface DashboardProps {
  year: number;
}

export function Dashboard({ year }: DashboardProps) {
  const { data, isLoading, error } = useSeatDistribution(year);

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

  const items: SeatDistributionItem[] = data.data;

  const partyOpts = { combineCduCsu: true };

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
  const combinedItems = Array.from(combinedMap.values()).sort((a, b) => b.seats - a.seats);

  const chartData = combinedItems.map((party) => ({
    name: party.party_name,
    value: party.seats,
  }));

  const totalSeats = combinedItems.reduce((sum, p) => sum + p.seats, 0);

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Seat distribution in the Bundestag {year}</h2>
          <div className="card-subtitle">Total seats: {totalSeats}</div>
        </div>

        <div className="dashboard-grid">
          <div>
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

          <div>
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
