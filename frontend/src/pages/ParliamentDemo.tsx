import { useMemo, useState } from 'react';
import { Hemicycle, type Seat } from '../components/parliament/Hemicycle';
import { SidePanel } from '../components/parliament/SidePanel';
import { getPartyColor, getPartyDisplayName } from '../utils/party';
import { useMembers } from '../hooks/useQueries';

function makeDummySeats(total: number): Seat[] {
    // Simple deterministic dummy generator with richer detail fields.
    const parties = ['SPD', 'CDU', 'CSU', 'AfD', 'GRÜNE', 'DIE LINKE', 'FDP', 'SSW'] as const;
    const regions = ['Berlin', 'Bayern', 'Hamburg', 'Brandenburg', 'Sachsen', 'NRW', 'Hessen'];
    const constituencies = [
        'Berlin-Mitte',
        'Hamburg-Nord',
        'München-Süd',
        'Köln I',
        'Frankfurt am Main I',
        'Stuttgart I',
        'Düsseldorf I',
        'Leipzig I',
        'Dresden I',
        'Hannover-Mitte',
        'Potsdam',
        'Freiburg',
    ];
    const professions = ['Lawyer', 'Teacher', 'Engineer', 'Doctor', 'Journalist', 'Economist', 'Civil Servant'];
    const committees = [
        'Foreign Affairs',
        'Interior',
        'Finance',
        'Health',
        'Transport',
        'Environment',
        'Digital Agenda',
    ];
    const firstNames = ['Anna', 'Thomas', 'Maria', 'Michael', 'Lisa', 'Sebastian', 'Sarah', 'Christian', 'Julia', 'Markus'];
    const lastNames = ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann'];

    const seats: Seat[] = [];
    for (let i = 0; i < total; i += 1) {
        const party = parties[i % parties.length];
        const firstName = firstNames[i % firstNames.length];
        const lastName = lastNames[(i * 7) % lastNames.length];
        const seatType: Seat['seatType'] = i % 3 === 0 ? 'direct' : 'list';

        const firstElected = 2005 + (i % 21);
        const isNewMember = firstElected === 2025;
        const yearsInParliament = isNewMember ? 0 : 2025 - firstElected;

        seats.push({
            id: `dummy-${i}`,
            party,
            seatType,
            memberName: `${firstName} ${lastName}`,
            region: regions[i % regions.length],
            constituency: seatType === 'direct' ? constituencies[i % constituencies.length] : undefined,
            votes: seatType === 'direct' ? 35000 + (i % 20000) : undefined,
            percentage: seatType === 'direct' ? 32 + ((i % 180) / 10) : undefined,
            age: 28 + (i % 46),
            profession: professions[i % professions.length],
            firstElected,
            yearsInParliament,
            isNewMember,
            committees: [committees[i % committees.length], committees[(i + 3) % committees.length]].slice(0, 1 + (i % 2)),
            previousPosition: !isNewMember && i % 7 === 0 ? 'State Parliament Member' : undefined,
        });
    }
    return seats;
}

type Props = {
    year: number;
};

