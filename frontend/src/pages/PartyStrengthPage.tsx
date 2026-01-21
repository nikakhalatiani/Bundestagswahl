import { useMemo, useState } from 'react';
import { PartyStrengthMap } from '../components/PartyStrengthMap';
import { usePartyConstituencyStrength } from '../hooks/useQueries';
import { getPartyColor } from '../utils/party';
import { Card, CardHeader, CardSubtitle, CardTitle } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { cn } from '../utils/cn';

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
    <div className="flex flex-col gap-6">
      <Card className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <CardTitle>Party Strongholds & Shifts</CardTitle>
          <CardSubtitle>
            Explore where a party performs best and how its vote share has moved across constituencies.
          </CardSubtitle>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-2 rounded-full border border-line bg-surface-muted px-2 py-1.5 transition hover:border-ink-muted"
            onClick={() => setVoteType(prev => prev === 'first' ? 'second' : 'first')}
            title={voteType === 'first' ? 'Switch to Second Vote' : 'Switch to First Vote'}
          >
            <span className={cn('text-[0.75rem] font-semibold text-ink-faint', voteType === 'first' && 'text-ink')}>1st</span>
            <span className="relative h-[18px] w-8 rounded-full bg-surface-accent transition">
              <span className={cn('absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-brand-black transition-[left]', voteType === 'second' && 'left-4')} />
            </span>
            <span className={cn('text-[0.75rem] font-semibold text-ink-faint', voteType === 'second' && 'text-ink')}>2nd</span>
          </button>
          <div className="flex flex-col gap-1">
            <label className="text-[0.85rem] font-semibold uppercase tracking-[0.03em] text-ink-muted">Party</label>
            <Select
              value={selectedParty}
              onChange={(e) => setSelectedParty(e.target.value)}
              style={{ borderColor: partyColor }}
            >
              {PARTY_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {isLoading && (
        <div className="mt-4 flex flex-col items-center justify-center px-8 py-16">
          <div className="h-[50px] w-[50px] animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-surface-accent border-t-brand-black"></div>
          <div className="mt-4 font-medium text-ink-muted">Loading party maps...</div>
        </div>
      )}

      {error && (
        <div className="rounded border-l-4 border-[#ff9800] bg-[#fff3e0] p-4">
          <div className="mb-2 font-semibold text-[#f57c00]">Unable to load party data</div>
          <div>{String(error)}</div>
        </div>
      )}

      {!isLoading && !error && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                Where they were strongest
              </CardTitle>
              <CardSubtitle>
                {voteType === 'first' ? 'First vote share by constituency' : 'Second vote share by constituency'}
              </CardSubtitle>
            </CardHeader>
            <PartyStrengthMap
              year={year}
              partyName={selectedParty}
              data={strengthData}
              mode="strength"
            />
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                Where they gained/lost
              </CardTitle>
              <CardSubtitle>
                {voteType === 'first' ? 'Change in first vote share since 2021' : 'Change in second vote share since 2021'}
              </CardSubtitle>
            </CardHeader>
            {year !== 2025 ? (
              <div className="rounded border-l-4 border-[#ff9800] bg-[#fff3e0] p-4">
                <div className="mb-2 font-semibold text-[#f57c00]">Change data only available for 2025</div>
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
          </Card>
        </div>
      )}
    </div>
  );
}
