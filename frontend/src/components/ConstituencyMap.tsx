import { useEffect, useMemo, useState } from 'react';
import type { ConstituencyWinnerItem } from '../types/api';
import { getPartyColor, getPartyDisplayName } from '../utils/party';

// GeoJSON types
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

interface ConstituencyMapProps {
    year: number;
    winners: ConstituencyWinnerItem[];
    selectedConstituencyNumber: number | null;
    onSelectConstituency: (number: number) => void;
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

export function ConstituencyMap({ year, winners, selectedConstituencyNumber, onSelectConstituency }: ConstituencyMapProps) {
    const [geoData, setGeoData] = useState<GeoFeatureCollection | null>(null);
    const [hoveredNumber, setHoveredNumber] = useState<number | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

    const partyOpts = { combineCduCsu: true };
    const winnerMap = useMemo(() => createWinnerMap(winners), [winners]);

    // Import GeoJSON statically then switch
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
            path: featureToPath(feature, boundsWithSize),
        }));

        return { bounds: boundsWithSize, paths: pathsData };
    }, [geoData]);

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
                    {paths.map(({ number, path }) => {
                        const winner = winnerMap.get(number);
                        const fillColor = winner ? getPartyColor(winner.party_name, partyOpts) : '#ccc';
                        const isSelected = selectedConstituencyNumber === number;
                        const isHovered = hoveredNumber === number;

                        return (
                            <path
                                key={number}
                                d={path}
                                fill={fillColor}
                                fillOpacity={isSelected || isHovered ? 1 : 0.85}
                                stroke="#fff"
                                strokeWidth={isSelected ? 1.5 : 0.3}
                                strokeLinejoin="round"
                                className="constituency-path"
                                onMouseEnter={() => setHoveredNumber(number)}
                                onMouseLeave={() => setHoveredNumber(null)}
                                onClick={() => onSelectConstituency(number)}
                                style={isSelected ? { filter: 'drop-shadow(0 0 3px rgba(0,0,0,0.4))' } : undefined}
                            />
                        );
                    })}
                </svg>
            </div>

            {/* Tooltip */}
            {hoveredNumber && tooltipPos && (
                <div
                    className="constituency-tooltip"
                    style={{ left: tooltipPos.x, top: tooltipPos.y }}
                >
                    <div className="constituency-tooltip-title">
                        {paths.find(p => p.number === hoveredNumber)?.name}
                    </div>
                    {hoveredWinner && (
                        <>
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
                                <span className="constituency-tooltip-votes">
                                    {hoveredWinner.first_votes?.toLocaleString()}
                                </span>
                            </div>
                            <div className="constituency-tooltip-candidate">
                                Winner: {hoveredWinner.winner_name}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Legend */}
            <div className="constituency-map-legend">
                <div className="constituency-map-legend-title">Winning Party</div>
                <div className="constituency-map-legend-items">
                    {LEGEND_PARTIES.map(({ key, label }) => (
                        <div key={key} className="constituency-map-legend-item">
                            <div
                                className="constituency-map-legend-color"
                                style={{ backgroundColor: getPartyColor(key, partyOpts) }}
                            />
                            <span>{label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
