import { useEffect, useMemo, useState } from 'react';
import type { ConstituencyWinnerItem, ConstituencyVotesBulkItem } from '../types/api';
import { getPartyColor, getPartyDisplayName } from '../utils/party';

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

export function ConstituencyMap({ year, winners, votesBulk, selectedConstituencyNumber, onSelectConstituency, voteType, filteredStates }: ConstituencyMapProps) {
    const [geoData, setGeoData] = useState<GeoFeatureCollection | null>(null);
    const [stateGeoData, setStateGeoData] = useState<StateGeoFeatureCollection | null>(null);
    const [hoveredNumber, setHoveredNumber] = useState<number | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

    const partyOpts = { combineCduCsu: true };
    const winnerMap = useMemo(() => createWinnerMap(winners), [winners]);

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
        const pathsData = geoData.features.map(feature => ({
            number: feature.properties.WKR_NR,
            name: feature.properties.WKR_NAME,
            stateName: feature.properties.LAND_NAME,
            stateId: feature.properties.LAND_NR,
            path: featureToPath(feature, boundsWithSize),
        }));

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
    }, [votesBulk, voteType, filteredStates, constituencyToState]);

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

    if (!geoData || !bounds) {
        return (
            <div className="constituency-map-loading">
                <div className="spinner"></div>
                <div>Loading map...</div>
            </div>
        );
    }

    return (
        <div className="constituency-map-container">
            <div className="constituency-map-wrapper" onMouseMove={handleMouseMove}>
                <svg
                    viewBox={`0 0 ${bounds.width} ${bounds.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    className="constituency-map-svg"
                >
                    {/* Layer 1: Constituency fills */}
                    {paths.map(({ number, path, stateName }) => {
                        const winnerData = getWinnerByVoteType(number);
                        const fillColor = winnerData ? getPartyColor(winnerData.party, partyOpts) : '#ccc';
                        // Map percentage to discrete opacity segments
                        const percent = winnerData?.percent || 0;
                        let baseOpacity = 0.6;
                        if (percent >= 40) baseOpacity = 0.8;
                        else if (percent >= 35) baseOpacity = 0.75;
                        else if (percent >= 30) baseOpacity = 0.7;
                        else if (percent >= 25) baseOpacity = 0.65;

                        const isSelected = selectedConstituencyNumber === number;
                        const isHovered = hoveredNumber === number;

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
                                className={`constituency-path${isSelected ? ' selected' : ''}`}
                                onMouseEnter={() => setHoveredNumber(number)}
                                onMouseLeave={() => setHoveredNumber(null)}
                                onClick={() => onSelectConstituency(number)}
                            />
                        );
                    })}

                    {/* Layer 2: Thin constituency borders */}
                    <g className="constituency-borders-layer" pointerEvents="none">
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

                    {/* Layer 3: State borders (thick white lines) */}
                    <g className="state-borders-layer" pointerEvents="none">
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

                    {/* Layer 4: City markers */}
                    <g className="city-markers-layer" pointerEvents="none">
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
                    className="constituency-tooltip"
                    style={{ left: tooltipPos.x, top: tooltipPos.y }}
                >
                    <div className="constituency-tooltip-title">
                        {paths.find(p => p.number === hoveredNumber)?.name}
                        <span className="constituency-tooltip-state">
                            {paths.find(p => p.number === hoveredNumber)?.stateName}
                        </span>
                    </div>
                    <div className="constituency-tooltip-vote-type">
                        {voteType === 'first' ? 'First Votes (Erststimmen)' : 'Second Votes (Zweitstimmen)'}
                    </div>
                    {(() => {
                        const voteData = votesBulkMap.get(hoveredNumber);
                        if (!voteData || voteData.parties.length === 0) {
                            // Fallback to winner data
                            if (hoveredWinner) {
                                return (
                                    <div className="constituency-tooltip-row">
                                        <div
                                            className="constituency-tooltip-bar"
                                            style={{
                                                backgroundColor: getPartyColor(hoveredWinner.party_name, partyOpts),
                                                width: `${Math.min(hoveredWinner.percent_of_valid || 0, 100)}%`
                                            }}
                                        />
                                        <span className="constituency-tooltip-party">
                                            {getPartyDisplayName(hoveredWinner.party_name, partyOpts)}
                                        </span>
                                        <span className="constituency-tooltip-pct">
                                            {hoveredWinner.percent_of_valid?.toFixed(1)}%
                                        </span>
                                    </div>
                                );
                            }
                            return <div className="constituency-tooltip-no-data">No data available</div>;
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
                            <div className="constituency-tooltip-parties">
                                {top5.map((party, idx) => {
                                    const percent = voteType === 'first' ? party.first_percent : party.second_percent;
                                    const votes = voteType === 'first' ? party.first_votes : party.second_votes;
                                    const barWidth = maxPercent > 0 ? (percent / maxPercent) * 100 : 0;

                                    return (
                                        <div key={idx} className="constituency-tooltip-row">
                                            <div
                                                className="constituency-tooltip-bar"
                                                style={{
                                                    backgroundColor: getPartyColor(party.party_name, partyOpts),
                                                    width: `${barWidth}%`
                                                }}
                                            />
                                            <span className="constituency-tooltip-party">
                                                {getPartyDisplayName(party.party_name, partyOpts)}
                                            </span>
                                            <span className="constituency-tooltip-pct">
                                                {percent.toFixed(1)}%
                                            </span>
                                            <span className="constituency-tooltip-votes">
                                                {votes.toLocaleString()}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}
                    {hoveredWinner && voteType === 'first' && (
                        <div className="constituency-tooltip-candidate">
                            Winner: {hoveredWinner.winner_name}
                        </div>
                    )}
                </div>
            )}

            {/* Compact Legend with dynamic percentages */}
            <div className="constituency-map-legend compact">
                <div className="constituency-map-legend-header">
                    <span className="constituency-map-legend-title">
                        {voteType === 'first' ? 'First Vote Share' : 'Second Vote Share'}
                    </span>
                    {filteredStates && filteredStates.size > 0 && (
                        <span className="constituency-map-legend-filter-note">
                            {filteredStates.size} state{filteredStates.size > 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <div className="constituency-map-legend-grid">
                    {partyPercentages.map(({ party, percent }) => (
                        <div key={party} className="constituency-map-legend-item-compact">
                            <div
                                className="constituency-map-legend-dot"
                                style={{ backgroundColor: party === 'Other' ? '#888' : getPartyColor(party, partyOpts) }}
                            />
                            <span className="constituency-map-legend-party-abbr">{party}</span>
                            <span className="constituency-map-legend-pct">{percent.toFixed(1)}%</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
