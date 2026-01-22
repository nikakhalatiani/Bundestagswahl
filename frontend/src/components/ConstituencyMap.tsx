import { useEffect, useMemo, useState } from 'react';
import type {
    ConstituencyWinnerItem,
    ConstituencyVotesBulkItem,
    PartyStrengthItem,
    StructuralMetricDefinition,
    StructuralMetricValue,
} from '../types/api';
import { getPartyColor, getPartyDisplayName } from '../utils/party';
import { cn } from '../utils/cn';

// GeoJSON types for constituencies
interface GeoFeature {
    type: 'Feature';
    geometry: {
        type: 'Polygon' | 'MultiPolygon';
        coordinates: number[][][] | number[][][][];
    };
    properties: {
        WKR_NR: number;
        WKR_NAME: string;
        LAND_NR: string;
        LAND_NAME: string;
    };
}

interface GeoFeatureCollection {
    type: 'FeatureCollection';
    features: GeoFeature[];
}

// GeoJSON types for state borders (bundeslaender.json)
interface StateGeoFeature {
    type: 'Feature';
    geometry: {
        type: 'Polygon' | 'MultiPolygon';
        coordinates: number[][][] | number[][][][];
    };
    properties: {
        LAND_NAME: string;
    };
}

interface StateGeoFeatureCollection {
    type: 'FeatureCollection';
    features: StateGeoFeature[];
}

interface ConstituencyMapProps {
    year: number;
    winners: ConstituencyWinnerItem[];
    votesBulk: ConstituencyVotesBulkItem[];
    selectedConstituencyNumber: number | null;
    onSelectConstituency: (number: number) => void;
    voteType: 'first' | 'second';
    filteredStates?: Set<string>;
    mode?: 'constituency' | 'strongholds';
    strongholdParty?: string | null;
    strongholdData?: PartyStrengthItem[];
    strongholdView?: 'strength' | 'change';
    opacityMetricKey?: string;
    structuralData?: StructuralMetricValue[];
    structuralMetrics?: StructuralMetricDefinition[];
}

// Create a lookup map from constituency_number to winner
function createWinnerMap(winners: ConstituencyWinnerItem[]): Map<number, ConstituencyWinnerItem> {
    const map = new Map<number, ConstituencyWinnerItem>();
    winners.forEach(w => map.set(w.constituency_number, w));
    return map;
}

// Compute bounds from all features
function computeBounds(features: GeoFeature[]): { minLon: number; maxLon: number; minLat: number; maxLat: number } {
    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    function processCoords(coords: number[]) {
        const [lon, lat] = coords;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }

    function traverseCoords(arr: unknown): void {
        if (!Array.isArray(arr)) return;
        if (typeof arr[0] === 'number' && typeof arr[1] === 'number' && arr.length >= 2) {
            processCoords(arr as number[]);
        } else {
            for (const item of arr) {
                traverseCoords(item);
            }
        }
    }

    for (const feature of features) {
        traverseCoords(feature.geometry.coordinates);
    }

    return { minLon, maxLon, minLat, maxLat };
}

// Project lon/lat to SVG coordinates (equirectangular with latitude correction)
function projectPoint(
    lon: number,
    lat: number,
    bounds: BoundsWithSize
): [number, number] {
    const { minLon, maxLon, minLat, maxLat, width, height } = bounds;

    // Simple linear projection
    const x = ((lon - minLon) / (maxLon - minLon)) * width;
    const y = ((maxLat - lat) / (maxLat - minLat)) * height;

    return [x, y];
}

type BoundsWithSize = { minLon: number; maxLon: number; minLat: number; maxLat: number; width: number; height: number; cosLat: number };

// Convert coordinates to SVG path
function coordsToPath(coords: number[][], bounds: BoundsWithSize): string {
    if (coords.length === 0) return '';
    const points = coords.map(([lon, lat]) => projectPoint(lon, lat, bounds));
    return 'M' + points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z';
}

// Build full SVG path for a feature
function featureToPath(feature: GeoFeature, bounds: BoundsWithSize): string {
    const { geometry } = feature;
    let pathData = '';

    if (geometry.type === 'Polygon') {
        const rings = geometry.coordinates as number[][][];
        for (const ring of rings) {
            pathData += coordsToPath(ring, bounds);
        }
    } else if (geometry.type === 'MultiPolygon') {
        const polygons = geometry.coordinates as number[][][][];
        for (const polygon of polygons) {
            for (const ring of polygon) {
                pathData += coordsToPath(ring, bounds);
            }
        }
    }

    return pathData;
}