export function ParliamentDemo({ year }: Props) {
    const { data: membersRes, isLoading, error } = useMembers(year);

    const [useLiveData, setUseLiveData] = useState(true);
    const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);

    const seats: Seat[] = useMemo(() => {
        if (!useLiveData) return makeDummySeats(630);

        const items = membersRes?.data ?? [];
        if (items.length === 0) return makeDummySeats(630);

        return items.map((m) => ({
            id: String(m.person_id),
            party: m.party_name,
            seatType: m.seat_type.toLowerCase().includes('direct') ? 'direct' : 'list',
            memberName: `${m.title ? `${m.title} ` : ''}${m.first_name} ${m.last_name}`,
            region: m.state_name,
            constituency: m.constituency_name || undefined,
        }));
    }, [membersRes?.data, useLiveData]);

    const partyOpts = useMemo(() => ({ combineCduCsu: true }), []);

    const partyCounts = useMemo(() => {
        const map = new Map<string, number>();
        for (const s of seats) {
            const key = getPartyDisplayName(s.party, partyOpts);
            map.set(key, (map.get(key) ?? 0) + 1);
        }
        return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    }, [seats, partyOpts]);

    const allParties = useMemo(() => partyCounts.map(([p]) => p), [partyCounts]);
    const [activeParties, setActiveParties] = useState<Set<string>>(new Set());

    const effectiveFilter = activeParties.size > 0 ? activeParties : undefined;

    const selectedSeat = useMemo(() => {
        return seats.find((s) => s.id === selectedSeatId) ?? null;
    }, [seats, selectedSeatId]);

    const selectedPartyLabel = selectedSeat ? getPartyDisplayName(selectedSeat.party, partyOpts) : '';
    const selectedPartyColor = selectedSeat ? getPartyColor(selectedSeat.party, partyOpts) : getPartyColor('', partyOpts);

    return (
        <div>
            <div className="card">
                <div className="card-header">
                    <h2 className="card-title">Parliament hemicycle</h2>
                    <div className="card-subtitle">Hover for tooltip, click for details</div>
                </div>

                <div className="stats-grid">
                    <div className="form-group">
                        <label className="form-label">Data source</label>
                        <select
                            className="form-input"
                            value={useLiveData ? 'live' : 'dummy'}
                            onChange={(e) => setUseLiveData(e.target.value === 'live')}
                        >
                            <option value="live">Live (members endpoint)</option>
                            <option value="dummy">Dummy dataset</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Filter by party</label>
                        <select
                            className="form-input"
                            value=""
                            onChange={(e) => {
                                const party = e.target.value;
                                if (!party) return;
                                setActiveParties((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(party)) next.delete(party);
                                    else next.add(party);
                                    return next;
                                });
                            }}
                        >
                            <option value="">Toggle a party…</option>
                            {allParties.map((p) => (
                                <option key={p} value={p}>
                                    {p}
                                </option>
                            ))}
                        </select>
                        <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            Active: {activeParties.size > 0 ? Array.from(activeParties).join(', ') : 'none'}
                        </div>
                        {activeParties.size > 0 && (
                            <button className="btn" type="button" style={{ marginTop: 8 }} onClick={() => setActiveParties(new Set())}>
                                Clear filter
                            </button>
                        )}
                    </div>
                </div>

                {useLiveData && isLoading && (
                    <div className="loading">
                        <div className="spinner"></div>
                        <div className="loading-text">Loading members…</div>
                    </div>
                )}

                {useLiveData && error && (
                    <div className="warning-box">
                        <div className="warning-box-title">Live data unavailable</div>
                        <div>Using dummy data. Error: {String(error)}</div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
                    {partyCounts.map(([party, count]) => (
                        <div key={party} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span
                                aria-hidden="true"
                                style={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: 999,
                                    backgroundColor: getPartyColor(party, partyOpts),
                                    display: 'inline-block',
                                }}
                            />
                            <span style={{ fontSize: '0.95rem' }}>
                                {party}: {count}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="parliament-grid" style={{ marginTop: 16 }}>
                    <div>
                        <div style={{ marginBottom: 10, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            Hemicycle — {seats.length} seats
                        </div>

                        <Hemicycle
                            seats={seats}
                            combineCduCsu={true}
                            partyFilter={effectiveFilter}
                            selectedSeatId={selectedSeatId}
                            onSelectSeatId={setSelectedSeatId}
                        />

                        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                                {partyCounts.map(([party, count]) => (
                                    <div key={party} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
                                        <span
                                            aria-hidden="true"
                                            style={{
                                                width: 12,
                                                height: 12,
                                                borderRadius: 999,
                                                backgroundColor: getPartyColor(party, partyOpts),
                                                display: 'inline-block',
                                            }}
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                            <span style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>{party}</span>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{count}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                © Die Bundeswahlleiterin, Wiesbaden 2025
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
                                        votes: selectedSeat.votes,
                                        percentage: selectedSeat.percentage,
                                        profession: selectedSeat.profession,
                                        age: selectedSeat.age,
                                        firstElected: selectedSeat.firstElected,
                                        yearsInParliament: selectedSeat.yearsInParliament,
                                        isNewMember: selectedSeat.isNewMember,
                                        committees: selectedSeat.committees,
                                        previousPosition: selectedSeat.previousPosition,
                                    }
                                    : null
                            }
                            partyColor={selectedPartyColor}
                            onClose={() => setSelectedSeatId(null)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
