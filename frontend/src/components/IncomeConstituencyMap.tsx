import { useEffect, useMemo, useState } from 'react';
import { getPartyColor, getPartyDisplayName } from '../utils/party';
import { cn } from '../utils/cn';

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

export interface IncomeData {
    constituency_id: number;
    constituency_number: number;
    constituency_name: string;
    party_name: string;
    disposable_income: number | null;
}

interface IncomeConstituencyMapProps {
    year: number;
    data: IncomeData[];
    selectedConstituencyNumber: number | null;
    onSelectConstituency: (number: number) => void;
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

function projectPoint(
    lon: number,
    lat: number,
    bounds: BoundsWithSize
): [number, number] {
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

export function IncomeConstituencyMap({ year, data, selectedConstituencyNumber, onSelectConstituency }: IncomeConstituencyMapProps) {
    const [geoData, setGeoData] = useState<GeoFeatureCollection | null>(null);
    const [stateGeoData, setStateGeoData] = useState<StateGeoFeatureCollection | null>(null);
    const [hoveredNumber, setHoveredNumber] = useState<number | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

    const partyOpts = { combineCduCsu: true };

    const dataMap = useMemo(() => {
        const map = new Map<number, IncomeData>();
        data.forEach(d => map.set(d.constituency_number, d));
        return map;
    }, [data]);

    const { minIncome, maxIncome } = useMemo(() => {
        let min = Infinity;
        let max = -Infinity;
        data.forEach(d => {
            if (d.disposable_income !== null) {
                if (d.disposable_income < min) min = d.disposable_income;
                if (d.disposable_income > max) max = d.disposable_income;
            }
        });
        return { minIncome: min === Infinity ? 0 : min, maxIncome: max === -Infinity ? 1 : max };
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
        if (!geoData) return { bounds: null, paths: [] };
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
        const pathsData = geoData.features.map(feature => ({
            number: feature.properties.WKR_NR,
            name: feature.properties.WKR_NAME,
            stateName: feature.properties.LAND_NAME,
            path: featureToPath(feature, boundsWithSize),
        }));

        return { bounds: boundsWithSize, paths: pathsData };
    }, [geoData]);

    const stateBorderPaths = useMemo(() => {
        if (!stateGeoData || !bounds) return [];
        return stateGeoData.features.map(feature => ({
            path: featureToPath(feature, bounds)
        }));
    }, [stateGeoData, bounds]);

    const cities = useMemo(() => {
        if (!bounds) return [];
        const cityData = [
            { name: 'Berlin', lon: 13.405, lat: 52.52 },
            { name: 'Hamburg', lon: 9.993, lat: 53.551 },
            { name: 'Munich', lon: 11.582, lat: 48.135 },
            { name: 'Cologne', lon: 6.96, lat: 50.937 },
            { name: 'Frankfurt', lon: 8.682, lat: 50.11 },
        ];
        return cityData.map(c => {
            const [x, y] = projectPoint(c.lon, c.lat, bounds);
            return { ...c, x, y };
        });
    }, [bounds]);

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
                        const income = item?.disposable_income;
                        const fillColor = item ? getPartyColor(item.party_name, partyOpts) : '#ccc';
                        
                        let opacity = 0.2;
                        if (income !== undefined && income !== null) {
                            // Normalize income for opacity between 0.2 and 1.0
                            const range = maxIncome - minIncome;
                            if (range > 0) {
                                opacity = 0.2 + 0.8 * ((income - minIncome) / range);
                            } else {
                                opacity = 0.6;
                            }
                        }

                        const isSelected = selectedConstituencyNumber === number;
                        const isHovered = hoveredNumber === number;

                        return (
                            <path
                                key={number}
                                d={path}
                                fill={fillColor}
                                fillOpacity={isSelected || isHovered ? 1.0 : opacity}
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

                    <g pointerEvents="none">
                        {cities.map(city => (
                            <g key={city.name} transform={`translate(${city.x}, ${city.y})`}>
                                <circle r={3} fill="#333" stroke="#fff" strokeWidth={1.5} />
                                <text x={8} y={4} fontSize={11} fontWeight={600} fill="#333" stroke="#fff" strokeWidth={2.5} paintOrder="stroke">{city.name}</text>
                            </g>
                        ))}
                    </g>
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
                        if (item) {
                            return (
                                <div className="text-[0.85rem] text-ink">
                                    <div>Winner Party: {getPartyDisplayName(item.party_name, partyOpts)}</div>
                                    <div>Disposable Income: {item.disposable_income?.toLocaleString()} &euro;</div>
                                </div>
                            );
                        }
                        return <div className="text-[0.85rem] text-ink-muted">No data</div>;
                    })()}
                </div>
            )}
            
            <div className="border-t border-line px-3 py-2">
                <div className="mb-1 text-[0.85rem] font-bold text-ink">Income per Capita</div>
                <div className="flex items-center justify-between text-[0.8rem] text-ink-muted">
                    <span>{minIncome.toLocaleString()} &euro;</span>
                    <span className="mx-2 inline-block h-2.5 w-[100px]" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.2), rgba(0,0,0,1))' }}></span>
                    <span>{maxIncome.toLocaleString()} &euro;</span>
                </div>
                 <div className="mt-2 text-[0.8rem] text-ink-muted">Opacity indicates income. Color indicates winning party.</div>
            </div>
        </div>
    );
}