function collectPoints(coords: unknown, points: number[][]): void {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number' && coords.length >= 2) {
        points.push(coords as number[]);
    } else {
        for (const item of coords) {
            collectPoints(item, points);
        }
    }
}

function computeCentroid(feature: GeoFeature): [number, number] {
    const points: number[][] = [];
    collectPoints(feature.geometry.coordinates, points);
    if (points.length === 0) return [0, 0];
    const sum = points.reduce((acc, [lon, lat]) => {
        acc[0] += lon;
        acc[1] += lat;
        return acc;
    }, [0, 0]);
    return [sum[0] / points.length, sum[1] / points.length];
}

// Major parties for legend
const LEGEND_PARTIES = [
    { key: 'CDU/CSU', label: 'CDU/CSU' },
    { key: 'SPD', label: 'SPD' },
    { key: 'AfD', label: 'AfD' },
    { key: 'GRÜNE', label: 'Grüne' },
    { key: 'FDP', label: 'FDP' },
    { key: 'DIE LINKE', label: 'Linke' },
    { key: 'BSW', label: 'BSW' },
];

export function ConstituencyMap({
    year,
    winners,
    votesBulk,
    selectedConstituencyNumber,
    onSelectConstituency,
    voteType,
    filteredStates,
    mode = 'constituency',
    strongholdParty,
    strongholdData = [],
    strongholdView = 'strength',
    opacityMetricKey = 'vote_share',
    structuralData = [],
    structuralMetrics = [],
}: ConstituencyMapProps) {
    const [geoData, setGeoData] = useState<GeoFeatureCollection | null>(null);
    const [stateGeoData, setStateGeoData] = useState<StateGeoFeatureCollection | null>(null);
    const [hoveredNumber, setHoveredNumber] = useState<number | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

    const partyOpts = { combineCduCsu: true };
    const winnerMap = useMemo(() => createWinnerMap(winners), [winners]);
    const isStrongholds = mode === 'strongholds';
    const strongholdPartyLabel = strongholdParty ? getPartyDisplayName(strongholdParty, partyOpts) : null;
    const strongholdPartyColor = strongholdParty ? getPartyColor(strongholdParty, partyOpts) : '#9e9e9e';
    const strongholdLossColor = '#b7410e';
    const strongholdGainColor = 'teal';
    const structuralMetricMap = useMemo(() => {
        const map = new Map<string, StructuralMetricDefinition>();
        structuralMetrics.forEach(metric => map.set(metric.key, metric));
        return map;
    }, [structuralMetrics]);
    const structuralValueMap = useMemo(() => {
        const map = new Map<number, Record<string, number | null>>();
        structuralData.forEach(item => {
            map.set(item.constituency_number, item.metrics);
        });
        return map;
    }, [structuralData]);
    const selectedMetric = structuralMetricMap.get(opacityMetricKey) || null;
    const isOpacityMetric = !isStrongholds && opacityMetricKey !== 'vote_share' && Boolean(selectedMetric);
    const metricRange = useMemo(() => {
        if (!isOpacityMetric) return null;
        let min = Infinity;
        let max = -Infinity;
        for (const item of structuralData) {
            const value = item.metrics[opacityMetricKey];
            if (value === null || value === undefined) continue;
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
        if (min === Infinity || max === -Infinity) {
            return null;
        }
        return { min, max };
    }, [isOpacityMetric, structuralData, opacityMetricKey]);
    const strongholdDataMap = useMemo(() => {
        const map = new Map<number, PartyStrengthItem>();
        strongholdData.forEach(item => map.set(item.constituency_number, item));
        return map;
    }, [strongholdData]);
    const maxStrongholdPercent = useMemo(() => {
        return strongholdData.reduce((max, item) => Math.max(max, item.percent ?? 0), 0);
    }, [strongholdData]);
    const maxStrongholdAbsDiff = useMemo(() => {
        return strongholdData.reduce((max, item) => Math.max(max, Math.abs(item.diff_percent_pts ?? 0)), 0);
    }, [strongholdData]);

    // Load constituency GeoJSON
    useEffect(() => {
        let cancelled = false;
        async function loadGeoData() {
            try {
                const url = year === 2021
                    ? '/wahlkreise2021.json'
                    : '/wahlkreise2025.json';
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to fetch ${url}`);
                const data: GeoFeatureCollection = await response.json();
                if (!cancelled) setGeoData(data);
            } catch (err) {
                console.error('Failed to load GeoJSON:', err);
            }
        }
        loadGeoData();
        return () => { cancelled = true; };
    }, [year]);

    // Load state borders GeoJSON
    useEffect(() => {
        let cancelled = false;
        async function loadStateData() {
            try {
                const response = await fetch('/bundeslaender.json');
                if (!response.ok) throw new Error('Failed to fetch bundeslaender.json');
                const data: StateGeoFeatureCollection = await response.json();
                if (!cancelled) setStateGeoData(data);
            } catch (err) {
                console.error('Failed to load state borders:', err);
            }
        }
        loadStateData();
        return () => { cancelled = true; };
    }, []);

    // Compute bounds and paths
    const { bounds, paths } = useMemo(() => {
        if (!geoData) return { bounds: null, paths: [] };
        const b = computeBounds(geoData.features);
        // Add small padding
        const padLon = (b.maxLon - b.minLon) * 0.02;
        const padLat = (b.maxLat - b.minLat) * 0.02;
        const paddedBounds = {
            minLon: b.minLon - padLon,
            maxLon: b.maxLon + padLon,
            minLat: b.minLat - padLat,
            maxLat: b.maxLat + padLat,
        };

        // Calculate aspect ratio with latitude correction
        // Germany is roughly 47-55°N latitude
        const latRange = paddedBounds.maxLat - paddedBounds.minLat;
        const lonRange = paddedBounds.maxLon - paddedBounds.minLon;
        const avgLat = (paddedBounds.minLat + paddedBounds.maxLat) / 2;
        const cosLat = Math.cos((avgLat * Math.PI) / 180);

        // Corrected aspect ratio: width / height in real-world proportions
        // At 51° latitude, 1° longitude ≈ 0.63 × 1° latitude in distance
        const aspectRatio = (lonRange * cosLat) / latRange;

        // Use fixed height for taller map, compute width
        const height = 600;
        const width = height * aspectRatio;

        const boundsWithSize: BoundsWithSize = { ...paddedBounds, width, height, cosLat };
        const pathsData = geoData.features.map(feature => {
            const [lon, lat] = computeCentroid(feature);
            const [cx, cy] = projectPoint(lon, lat, boundsWithSize);
            return {
                number: feature.properties.WKR_NR,
                name: feature.properties.WKR_NAME,
                stateName: feature.properties.LAND_NAME,
                stateId: feature.properties.LAND_NR,
                path: featureToPath(feature, boundsWithSize),
                cx,
                cy,
            };
        });

        return { bounds: boundsWithSize, paths: pathsData };
    }, [geoData]);

    // Create lookup from constituency number to state name
    const constituencyToState = useMemo(() => {
        const map = new Map<number, string>();
        paths.forEach(p => map.set(p.number, p.stateName));
        return map;
    }, [paths]);

    // Create a lookup map from constituency_number to vote distribution
    const votesBulkMap = useMemo(() => {
        const map = new Map<number, ConstituencyVotesBulkItem>();
        votesBulk.forEach(v => map.set(v.constituency_number, v));
        return map;
    }, [votesBulk]);

    // Compute aggregated party percentages (filtered by selected states)
    const partyPercentages = useMemo(() => {
        if (isStrongholds) return [];
        const partyTotals = new Map<string, { votes: number; count: number }>();
        let totalVotes = 0;

        votesBulk.forEach(constituency => {
            const stateName = constituencyToState.get(constituency.constituency_number);
            // If states are filtered, skip constituencies not in filtered states
            if (filteredStates && filteredStates.size > 0 && stateName && !filteredStates.has(stateName)) {
                return;
            }

            constituency.parties.forEach(party => {
                const votes = voteType === 'first' ? party.first_votes : party.second_votes;
                const displayName = getPartyDisplayName(party.party_name, partyOpts);
                const existing = partyTotals.get(displayName) || { votes: 0, count: 0 };
                partyTotals.set(displayName, {
                    votes: existing.votes + votes,
                    count: existing.count + 1
                });
                totalVotes += votes;
            });
        });

        // Convert to percentages and sort
        const percentages: { party: string; percent: number; votes: number }[] = [];
        partyTotals.forEach((data, party) => {
            const percent = totalVotes > 0 ? (data.votes / totalVotes) * 100 : 0;
            percentages.push({ party, percent, votes: data.votes });
        });

        // Sort by percentage descending
        percentages.sort((a, b) => b.percent - a.percent);

        // Take top 7 parties and group rest as "Other"
        const top7 = percentages.slice(0, 7);
        const others = percentages.slice(7);
        const otherPercent = others.reduce((sum, p) => sum + p.percent, 0);
        const otherVotes = others.reduce((sum, p) => sum + p.votes, 0);

        if (otherPercent > 0) {
            top7.push({ party: 'Other', percent: otherPercent, votes: otherVotes });
        }

        return top7;
    }, [isStrongholds, votesBulk, voteType, filteredStates, constituencyToState]);

    // City coordinates (lon, lat) and projected positions
    const cities = useMemo(() => {
        if (!bounds) return [];
        const cityData = [
            { name: 'Berlin', lon: 13.405, lat: 52.52 },
            { name: 'Hamburg', lon: 9.993, lat: 53.551 },
            { name: 'Munich', lon: 11.582, lat: 48.135 },
            { name: 'Frankfurt', lon: 8.682, lat: 50.110 },
            { name: 'Düsseldorf', lon: 6.773, lat: 51.228 },
        ];
        return cityData.map(city => {
            const [x, y] = projectPoint(city.lon, city.lat, bounds);
            return { ...city, x, y };
        });
    }, [bounds]);

    // Compute state border paths from bundeslaender.json
    const stateBorderPaths = useMemo(() => {
        if (!bounds || !stateGeoData) return [];
        return stateGeoData.features.map(feature => {
            // Use the same featureToPath but cast the feature
            const geoFeature = feature as unknown as GeoFeature;
            return {
                name: feature.properties.LAND_NAME,
                path: featureToPath(geoFeature, bounds),
            };
        });
    }, [bounds, stateGeoData]);

    // Helper function to compute winner by vote type
    const getWinnerByVoteType = (constituencyNumber: number): { party: string; percent: number } | null => {
        if (voteType === 'first') {
            const winner = winnerMap.get(constituencyNumber);
            if (winner) {
                return { party: winner.party_name, percent: winner.percent_of_valid || 0 };
            }
        } else {
            // For second vote, find the party with highest second_votes from votesBulk
            const voteData = votesBulkMap.get(constituencyNumber);
            if (voteData && voteData.parties.length > 0) {
                // Sort by second votes and get top
                const sorted = [...voteData.parties].sort((a, b) => b.second_votes - a.second_votes);
                return { party: sorted[0].party_name, percent: sorted[0].second_percent };
            }
        }
        return null;
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        // Position tooltip, keeping it on screen
        const tooltipWidth = 260;
        const tooltipHeight = 120;
        let x = e.clientX + 15;
        let y = e.clientY + 15;

        // Prevent going off right edge
        if (x + tooltipWidth > window.innerWidth) {
            x = e.clientX - tooltipWidth - 15;
        }
        // Prevent going off bottom
        if (y + tooltipHeight > window.innerHeight) {
            y = e.clientY - tooltipHeight - 15;
        }

        setTooltipPos({ x, y });
    };

    const hoveredWinner = hoveredNumber ? winnerMap.get(hoveredNumber) : null;
    const formatMetricValue = (value: number | null | undefined, unit?: string | null) => {
        if (value === null || value === undefined) return '—';
        const isPercent = unit?.includes('%');
        const formatted = value.toLocaleString(undefined, { maximumFractionDigits: isPercent ? 1 : 2 });
        return unit ? `${formatted} ${unit}` : formatted;
    };

    if (!geoData || !bounds) {
        return (
            <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 px-8 py-8 text-ink-muted">
                <div className="h-[50px] w-[50px] animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-surface-accent border-t-brand-black"></div>
                <div>Loading map...</div>
            </div>
        );
    }

    return (
        <div className="relative min-h-[480px]">
            <div className="flex min-h-[480px] w-full justify-center py-1" onMouseMove={handleMouseMove}>
                <svg
                    viewBox={`0 0 ${bounds.width} ${bounds.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    className="h-auto w-full max-w-[415px]"
                >
                    {/* Layer 1: Constituency fills */}
                    {paths.map(({ number, path, stateName }) => {
                        const isSelected = selectedConstituencyNumber === number;
                        const isHovered = hoveredNumber === number;

                        if (isStrongholds) {
                            const item = strongholdDataMap.get(number);
                            const percent = item?.percent ?? 0;
                            const scale = maxStrongholdPercent > 0 ? percent / maxStrongholdPercent : 0;
                            const baseOpacity = strongholdView === 'strength' ? 0.2 + 0.75 * scale : 0.3;
                            const fillColor = item ? strongholdPartyColor : '#d0d0d0';
                            const fill = strongholdView === 'strength' ? fillColor : '#f1f1f1';
                            const fillOpacity = strongholdView === 'strength'
                                ? (isSelected ? Math.min(baseOpacity + 0.15, 1) : baseOpacity)
                                : 1;

                            return (
                                <path
                                    key={number}
                                    d={path}
                                    fill={fill}
                                    fillOpacity={fillOpacity}
                                    stroke="none"
                                    className={cn(
                                        'cursor-pointer transition-[filter] duration-150',
                                        isSelected && 'drop-shadow-[0_0_3px_rgba(0,0,0,0.4)]'
                                    )}
                                    onMouseEnter={() => setHoveredNumber(number)}
                                    onMouseLeave={() => setHoveredNumber(null)}
                                    onClick={() => onSelectConstituency(number)}
                                />
                            );
                        }

                        const winnerData = getWinnerByVoteType(number);
                        const fillColor = winnerData ? getPartyColor(winnerData.party, partyOpts) : '#ccc';
                        // Map percentage to discrete opacity segments (default)
                        const percent = winnerData?.percent || 0;
                        let baseOpacity = 0.6;
                        if (percent >= 40) baseOpacity = 0.8;
                        else if (percent >= 35) baseOpacity = 0.75;
                        else if (percent >= 30) baseOpacity = 0.7;
                        else if (percent >= 25) baseOpacity = 0.65;

                        if (isOpacityMetric) {
                            const metricValue = structuralValueMap.get(number)?.[opacityMetricKey];
                            if (metricRange && metricValue !== null && metricValue !== undefined) {
                                const range = metricRange.max - metricRange.min;
                                const scaled = range > 0 ? (metricValue - metricRange.min) / range : 0;
                                baseOpacity = 0.2 + 0.8 * scaled;
                            } else {
                                baseOpacity = 0.2;
                            }
                        }

                        // Check if constituency should be greyed out
                        const isFiltered = filteredStates && filteredStates.size > 0;
                        const isInFilteredState = isFiltered && filteredStates.has(stateName);
                        const isGreyedOut = isFiltered && !isInFilteredState;

                        return (
                            <path
                                key={number}
                                d={path}
                                fill={isGreyedOut ? '#d0d0d0' : fillColor}
                                fillOpacity={isGreyedOut ? 0.4 : (isSelected || isHovered ? 0.85 : baseOpacity)}
                                stroke="none"
                                className={cn(
                                    'cursor-pointer transition-[filter] duration-150',
                                    isSelected && 'drop-shadow-[0_0_3px_rgba(0,0,0,0.4)]'
                                )}
                                onMouseEnter={() => setHoveredNumber(number)}
                                onMouseLeave={() => setHoveredNumber(null)}
                                onClick={() => onSelectConstituency(number)}
                            />
                        );
                    })}

                    {/* Layer 2: Thin constituency borders */}
                    {isStrongholds ? (
                        <g pointerEvents="none">
                            {paths.map(({ number, path }) => (
                                <path
                                    key={`border-${number}`}
                                    d={path}
                                    fill="none"
                                    stroke="rgba(255,255,255,0.45)"
                                    strokeWidth={0.5}
                                    strokeLinejoin="round"
                                />
                            ))}
                        </g>
                    ) : (
                        <g pointerEvents="none">
                            {paths.map(({ number, path }) => {
                                const isSelected = selectedConstituencyNumber === number;
                                return (
                                    <path
                                        key={`border-${number}`}
                                        d={path}
                                        fill="none"
                                        stroke={isSelected ? "#fff" : "rgba(255,255,255,0.35)"}
                                        strokeWidth={isSelected ? 1 : 0.4}
                                        strokeLinejoin="round"
                                    />
                                );
                            })}
                        </g>
                    )}

                    {/* Layer 3: State borders (thick white lines) */}
                    <g pointerEvents="none">
                        {stateBorderPaths.map((state, idx) => (
                            <path
                                key={`state-${idx}`}
                                d={state.path}
                                fill="none"
                                stroke="#fff"
                                strokeWidth={0.7}
                                strokeLinejoin="round"
                            />
                        ))}
                    </g>

                    {isStrongholds && strongholdView === 'change' && (
                        <g pointerEvents="none">
                            {paths.map(({ number, cx, cy }) => {
                                const item = strongholdDataMap.get(number);
                                const diff = item?.diff_percent_pts;
                                if (diff === null || diff === undefined || diff === 0) return null;
                                const magnitude = Math.abs(diff);
                                const scale = maxStrongholdAbsDiff > 0 ? magnitude / maxStrongholdAbsDiff : 0;
                                const height = 9 + scale * 24;
                                const halfHeight = height / 2;
                                const halfWidth = Math.max(3, height * 0.2);
                                const opacity = 0.55 + 0.4 * scale;
                                const isGain = diff > 0;
                                const chevronPath = isGain
                                    ? `M ${-halfWidth},${halfHeight} L 0,${-halfHeight} L ${halfWidth},${halfHeight}`
                                    : `M ${-halfWidth},${-halfHeight} L 0,${halfHeight} L ${halfWidth},${-halfHeight}`;
                                return (
                                    <path
                                        key={`chg-${number}`}
                                        d={chevronPath}
                                        transform={`translate(${cx}, ${cy})`}
                                        fill="none"
                                        stroke={isGain ? strongholdGainColor : strongholdLossColor}
                                        strokeWidth={2}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        opacity={opacity}
                                    />
                                );
                            })}
                        </g>
                    )}

                    {/* Layer 4: City markers */}
                    <g pointerEvents="none">
                        {cities.map(city => (
                            <g key={city.name} transform={`translate(${city.x}, ${city.y})`}>
                                <circle
                                    r={3}
                                    fill="#333"
                                    stroke="#fff"
                                    strokeWidth={1.5}
                                />
                                <text
                                    x={8}
                                    y={4}
                                    fontSize={11}
                                    fontWeight={600}
                                    fill="#333"
                                    stroke="#fff"
                                    strokeWidth={2.5}
                                    paintOrder="stroke"
                                >
                                    {city.name}
                                </text>
                            </g>
                        ))}
                    </g>
                </svg>
            </div>

            {/* Tooltip with top 5 parties */}
            {hoveredNumber && tooltipPos && (
                <div
                    className="fixed z-[1000] min-w-[220px] max-w-[300px] rounded bg-white p-3 shadow-[0_4px_20px_rgba(0,0,0,0.25)] pointer-events-none"
                    style={{ left: tooltipPos.x, top: tooltipPos.y }}
                >
                    <div className="mb-3 border-b border-[#eee] pb-2 text-base font-bold text-ink">
                        {paths.find(p => p.number === hoveredNumber)?.name}
                        <span className="mt-1 block text-[0.75rem] font-normal text-ink-faint">
                            {paths.find(p => p.number === hoveredNumber)?.stateName}
                        </span>
                    </div>
                    <div className="mb-2 pb-1 text-[0.7rem] uppercase tracking-[0.05em] text-ink-faint">
                        {voteType === 'first' ? 'First Votes (Erststimmen)' : 'Second Votes (Zweitstimmen)'}
                    </div>
                    {isStrongholds ? (() => {
                        const item = strongholdDataMap.get(hoveredNumber);
                        if (!item) return <div className="text-[0.8rem] italic text-ink-faint">No data available</div>;
                        const percent = item.percent ?? 0;
                        const votes = item.votes ?? 0;
                        const barWidth = Math.min(percent, 100);

                        return (
                            <>
                                <div className="relative mb-1 grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-[0.85rem]">
                                    <div
                                        className="absolute inset-y-0 left-0 z-0 rounded opacity-25 transition-[width] duration-200 ease-out"
                                        style={{
                                            backgroundColor: strongholdPartyColor,
                                            width: `${barWidth}%`
                                        }}
                                    />
                                    <span className="z-10 rounded bg-white/85 px-1.5 py-0.5 font-semibold text-ink">
                                        {strongholdPartyLabel ?? 'Selected party'}
                                    </span>
                                    <span className="z-10 text-right font-semibold text-ink">
                                        {percent.toFixed(1)}%
                                    </span>
                                    <span className="z-10 min-w-[50px] text-right text-ink-faint">
                                        {votes.toLocaleString()}
                                    </span>
                                </div>
                                {strongholdView === 'change' && (
                                    <div className="mt-2 text-[0.85rem]">
                                        {item.diff_percent_pts === null ? (
                                            <div className="text-ink-faint">No change data</div>
                                        ) : (
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold text-ink">Change vs 2021</span>
                                                <span
                                                    className={cn(
                                                        'font-semibold',
                                                        item.diff_percent_pts > 0 && 'text-emerald-700',
                                                        item.diff_percent_pts < 0 && 'text-[#b7410e]',
                                                        item.diff_percent_pts === 0 && 'text-ink-faint'
                                                    )}
                                                >
                                                    {item.diff_percent_pts > 0 ? '+' : ''}{item.diff_percent_pts.toFixed(1)} pt.
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        );
                    })() : (() => {
                        const voteData = votesBulkMap.get(hoveredNumber);
                        if (!voteData || voteData.parties.length === 0) {
                            // Fallback to winner data
                            if (hoveredWinner) {
                                return (
                                    <div className="relative mb-1 grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-[0.85rem]">
                                        <div
                                            className="absolute inset-y-0 left-0 z-0 rounded opacity-25 transition-[width] duration-200 ease-out"
                                            style={{
                                                backgroundColor: getPartyColor(hoveredWinner.party_name, partyOpts),
                                                width: `${Math.min(hoveredWinner.percent_of_valid || 0, 100)}%`
                                            }}
                                        />
                                        <span className="z-10 rounded bg-white/85 px-1.5 py-0.5 font-semibold text-ink">
                                            {getPartyDisplayName(hoveredWinner.party_name, partyOpts)}
                                        </span>
                                        <span className="z-10 text-right font-semibold text-ink">
                                            {hoveredWinner.percent_of_valid?.toFixed(1)}%
                                        </span>
                                    </div>
                                );
                            }
                            return <div className="text-[0.8rem] italic text-ink-faint">No data available</div>;
                        }

                        // Sort by the current vote type and take top 5
                        const sorted = [...voteData.parties].sort((a, b) =>
                            voteType === 'first'
                                ? b.first_votes - a.first_votes
                                : b.second_votes - a.second_votes
                        );
                        const top5 = sorted.slice(0, 5);
                        const maxPercent = Math.max(
                            ...top5.map(p => voteType === 'first' ? p.first_percent : p.second_percent)
                        );

                        return (
                            <div className="flex flex-col gap-1">
                                {top5.map((party, idx) => {
                                    const percent = voteType === 'first' ? party.first_percent : party.second_percent;
                                    const votes = voteType === 'first' ? party.first_votes : party.second_votes;
                                    const barWidth = maxPercent > 0 ? (percent / maxPercent) * 100 : 0;

                                    return (
                                        <div key={idx} className="relative mb-1 grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-[0.85rem]">
                                            <div
                                                className="absolute inset-y-0 left-0 z-0 rounded opacity-25 transition-[width] duration-200 ease-out"
                                                style={{
                                                    backgroundColor: getPartyColor(party.party_name, partyOpts),
                                                    width: `${barWidth}%`
                                                }}
                                            />
                                            <span className="z-10 rounded bg-white/85 px-1.5 py-0.5 font-semibold text-ink">
                                                {getPartyDisplayName(party.party_name, partyOpts)}
                                            </span>
                                            <span className="z-10 text-right font-semibold text-ink">
                                                {percent.toFixed(1)}%
                                            </span>
                                            <span className="z-10 min-w-[50px] text-right text-ink-faint">
                                                {votes.toLocaleString()}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}
                    {!isStrongholds && isOpacityMetric && selectedMetric && (
                        <div className="mt-2 border-t border-[#eee] pt-2 text-[0.85rem] text-ink">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-ink">{selectedMetric.label}</span>
                                <span className="text-ink-muted">
                                    {formatMetricValue(structuralValueMap.get(hoveredNumber)?.[opacityMetricKey], selectedMetric.unit)}
                                </span>
                            </div>
                        </div>
                    )}
                    {!isStrongholds && hoveredWinner && voteType === 'first' && (
                        <div className="mt-2 border-t border-[#eee] pt-2 text-[0.8rem] text-ink-muted">
                            Winner: {hoveredWinner.winner_name}
                        </div>
                    )}
                </div>
            )}

            {isStrongholds ? (
                strongholdParty ? (
                    strongholdView === 'strength' ? (
                        <div className="border-t border-line px-3 py-2">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.03em] text-ink-muted">
                                <span>Stronghold strength</span>
                                <span className="flex items-center gap-2 text-[0.75rem] font-semibold normal-case text-ink">
                                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: strongholdPartyColor }} />
                                    {strongholdPartyLabel ?? 'Party'}
                                </span>
                            </div>
                            <div className="flex items-center gap-3 text-[0.8rem] text-ink-muted">
                                <span className="min-w-[32px] text-left">0%</span>
                                <div className="relative h-2 flex-1 rounded-full bg-surface-muted">
                                    <div
                                        className="absolute inset-0 rounded-full"
                                        style={{ background: `linear-gradient(to right, rgba(0,0,0,0.15), ${strongholdPartyColor})` }}
                                    />
                                    <span className="absolute left-1/2 top-1/2 h-3 w-[1px] -translate-y-1/2 bg-white/70" />
                                </div>
                                <span className="min-w-[46px] text-right">{maxStrongholdPercent.toFixed(1)}%</span>
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[0.7rem] text-ink-faint">
                                <span>Lower</span>
                                <span>Higher</span>
                            </div>
                        </div>
                    ) : (
                        <div className="border-t border-line px-3 py-2">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.03em] text-ink-muted">
                                <span>Change since 2021</span>
                                <span className="flex items-center gap-2 text-[0.75rem] font-semibold normal-case text-ink">
                                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: strongholdPartyColor }} />
                                    {strongholdPartyLabel ?? 'Party'}
                                </span>
                            </div>
                            <div className="flex flex-col items-center gap-2 text-[0.8rem] text-ink-muted">
                                <div className="grid w-full max-w-[320px] grid-cols-[56px_160px_56px] items-center gap-3">
                                    <span className="text-left">
                                    {maxStrongholdAbsDiff ? `-${maxStrongholdAbsDiff.toFixed(1)} pt.` : '-0.0 pt.'}
                                    </span>
                                    <div className="flex h-[42px] w-[160px] items-center justify-center">
                                        <svg className="h-[75px] w-[160px]" viewBox="0 0 170 100" aria-hidden="true">
                                            <g fill="none" strokeWidth="1.5">
                                                <path
                                                    vectorEffect="non-scaling-stroke"
                                                    d="m5 50 5 50m5-50-5 50m5-50 5 43.333M25 50l-5 43.333M25 50l5 36.667M35 50l-5 36.667M35 50l5 30m5-30-5 30m5-30 5 23.333M55 50l-5 23.333M55 50l5 16.667M65 50l-5 16.667M65 50l5 10m5-10-5 10m5-10 5 3.333M85 50l-5 3.333"
                                                    stroke={strongholdLossColor}
                                                />
                                                <path
                                                    vectorEffect="non-scaling-stroke"
                                                    d="m85 50 5-3.333M95 50l-5-3.333M95 50l5-10m5 10-5-10m5 10 5-16.667M115 50l-5-16.667M115 50l5-23.333M125 50l-5-23.333M125 50l5-30m5 30-5-30m5 30 5-36.667M145 50l-5-36.667M145 50l5-43.333M155 50l-5-43.333M155 50l5-50m5 50-5-50"
                                                    stroke={strongholdGainColor}
                                                />
                                            </g>
                                        </svg>
                                    </div>
                                    <span className="text-right">
                                    {maxStrongholdAbsDiff ? `+${maxStrongholdAbsDiff.toFixed(1)} pt.` : '+0.0 pt.'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )
                ) : null
            ) : isOpacityMetric ? (
                <div className="border-t border-line px-3 py-2">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.03em] text-ink-muted">
                        <span>Opacity scale</span>
                        <span className="text-[0.75rem] font-semibold normal-case text-ink">
                            {selectedMetric?.label || 'Selected metric'}
                        </span>
                    </div>
                    {metricRange ? (
                        <>
                            <div className="flex items-center gap-3 text-[0.8rem] text-ink-muted">
                                <span className="min-w-[80px] text-left">
                                    {formatMetricValue(metricRange.min, selectedMetric?.unit)}
                                </span>
                                <div className="relative h-2 flex-1 rounded-full bg-surface-muted">
                                    <div
                                        className="absolute inset-0 rounded-full"
                                        style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.2), rgba(0,0,0,1))' }}
                                    />
                                    <span className="absolute left-1/2 top-1/2 h-3 w-[1px] -translate-y-1/2 bg-white/70" />
                                </div>
                                <span className="min-w-[80px] text-right">
                                    {formatMetricValue(metricRange.max, selectedMetric?.unit)}
                                </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[0.7rem] text-ink-faint">
                                <span>Lower</span>
                                <span>Higher</span>
                            </div>
                        </>
                    ) : (
                        <div className="text-[0.8rem] text-ink-muted">No data available for this metric.</div>
                    )}
                </div>
            ) : (
                <div className="border-t border-line px-3 py-2">
                    <div className="mb-1 flex items-center justify-between">
                        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.03em] text-ink-muted">
                            {voteType === 'first' ? 'First Vote Share' : 'Second Vote Share'}
                        </span>
                        {filteredStates && filteredStates.size > 0 && (
                            <span className="rounded bg-surface-muted px-1.5 py-[0.1rem] text-[0.65rem] font-medium text-ink-faint">
                                {filteredStates.size} state{filteredStates.size > 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-x-3 gap-y-1">
                        {partyPercentages.map(({ party, percent }) => (
                            <div key={party} className="flex items-center gap-2 py-0.5 text-[0.9rem]">
                                <div
                                    className="h-[9px] w-[9px] flex-shrink-0 rounded-sm"
                                    style={{ backgroundColor: party === 'Other' ? '#888' : getPartyColor(party, partyOpts) }}
                                />
                                <span className="truncate font-semibold text-ink">{party}</span>
                                <span className="ml-auto text-ink-faint">{percent.toFixed(1)}%</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
