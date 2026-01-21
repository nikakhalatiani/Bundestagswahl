import { useEffect, useMemo, useState } from 'react';
import type { PartyStrengthItem } from '../types/api';
import { getPartyColor, getPartyDisplayName } from '../utils/party';

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

interface PartyStrengthMapProps {
    year: number;
    partyName: string;
    data: PartyStrengthItem[];
    mode: 'strength' | 'change';
}

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

type BoundsWithSize = { minLon: number; maxLon: number; minLat: number; maxLat: number; width: number; height: number; cosLat: number };

function projectPoint(lon: number, lat: number, bounds: BoundsWithSize): [number, number] {
    const { minLon, maxLon, minLat, maxLat, width, height } = bounds;
    const x = ((lon - minLon) / (maxLon - minLon)) * width;
    const y = ((maxLat - lat) / (maxLat - minLat)) * height;
    return [x, y];
}

function coordsToPath(coords: number[][], bounds: BoundsWithSize): string {
    if (coords.length === 0) return '';
    const points = coords.map(([lon, lat]) => projectPoint(lon, lat, bounds));
    return 'M' + points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z';
}

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

function hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return `rgba(0,0,0,${alpha})`;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function PartyStrengthMap({ year, partyName, data, mode }: PartyStrengthMapProps) {
    const [geoData, setGeoData] = useState<GeoFeatureCollection | null>(null);
    const [stateGeoData, setStateGeoData] = useState<StateGeoFeatureCollection | null>(null);
    const [hoveredNumber, setHoveredNumber] = useState<number | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

    const partyOpts = { combineCduCsu: true };
    const partyColor = getPartyColor(partyName, partyOpts);
    const lossColor = '#b7410e';
    const gainColor = 'teal';

    const dataMap = useMemo(() => {
        const map = new Map<number, PartyStrengthItem>();
        data.forEach(d => map.set(d.constituency_number, d));
        return map;
    }, [data]);

    const maxPercent = useMemo(() => {
        return data.reduce((max, d) => Math.max(max, d.percent || 0), 0);
    }, [data]);

    const maxAbsDiff = useMemo(() => {
        return data.reduce((max, d) => Math.max(max, Math.abs(d.diff_percent_pts ?? 0)), 0);
    }, [data]);

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

    const { bounds, paths } = useMemo(() => {
        if (!geoData) return { bounds: null, paths: [] as Array<{ number: number; name: string; stateName: string; path: string; cx: number; cy: number; }> };
        const b = computeBounds(geoData.features);
        const padLon = (b.maxLon - b.minLon) * 0.02;
        const padLat = (b.maxLat - b.minLat) * 0.02;
        const paddedBounds = {
            minLon: b.minLon - padLon,
            maxLon: b.maxLon + padLon,
            minLat: b.minLat - padLat,
            maxLat: b.maxLat + padLat,
        };

        const latRange = paddedBounds.maxLat - paddedBounds.minLat;
        const lonRange = paddedBounds.maxLon - paddedBounds.minLon;
        const avgLat = (paddedBounds.minLat + paddedBounds.maxLat) / 2;
        const cosLat = Math.cos((avgLat * Math.PI) / 180);
        const aspectRatio = (lonRange * cosLat) / latRange;
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
                path: featureToPath(feature, boundsWithSize),
                cx,
                cy,
            };
        });

        return { bounds: boundsWithSize, paths: pathsData };
    }, [geoData]);

    const stateBorderPaths = useMemo(() => {
        if (!stateGeoData || !bounds) return [];
        return stateGeoData.features.map(feature => ({
            path: featureToPath(feature as unknown as GeoFeature, bounds)
        }));
    }, [stateGeoData, bounds]);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!hoveredNumber) {
            setTooltipPos(null);
            return;
        }
        const tooltipWidth = 220;
        const tooltipHeight = 100;
        let x = e.clientX + 15;
        let y = e.clientY + 15;
        if (x + tooltipWidth > window.innerWidth) x = e.clientX - tooltipWidth - 15;
        if (y + tooltipHeight > window.innerHeight) y = e.clientY - tooltipHeight - 15;
        setTooltipPos({ x, y });
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
                    {paths.map(({ number, path }) => {
                        const item = dataMap.get(number);
                        const percent = item?.percent ?? 0;
                        const scale = maxPercent > 0 ? percent / maxPercent : 0;
                        const opacity = mode === 'strength' ? 0.2 + 0.75 * scale : 0.3;
                        const fillColor = item ? partyColor : '#d0d0d0';

                        return (
                            <path
                                key={number}
                                d={path}
                                fill={mode === 'strength' ? fillColor : '#f1f1f1'}
                                fillOpacity={mode === 'strength' ? opacity : 1}
                                stroke="none"
                                className="cursor-pointer"
                                onMouseEnter={() => setHoveredNumber(number)}
                                onMouseLeave={() => setHoveredNumber(null)}
                            />
                        );
                    })}

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

                    {mode === 'change' && (
                        <g pointerEvents="none">
                            {paths.map(({ number, cx, cy }) => {
                                const item = dataMap.get(number);
                                const diff = item?.diff_percent_pts;
                                if (diff === null || diff === undefined || diff === 0) return null;
                                const magnitude = Math.abs(diff);
                                const scale = maxAbsDiff > 0 ? magnitude / maxAbsDiff : 0;
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
                                        stroke={isGain ? gainColor : lossColor}
                                        strokeWidth={2}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        opacity={opacity}
                                    />
                                );
                            })}
                        </g>
                    )}
                </svg>
            </div>

            {hoveredNumber && tooltipPos && (
                <div className="fixed z-[1000] min-w-[220px] max-w-[300px] rounded bg-white p-3 shadow-[0_4px_20px_rgba(0,0,0,0.25)] pointer-events-none" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
                    <div className="mb-3 border-b border-[#eee] pb-2 text-base font-bold text-ink">
                        {paths.find(p => p.number === hoveredNumber)?.name}
                        <span className="mt-1 block text-[0.75rem] font-normal text-ink-faint">
                            {paths.find(p => p.number === hoveredNumber)?.stateName}
                        </span>
                    </div>
                    {(() => {
                        const item = dataMap.get(hoveredNumber);
                        if (!item) return <div>No data</div>;
                        if (mode === 'strength') {
                            return (
                                <div>
                                    <div>Party: {getPartyDisplayName(partyName, partyOpts)}</div>
                                    <div>Vote share: {item.percent.toFixed(1)}%</div>
                                    <div>Votes: {item.votes.toLocaleString()}</div>
                                </div>
                            );
                        }
                        return (
                            <div>
                                <div>Party: {getPartyDisplayName(partyName, partyOpts)}</div>
                                {item.diff_percent_pts === null ? (
                                    <div>No change data</div>
                                ) : (
                                    <div>Change: {item.diff_percent_pts > 0 ? '+' : ''}{item.diff_percent_pts.toFixed(1)} pt.</div>
                                )}
                                <div>Vote share: {item.percent.toFixed(1)}%</div>
                            </div>
                        );
                    })()}
                </div>
            )}

            {mode === 'strength' && (
                <div className="flex items-center justify-center gap-4 border-t border-line px-3 py-2 text-base text-ink-muted">
                    <span>0%</span>
                    <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(to right, rgba(0,0,0,0.15), ${partyColor})` }} />
                    <span>{maxPercent.toFixed(1)}%</span>
                </div>
            )}

            {mode === 'change' && (
                <div className="flex items-center justify-center gap-0 border-t border-line px-3 py-2 text-base text-ink-muted">
                    <span className="min-w-[56px] text-center">{maxAbsDiff ? `-${maxAbsDiff.toFixed(0)} pt.` : '-0 pt.'}</span>
                    <span className="flex h-[70px] w-[160px] items-center justify-center">
                        <svg className="h-[75px] w-[160px]" viewBox="0 0 170 100" aria-hidden="true">
                            <g fill="none" strokeWidth="1.5">
                                <path
                                    vectorEffect="non-scaling-stroke"
                                    d="m5 50 5 50m5-50-5 50m5-50 5 43.333M25 50l-5 43.333M25 50l5 36.667M35 50l-5 36.667M35 50l5 30m5-30-5 30m5-30 5 23.333M55 50l-5 23.333M55 50l5 16.667M65 50l-5 16.667M65 50l5 10m5-10-5 10m5-10 5 3.333M85 50l-5 3.333"
                                    stroke="#b7410e"
                                />
                                <path
                                    vectorEffect="non-scaling-stroke"
                                    d="m85 50 5-3.333M95 50l-5-3.333M95 50l5-10m5 10-5-10m5 10 5-16.667M115 50l-5-16.667M115 50l5-23.333M125 50l-5-23.333M125 50l5-30m5 30-5-30m5 30 5-36.667M145 50l-5-36.667M145 50l5-43.333M155 50l-5-43.333M155 50l5-50m5 50-5-50"
                                    stroke="teal"
                                />
                            </g>
                        </svg>
                    </span>
                    <span className="min-w-[56px] text-center">{maxAbsDiff ? `+${maxAbsDiff.toFixed(0)} pt.` : '+0 pt.'}</span>
                </div>
            )}
        </div>
    );
}
