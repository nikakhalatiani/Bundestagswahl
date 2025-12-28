import { useMemo, useState } from 'react';
import { getPartyColor, getPartyDisplayName } from '../../utils/party';
import { computeHemicycleLayoutWithRadius } from './SeatLayout';
import { Tooltip } from './Tooltip';

export type Seat = {
    id: string;
    party: string;
    seatType: 'direct' | 'list';
    memberName: string;
    region: string;
    constituency?: string;
    votes?: number;
    percentage?: number;
    listPosition?: number;
    profession?: string;
    birthYear?: number;
    gender?: string;
    previouslyElected?: boolean;
    age?: number;
    firstElected?: number;
    yearsInParliament?: number;
    isNewMember?: boolean;
    committees?: string[];
    previousPosition?: string;
};

type Props = {
    seats: Seat[];
    /** SVG height in CSS pixels. */
    height?: number;
    /** When true, CDU and CSU are grouped as CDU/CSU for display and coloring (results-only behavior). */
    combineCduCsu?: boolean;
    /** Optional party filter: if provided, only seats whose (display) party is included will be emphasized. */
    partyFilter?: Set<string>;
    /** Generic seat filter callback. Return true to emphasize the seat, false to dim it. Takes precedence over partyFilter. */
    seatFilter?: (seat: Seat) => boolean;
    /** Controlled selection. */
    selectedSeatId?: string | null;
    onSelectSeatId?: (id: string | null) => void;
};

/**
 * Interactive hemicycle (half-circle) parliament visualization.
 *
 * - Hover: tooltip near cursor.
 * - Click: select a seat and open a right-side panel.
 */
export function Hemicycle({
    seats,
    height = 520,
    combineCduCsu = true,
    partyFilter,
    seatFilter,
    selectedSeatId,
    onSelectSeatId,
}: Props) {
    const partyOpts = useMemo(() => ({ combineCduCsu }), [combineCduCsu]);

    // Demo-style fixed viewBox that scales responsively with width.
    const viewBoxWidth = 800;
    const viewBoxHeight = 450;
    const centerX = 400;
    const centerY = 420;

    const { points, dotRadius } = useMemo(() => {
        return computeHemicycleLayoutWithRadius(seats.length, viewBoxWidth, viewBoxHeight, {
            centerX,
            centerY,
            minRadius: 90,
            maxRadius: 370,
            angleSpan: Math.PI,
            spacingMin: 8,
            spacingMax: 19,
        });
    }, [seats.length]);

    const setRadius = dotRadius * 1.15;

    // Pair the computed points with the seat data.
    const seatPoints = useMemo(() => {
        return points.map((p, idx) => ({ p, seat: seats[idx] }));
    }, [points, seats]);

    const [hoveredSeatId, setHoveredSeatId] = useState<string | null>(null);
    const [internalSelectedSeatId, setInternalSelectedSeatId] = useState<string | null>(null);
    const effectiveSelectedSeatId = selectedSeatId ?? internalSelectedSeatId;

    const selectSeatId = (id: string | null) => {
        if (onSelectSeatId) onSelectSeatId(id);
        else setInternalSelectedSeatId(id);
    };

    const [mouse, setMouse] = useState({ x: 0, y: 0 });

    const hovered = useMemo(() => {
        return seats.find((s) => s.id === hoveredSeatId) ?? null;
    }, [seats, hoveredSeatId]);

    const tooltipContent = useMemo(() => {
        if (!hovered) return null;
        const partyLabel = getPartyDisplayName(hovered.party, partyOpts);
        const seatTypeLabel = hovered.seatType === 'direct' ? 'Direct mandate' : 'List mandate';
        return {
            title: hovered.memberName,
            lines: [partyLabel, `${seatTypeLabel} — ${hovered.region}`],
        };
    }, [hovered, partyOpts]);

    return (
        <div style={{ width: '100%' }}>
            <svg
                width="100%"
                height={height}
                viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="Parliament hemicycle"
                style={{ display: 'block' }}
                onMouseMove={(e) => {
                    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                    const x = ((e.clientX - rect.left) / rect.width) * viewBoxWidth;
                    const y = ((e.clientY - rect.top) / rect.height) * viewBoxHeight;
                    setMouse({ x, y });
                }}
                onMouseLeave={() => setHoveredSeatId(null)}
            >

                {/* Seat dots */}
                {seatPoints.map(({ p, seat }, index) => {
                    const partyLabel = getPartyDisplayName(seat.party, partyOpts);
                    const color = getPartyColor(seat.party, partyOpts);

                    const isSelected = seat.id === effectiveSelectedSeatId;
                    const isHovered = seat.id === hoveredSeatId;

                    // Use seatFilter if provided, otherwise fall back to partyFilter
                    const passesFilter = seatFilter
                        ? seatFilter(seat)
                        : partyFilter
                            ? partyFilter.has(partyLabel)
                            : true;

                    const opacity = passesFilter ? 1 : 0.12;
                    const stroke = isSelected ? 'var(--text-primary)' : 'transparent';
                    const strokeWidth = isSelected ? 2 : 0;
                    const r = isHovered ? setRadius + 0.8 : setRadius;

                    // Animation: wipe from left to right (index 0 is left-most)
                    const animationDelay = `${(index / seatPoints.length) * 800}ms`;

                    return (
                        <circle
                            key={seat.id}
                            cx={p.x}
                            cy={p.y}
                            r={r}
                            fill={color}
                            stroke={stroke}
                            strokeWidth={strokeWidth}
                            style={{
                                cursor: 'pointer',
                                opacity,
                                transition: 'opacity 160ms ease, r 120ms ease, stroke-width 120ms ease',
                                animation: 'seat-appear 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
                                animationDelay,
                                transformBox: 'fill-box',
                                transformOrigin: 'center',
                            }}
                            onMouseEnter={() => setHoveredSeatId(seat.id)}
                            onFocus={() => setHoveredSeatId(seat.id)}
                            onClick={() => {
                                selectSeatId(seat.id === effectiveSelectedSeatId ? null : seat.id);
                            }}
                        />
                    );
                })}

                {/* Center label */}
                <text
                    x={centerX}
                    y={centerY - 14}
                    textAnchor="middle"
                    style={{ fontSize: 18, fill: 'var(--text-secondary)', fontWeight: 700 }}
                >
                    {seats.length}
                </text>

                <Tooltip open={Boolean(hovered) && !effectiveSelectedSeatId} x={mouse.x} y={mouse.y} content={tooltipContent} />
            </svg>
        </div>
    );
}
