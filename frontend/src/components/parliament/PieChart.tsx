import { useMemo, useState, useRef, useEffect } from 'react';
import { getPartyColor, getPartyDisplayName } from '../../utils/party';

interface PieChartProps {
    data: { party_name: string; seats: number }[];
    size?: number;
    combineCduCsu?: boolean;
    /** Key to retrigger entry animation when parent view toggles */
    animateKey?: string;
    /** Set of selected party names (display names). If non-empty, only these are emphasized. */
    selectedParties?: Set<string>;
    /** Callback when a slice is clicked. */
    onToggleParty?: (party: string) => void;
    /** Generic filter callback - if provided, slices not matching are dimmed. */
    partyFilter?: (partyName: string) => boolean;
}

interface AnimatedSlice {
    party: string;
    displayName: string;
    seats: number;
    percentage: number;
    startAngle: number;
    endAngle: number;
    color: string;
    passesFilter: boolean;
}

export function PieChart({
    data,
    size = 400,
    combineCduCsu = true,
    animateKey,
    selectedParties,
    onToggleParty,
    partyFilter,
}: PieChartProps) {
    const partyOpts = useMemo(() => ({ combineCduCsu }), [combineCduCsu]);
    const [hoveredParty, setHoveredParty] = useState<string | null>(null);
    const [animatedSlices, setAnimatedSlices] = useState<AnimatedSlice[]>([]);
    const animationRef = useRef<number | null>(null);
    const prevSlicesRef = useRef<AnimatedSlice[]>([]);
    const [entering, setEntering] = useState(true);

    const total = useMemo(() => data.reduce((sum, d) => sum + d.seats, 0), [data]);

    // Determine if any filter is active
    const hasActiveFilter = (selectedParties && selectedParties.size > 0) || partyFilter !== undefined;

    // Calculate target slices
    const targetSlices = useMemo(() => {
        let currentAngle = -90; // Start at top
        return data.map((d) => {
            const displayName = getPartyDisplayName(d.party_name, partyOpts);
            const percentage = total > 0 ? (d.seats / total) * 100 : 0;
            const angle = total > 0 ? (d.seats / total) * 360 : 0;
            const startAngle = currentAngle;
            const endAngle = currentAngle + angle;
            currentAngle = endAngle;

            const passesFilter = partyFilter
                ? partyFilter(displayName)
                : selectedParties
                    ? selectedParties.has(displayName)
                    : true;

            return {
                party: d.party_name,
                displayName,
                seats: d.seats,
                percentage,
                startAngle,
                endAngle,
                color: getPartyColor(d.party_name, partyOpts),
                passesFilter,
            };
        });
    }, [data, total, partyOpts, partyFilter, selectedParties]);

    // Animate between previous and target slices
    useEffect(() => {
        const prevSlices = prevSlicesRef.current;
        const duration = 400; // ms
        const startTime = performance.now();

        // Build a map of previous slices by displayName
        const prevMap = new Map<string, AnimatedSlice>();
        prevSlices.forEach(s => prevMap.set(s.displayName, s));

        // Build a map of target slices by displayName
        const targetMap = new Map<string, AnimatedSlice>();
        targetSlices.forEach(s => targetMap.set(s.displayName, s));

        // Get all unique party names
        const allParties = new Set([...prevMap.keys(), ...targetMap.keys()]);

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);

            // Interpolate each slice
            const interpolated: AnimatedSlice[] = [];
            let currentAngle = -90;

            targetSlices.forEach(target => {
                const prev = prevMap.get(target.displayName);

                if (prev) {
                    // Interpolate from prev to target
                    const startAngle = currentAngle;
                    const angle = prev.endAngle - prev.startAngle + (target.endAngle - target.startAngle - (prev.endAngle - prev.startAngle)) * eased;
                    const endAngle = startAngle + angle;

                    interpolated.push({
                        ...target,
                        startAngle,
                        endAngle,
                        percentage: prev.percentage + (target.percentage - prev.percentage) * eased,
                    });
                    currentAngle = endAngle;
                } else {
                    // New slice - animate from 0
                    const startAngle = currentAngle;
                    const targetAngle = target.endAngle - target.startAngle;
                    const angle = targetAngle * eased;
                    const endAngle = startAngle + angle;

                    interpolated.push({
                        ...target,
                        startAngle,
                        endAngle,
                        percentage: target.percentage * eased,
                    });
                    currentAngle = endAngle;
                }
            });

            setAnimatedSlices(interpolated);

            if (progress < 1) {
                animationRef.current = requestAnimationFrame(animate);
            } else {
                prevSlicesRef.current = targetSlices;
            }
        };

        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }
        animationRef.current = requestAnimationFrame(animate);

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [targetSlices]);

    // Trigger a quick appear animation on filter/view changes
    useEffect(() => {
        setEntering(true);
        const id = requestAnimationFrame(() => setEntering(false));
        return () => cancelAnimationFrame(id);
    }, [targetSlices, animateKey]);

    // Initialize on first render
    useEffect(() => {
        if (prevSlicesRef.current.length === 0 && targetSlices.length > 0) {
            prevSlicesRef.current = targetSlices;
            setAnimatedSlices(targetSlices);
        }
    }, [targetSlices]);

    const slicesToRender = animatedSlices.length > 0 ? animatedSlices : targetSlices;

    const handleSliceClick = (displayName: string) => {
        if (onToggleParty) {
            onToggleParty(displayName);
        }
    };

    // Calculate arc path
    const getArcPath = (startAngle: number, endAngle: number) => {
        const radius = size / 2 - 10;
        const cx = size / 2;
        const cy = size / 2;

        // Handle full circle case
        if (endAngle - startAngle >= 359.99) {
            return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius} Z`;
        }

        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = cx + radius * Math.cos(startRad);
        const y1 = cy + radius * Math.sin(startRad);
        const x2 = cx + radius * Math.cos(endRad);
        const y2 = cy + radius * Math.sin(endRad);

        const largeArc = endAngle - startAngle > 180 ? 1 : 0;

        return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    };

    return (
        <div className="flex flex-col items-center gap-6 p-4">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {slicesToRender.map((slice) => {
                    const isDimmed = hasActiveFilter && !slice.passesFilter;
                    const isHovered = hoveredParty === slice.displayName;
                    const sliceAngle = slice.endAngle - slice.startAngle;
                    const isFullCircle = slicesToRender.length === 1 && sliceAngle >= 359.99;

                    // Don't render slices with no angle
                    if (sliceAngle < 0.1) return null;

                    return (
                        <g
                            key={slice.displayName}
                            style={{
                                opacity: entering ? 0 : isDimmed ? 0.25 : isHovered ? 0.85 : 1,
                                transform: (() => {
                                    let scale = entering ? 0.9 : 1;
                                    if (isHovered && !isDimmed) scale *= 1.03;
                                    return `scale(${scale})`;
                                })(),
                                transformOrigin: `${size / 2}px ${size / 2}px`,
                                transition: 'opacity 0.45s ease, transform 0.45s ease',
                            }}
                        >
                            {isFullCircle ? (
                                <circle
                                    cx={size / 2}
                                    cy={size / 2}
                                    r={size / 2 - 10}
                                    fill={slice.color}
                                    stroke="#fff"
                                    strokeWidth={2}
                                    style={{ cursor: onToggleParty ? 'pointer' : 'default' }}
                                    onClick={() => handleSliceClick(slice.displayName)}
                                    onMouseEnter={() => setHoveredParty(slice.displayName)}
                                    onMouseLeave={() => setHoveredParty(null)}
                                >
                                    <title>{slice.displayName}: {slice.seats} seats ({slice.percentage.toFixed(1)}%)</title>
                                </circle>
                            ) : (
                                <path
                                    d={getArcPath(slice.startAngle, slice.endAngle)}
                                    fill={slice.color}
                                    stroke="#fff"
                                    strokeWidth={2}
                                    style={{
                                        cursor: onToggleParty ? 'pointer' : 'default',
                                    }}
                                    onClick={() => handleSliceClick(slice.displayName)}
                                    onMouseEnter={() => setHoveredParty(slice.displayName)}
                                    onMouseLeave={() => setHoveredParty(null)}
                                >
                                    <title>{slice.displayName}: {slice.seats} seats ({slice.percentage.toFixed(1)}%)</title>
                                </path>
                            )}
                        </g>
                    );
                })}
                {/* Center circle for donut effect */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={size / 4}
                    fill="#fff"
                />
                <g>
                    <text
                        x={size / 2}
                        y={size / 2 - 10}
                        textAnchor="middle"
                        className="fill-ink"
                        fontSize={32}
                        fontWeight={700}
                    >
                        {total}
                    </text>
                    <text
                        x={size / 2}
                        y={size / 2 + 20}
                        textAnchor="middle"
                        className="fill-ink-muted"
                        fontSize={14}
                    >
                        Total Seats
                    </text>
                </g>
            </svg>
        </div>
    );
}
