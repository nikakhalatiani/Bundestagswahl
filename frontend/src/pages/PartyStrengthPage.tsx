import { useMemo, useState } from 'react';
import { MapPin, TrendingUp } from 'lucide-react';
import { PartyStrengthMap } from '../components/PartyStrengthMap';
import { usePartyConstituencyStrength } from '../hooks/useQueries';
import { getPartyColor } from '../utils/party';

interface PartyStrengthPageProps {
  year: number;
}

const PARTY_OPTIONS = [
  { value: 'CDU/CSU', label: 'CDU/CSU' },
  { value: 'SPD', label: 'SPD' },
  { value: 'AfD', label: 'AfD' },
  { value: 'GRÜNE', label: 'Grüne' },
  { value: 'FDP', label: 'FDP' },
  { value: 'DIE LINKE', label: 'Linke' },
  { value: 'BSW', label: 'BSW' },
];

export function PartyStrengthPage({ year }: PartyStrengthPageProps) {
  const [selectedParty, setSelectedParty] = useState('SPD');
  const [voteType, setVoteType] = useState<'first' | 'second'>('second');
  const { data, isLoading, error } = usePartyConstituencyStrength(
    year,
    selectedParty,
    voteType === 'first' ? 1 : 2
  );
  const partyColor = useMemo(() => getPartyColor(selectedParty, { combineCduCsu: true }), [selectedParty]);

  const strengthData = data?.data ?? [];

  return (
    <div className="party-strength-page">
      <div className="card party-strength-header">
        <div>
          <h2 className="card-title">Party Strongholds & Shifts</h2>
          <div className="card-subtitle">
            Explore where a party performs best and how its vote share has moved across constituencies.
          </div>
        </div>
        <div className="party-strength-controls">
          <button
            className="vote-type-switch"
            onClick={() => setVoteType(prev => prev === 'first' ? 'second' : 'first')}
            title={voteType === 'first' ? 'Switch to Second Vote' : 'Switch to First Vote'}
          >
            <span className={`vote-switch-label ${voteType === 'first' ? 'active' : ''}`}>1st</span>
            <span className="vote-switch-toggle">
              <span className={`vote-switch-dot ${voteType === 'second' ? 'right' : ''}`} />
            </span>
            <span className={`vote-switch-label ${voteType === 'second' ? 'active' : ''}`}>2nd</span>
          </button>
          <div className="party-strength-select-wrap">
            <label className="party-strength-label">Party</label>
            <select
              className="party-strength-select"
              value={selectedParty}
              onChange={(e) => setSelectedParty(e.target.value)}
              style={{ borderColor: partyColor }}
            >
              {PARTY_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="loading" style={{ marginTop: '1rem' }}>
          <div className="spinner"></div>
          <div className="loading-text">Loading party maps...</div>
        </div>
      )}

      {error && (
        <div className="warning-box">
          <div className="warning-box-title">Unable to load party data</div>
          <div>{String(error)}</div>
        </div>
      )}

      {!isLoading && !error && (
        <div className="party-strength-grid">
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <MapPin size={20} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Where they were strongest
              </h2>
              <div className="card-subtitle">
                {voteType === 'first' ? 'First vote share by constituency' : 'Second vote share by constituency'}
              </div>
            </div>
            <PartyStrengthMap
              year={year}
              partyName={selectedParty}
              data={strengthData}
              mode="strength"
            />
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <TrendingUp size={20} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Where they gained/lost
              </h2>
              <div className="card-subtitle">
                {voteType === 'first' ? 'Change in first vote share since 2021' : 'Change in second vote share since 2021'}
              </div>
            </div>
            {year !== 2025 ? (
              <div className="warning-box">
                <div className="warning-box-title">Change data only available for 2025</div>
                <div>Switch to 2025 to view gains and losses by constituency.</div>
              </div>
            ) : (
              <PartyStrengthMap
                year={year}
                partyName={selectedParty}
                data={strengthData}
                mode="change"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
