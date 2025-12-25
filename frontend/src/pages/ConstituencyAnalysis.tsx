import { useState } from 'react';
import { useConstituencyOverview, useClosestWinners, useDirectWithoutCoverage } from '../hooks/useQueries';
import type { ClosestWinnerItem, VoteDistributionItem } from '../types/api';

interface ConstituencyAnalysisProps {
  year: number;
}

export function ConstituencyAnalysis({ year }: ConstituencyAnalysisProps) {
  const [constituencyId, setConstituencyId] = useState(1);
  const { data: overview, isLoading: loadingOverview } = useConstituencyOverview(constituencyId, year);
  const { data: closest } = useClosestWinners(year, 5);
  const { data: lostMandates } = useDirectWithoutCoverage(year);

  return (
    <div>
      {/* Constituency Overview */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Constituency overview</h2>
        </div>

        <div className="form-group">
          <label className="form-label">Enter constituency ID</label>
          <input
            type="number"
            className="form-input"
            value={constituencyId}
            onChange={(e) => setConstituencyId(Number(e.target.value))}
            min="1"
            max="299"
            placeholder="1-299"
          />
        </div>

        {loadingOverview ? (
          <div className="loading">
            <div className="spinner"></div>
            <div className="loading-text">Loading constituency data...</div>
          </div>
        ) : overview ? (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Constituency</div>
                <div className="stat-value" style={{ fontSize: '1.2rem' }}>
                  {overview.constituency.name}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Turnout</div>
                <div className="stat-value">
                  {overview.election_stats.turnout_percent?.toFixed(1)}%
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Eligible voters</div>
                <div className="stat-value" style={{ fontSize: '1.5rem' }}>
                  {overview.election_stats.eligible_voters?.toLocaleString()}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Voters</div>
                <div className="stat-value" style={{ fontSize: '1.5rem' }}>
                  {overview.election_stats.total_voters?.toLocaleString()}
                </div>
              </div>
            </div>

            {overview.winner && (
              <div className="card" style={{ background: '#f9f9f9', marginTop: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>Constituency winner</h3>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  {overview.winner.full_name}
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <span className={`party-badge party-${overview.winner.party_name.toLowerCase().replace(/ü/g, 'u')}`}>
                    {overview.winner.party_name}
                  </span>
                  {' '}
                  <span className={`seat-badge ${overview.winner.got_seat ? 'seat-direct' : 'seat-none'}`}>
                    {overview.winner.got_seat ? 'Seat awarded' : 'No seat'}
                  </span>
                </div>
                <div>
                  <strong>{overview.winner.first_votes?.toLocaleString()}</strong> first votes
                  ({overview.winner.percent_of_valid?.toFixed(2)}%)
                </div>
              </div>
            )}

            {overview.comparison_to_2021 && (
              <div className="info-box" style={{ marginTop: '1.5rem' }}>
                <div className="info-box-title">Comparison to 2021 election</div>
                <div className="info-box-text">
                  Turnout: {overview.comparison_to_2021.turnout_diff_pts > 0 ? '+' : ''}
                  {overview.comparison_to_2021.turnout_diff_pts.toFixed(1)} percentage points
                  <br />
                  Winner in 2021: {overview.comparison_to_2021.winner_2021}
                  <br />
                  {overview.comparison_to_2021.winner_changed ? '✓ Winner changed' : '○ Same winner'}
                </div>
              </div>
            )}

            <h3 style={{ marginTop: '2rem', marginBottom: '1rem' }}>Vote distribution by party</h3>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Party</th>
                    <th className="text-right">First votes</th>
                    <th className="text-right">Second votes</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.vote_distribution.map((party: VoteDistributionItem, idx: number) => (
                    <tr key={idx}>
                      <td>
                        <span className={`party-badge party-${party.party_name.toLowerCase().replace(/ü/g, 'u').replace(/\s/g, '')}`}>
                          {party.party_name}
                        </span>
                      </td>
                      <td className="text-right">
                        {party.first_votes?.toLocaleString()} ({party.first_percent?.toFixed(1)}%)
                      </td>
                      <td className="text-right">
                        {party.second_votes?.toLocaleString()} ({party.second_percent?.toFixed(1)}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="error">Constituency not found</div>
        )}
      </div>

      {/* Closest Winners */}
      {closest && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Closest races</h2>
            <div className="card-subtitle">Smallest winning margins</div>
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
                  <tr key={race.rank}>
                    <td>{race.rank}</td>
                    <td>{race.constituency_name}</td>
                    <td>
                      {race.winner_name}
                      <br />
                      <span className={`party-badge party-${race.winner_party.toLowerCase().replace(/ü/g, 'u')}`}>
                        {race.winner_party}
                      </span>
                    </td>
                    <td>
                      {race.runner_up_name}
                      <br />
                      <span className={`party-badge party-${race.runner_up_party.toLowerCase().replace(/ü/g, 'u')}`}>
                        {race.runner_up_party}
                      </span>
                    </td>
                    <td className="text-right">
                      {race.margin_votes} votes
                      <br />
                      ({race.margin_percent?.toFixed(3)}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lost Mandates */}
      {lostMandates && lostMandates.total_lost_mandates > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Direct winners without second-vote coverage</h2>
            <div className="card-subtitle">
              {lostMandates.total_lost_mandates} constituency winners did not receive a seat
            </div>
          </div>
          <div className="warning-box">
            <div className="warning-box-title">2023 electoral reform</div>
            <div>
              These candidates won their constituency but did not receive a seat because their party did not have
              enough second votes in the state (second-vote coverage rule).
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
                  <th className="text-right">First votes</th>
                </tr>
              </thead>
              <tbody>
                {lostMandates.data.map((mandate, idx: number) => (
                  <tr key={idx}>
                    <td>{mandate.constituency_name}</td>
                    <td>{mandate.winner_name}</td>
                    <td>
                      <span className={`party-badge party-${mandate.party_name.toLowerCase().replace(/ü/g, 'u')}`}>
                        {mandate.party_name}
                      </span>
                    </td>
                    <td>{mandate.state_name}</td>
                    <td className="text-right">
                      {mandate.first_votes?.toLocaleString()}
                      <br />
                      ({mandate.percent_first_votes?.toFixed(1)}%)
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
