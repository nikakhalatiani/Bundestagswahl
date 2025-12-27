import type { CSSProperties } from 'react';

export type SidePanelSeat = {
    id: string;
    memberName: string;
    party: string;
    seatType: 'direct' | 'list';
    region: string;
    constituency?: string;
    votes?: number;
    percentage?: number;
    profession?: string;
    age?: number;
    firstElected?: number;
    yearsInParliament?: number;
    isNewMember?: boolean;
    committees?: string[];
    previousPosition?: string;
};

type Props = {
    open: boolean;
    seat: SidePanelSeat | null;
    partyColor: string;
    onClose: () => void;
};

/**
 * Slide-in side panel that shows details for the selected seat.
 * Uses only existing theme primitives via CSS variables.
 */
export function SidePanel({ open, seat, partyColor, onClose }: Props) {
    const panelStyle: CSSProperties = {
        position: 'sticky',
        top: 16,
        background: open ? 'var(--bg-primary)' : 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 10,
        boxShadow: 'var(--shadow-md)',
        minHeight: 420,
        overflow: 'hidden',
        transform: open ? 'translateX(0)' : 'translateX(12px)',
        opacity: open ? 1 : 0.95,
        transition: 'transform 180ms ease, opacity 180ms ease, background-color 180ms ease',
    };

    return (
        <div style={panelStyle} role="region" aria-label="Seat details">
            <div style={{ padding: '1rem' }}>
                {seat ? (
                    <>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                            <div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                    {seat.memberName}
                                </div>
                                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                    <span
                                        className="party-badge"
                                        style={{ backgroundColor: partyColor, color: '#fff' }}
                                    >
                                        {seat.party}
                                    </span>
                                    {seat.isNewMember && (
                                        <span className="seat-badge seat-list">New</span>
                                    )}
                                </div>
                                <div style={{ marginTop: 6, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    {seat.seatType === 'direct' ? 'Direct mandate' : 'List mandate'}
                                </div>
                            </div>

                            <button className="btn" onClick={onClose} type="button">
                                ✕
                            </button>
                        </div>

                        <div className="info-box" style={{ marginTop: '1rem' }}>
                            <div className="info-box-title">Region / Constituency</div>
                            <div className="info-box-text">{seat.constituency || seat.region}</div>
                        </div>

                        {(seat.profession || seat.age !== undefined) && (
                            <div className="info-box" style={{ marginTop: '0.75rem' }}>
                                <div className="info-box-title">Personal info</div>
                                <div className="info-box-text">
                                    {seat.profession ? `Profession: ${seat.profession}` : ''}
                                    {seat.profession && seat.age !== undefined ? ' · ' : ''}
                                    {seat.age !== undefined ? `Age: ${seat.age}` : ''}
                                </div>
                            </div>
                        )}

                        {(seat.firstElected || seat.yearsInParliament !== undefined) && (
                            <div className="info-box" style={{ marginTop: '0.75rem' }}>
                                <div className="info-box-title">Experience</div>
                                <div className="info-box-text">
                                    {seat.firstElected ? `First elected: ${seat.firstElected}` : ''}
                                    {seat.firstElected && seat.yearsInParliament !== undefined ? ' · ' : ''}
                                    {seat.yearsInParliament !== undefined
                                        ? seat.yearsInParliament === 0
                                            ? 'Newly elected'
                                            : `Years in parliament: ${seat.yearsInParliament}`
                                        : ''}
                                </div>
                            </div>
                        )}

                        {seat.previousPosition && (
                            <div className="info-box" style={{ marginTop: '0.75rem' }}>
                                <div className="info-box-title">Previous position</div>
                                <div className="info-box-text">{seat.previousPosition}</div>
                            </div>
                        )}

                        {seat.seatType === 'direct' && seat.votes !== undefined && seat.percentage !== undefined && (
                            <div className="info-box" style={{ marginTop: '0.75rem' }}>
                                <div className="info-box-title">Constituency result</div>
                                <div className="info-box-text">
                                    {seat.votes.toLocaleString('de-DE')} votes · {seat.percentage.toFixed(1)}%
                                </div>
                            </div>
                        )}

                        {seat.committees && seat.committees.length > 0 && (
                            <div className="info-box" style={{ marginTop: '0.75rem' }}>
                                <div className="info-box-title">Committees</div>
                                <div className="info-box-text">
                                    {seat.committees.join(', ')}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div style={{
                        height: 380,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-secondary)',
                        textAlign: 'center',
                        padding: '1rem',
                    }}>
                        Select a seat to view details
                    </div>
                )}
            </div>
        </div>
    );
}
