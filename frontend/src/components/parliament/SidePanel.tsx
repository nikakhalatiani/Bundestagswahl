import { cn } from '../../utils/cn';
import { PartyBadge } from '../ui/PartyBadge';

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
    onClose: () => void;
};

/**
 * Slide-in side panel that shows details for the selected seat.
 * Uses only existing theme primitives via CSS variables.
 */
export function SidePanel({ open, seat, onClose }: Props) {
    return (
        <div
            className={cn(
                'sticky top-4 min-h-[420px] overflow-hidden rounded-[10px] border border-line shadow-md transition-[transform,opacity,background-color] duration-200 ease-out',
                open ? 'translate-x-0 bg-surface' : 'translate-x-3 bg-surface-muted opacity-95'
            )}
            role="region"
            aria-label="Seat details"
        >
            <div className="p-4">
                {seat ? (
                    <>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[1.1rem] font-extrabold text-ink">
                                    {seat.memberName}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <PartyBadge party={seat.party} combineCduCsu>
                                        {seat.party}
                                    </PartyBadge>
                                    {seat.isNewMember && (
                                        <span className="inline-block rounded px-2 py-1 text-[0.75rem] font-semibold uppercase tracking-[0.5px] text-white bg-[#2196f3]">New</span>
                                    )}
                                </div>
                                <div className="mt-2 text-[0.9rem] text-ink-muted">
                                    {seat.seatType === 'direct' ? 'Direct mandate' : 'List mandate'}
                                </div>
                            </div>

                            <button className="rounded-md px-2 py-1 text-ink-muted transition hover:text-ink" onClick={onClose} type="button">
                                ✕
                            </button>
                        </div>

                        <div className="mt-4 rounded border-l-4 border-[#2196f3] bg-[#e3f2fd] p-4">
                            <div className="mb-2 font-semibold text-[#1976d2]">Region / Constituency</div>
                            <div className="text-sm text-[#555]">{seat.constituency || seat.region}</div>
                        </div>

                        {(seat.profession || seat.age !== undefined) && (
                            <div className="mt-3 rounded border-l-4 border-[#2196f3] bg-[#e3f2fd] p-4">
                                <div className="mb-2 font-semibold text-[#1976d2]">Personal info</div>
                                <div className="text-sm text-[#555]">
                                    {seat.profession ? `Profession: ${seat.profession}` : ''}
                                    {seat.profession && seat.age !== undefined ? ' · ' : ''}
                                    {seat.age !== undefined ? `Age: ${seat.age}` : ''}
                                </div>
                            </div>
                        )}

                        {(seat.firstElected || seat.yearsInParliament !== undefined) && (
                            <div className="mt-3 rounded border-l-4 border-[#2196f3] bg-[#e3f2fd] p-4">
                                <div className="mb-2 font-semibold text-[#1976d2]">Experience</div>
                                <div className="text-sm text-[#555]">
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
                            <div className="mt-3 rounded border-l-4 border-[#2196f3] bg-[#e3f2fd] p-4">
                                <div className="mb-2 font-semibold text-[#1976d2]">Previous position</div>
                                <div className="text-sm text-[#555]">{seat.previousPosition}</div>
                            </div>
                        )}

                        {seat.seatType === 'direct' && seat.votes !== undefined && seat.percentage !== undefined && (
                            <div className="mt-3 rounded border-l-4 border-[#2196f3] bg-[#e3f2fd] p-4">
                                <div className="mb-2 font-semibold text-[#1976d2]">Constituency result</div>
                                <div className="text-sm text-[#555]">
                                    {seat.votes.toLocaleString('de-DE')} votes · {seat.percentage.toFixed(1)}%
                                </div>
                            </div>
                        )}

                        {seat.committees && seat.committees.length > 0 && (
                            <div className="mt-3 rounded border-l-4 border-[#2196f3] bg-[#e3f2fd] p-4">
                                <div className="mb-2 font-semibold text-[#1976d2]">Committees</div>
                                <div className="text-sm text-[#555]">
                                    {seat.committees.join(', ')}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex h-[380px] items-center justify-center p-4 text-center text-ink-muted">
                        Select a seat to view details
                    </div>
                )}
            </div>
        </div>
    );
}
