import React, { useEffect, useMemo, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts';
import { Card, CardHeader, CardSubtitle, CardTitle } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { ToggleSwitch } from '../components/ui/ToggleSwitch';
import { usePartyConstituencyStrength, usePartyList, useStructuralData } from '../hooks/useQueries';
import { getPartyColor, getPartyDisplayName } from '../utils/party';

type ScatterPoint = {
  constituency_number: number;
  constituency_name: string;
  x_value: number;
  y_value: number;
  total_voters: number;
};

interface ForeignerAfdScatterPageProps {
  year: number;
}

const PARTY_ORDER = ['AfD', 'SPD', 'CDU/CSU', 'GRÜNE', 'FDP', 'DIE LINKE', 'BSW'];

export const ForeignerAfdScatterPage: React.FC<ForeignerAfdScatterPageProps> = ({ year }) => {
  const [selectedParty, setSelectedParty] = useState<string | null>(null);
  const [xMetricKey, setXMetricKey] = useState('foreigner_pct');
  const [voteType, setVoteType] = useState<1 | 2>(2);

  const { data: partyListData, isLoading: loadingParties } = usePartyList(year);
  const { data: structuralData, isLoading: loadingStructural } = useStructuralData(year);
  const { data: strengthData, isLoading: loadingStrength } = usePartyConstituencyStrength(year, selectedParty ?? undefined, voteType);

  const structuralMetrics = structuralData?.metrics ?? [];
  const structuralValues = structuralData?.values ?? [];
  const partyList = partyListData?.data ?? [];

  const partyOptions = useMemo(() => {
    const raw = new Set(partyList.map((party) => party.short_name).filter(Boolean));
    if (raw.has('CDU') || raw.has('CSU')) {
      raw.delete('CDU');
      raw.delete('CSU');
      raw.add('CDU/CSU');
    }
    const list = Array.from(raw);
    list.sort((a, b) => {
      const aIndex = PARTY_ORDER.indexOf(a);
      const bIndex = PARTY_ORDER.indexOf(b);
      if (aIndex !== -1 || bIndex !== -1) {
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      }
      return a.localeCompare(b);
    });
    return list;
  }, [partyList]);

  useEffect(() => {
    if (selectedParty || partyOptions.length === 0) return;
    setSelectedParty(partyOptions[0]);
  }, [partyOptions, selectedParty]);

  useEffect(() => {
    if (!selectedParty) return;
    if (partyOptions.includes(selectedParty)) return;
    setSelectedParty(partyOptions[0] ?? null);
  }, [partyOptions, selectedParty]);

  useEffect(() => {
    if (structuralMetrics.length === 0) return;
    const hasMetric = structuralMetrics.some(metric => metric.key === xMetricKey);
    if (hasMetric) return;
    const fallback = structuralMetrics.find(metric => metric.key === 'foreigner_pct')?.key ?? structuralMetrics[0].key;
    setXMetricKey(fallback);
  }, [structuralMetrics, xMetricKey]);

  const metricOptions = useMemo(() => {
    return structuralMetrics.map(metric => ({
      key: metric.key,
      label: metric.unit ? `${metric.label} (${metric.unit})` : metric.label,
      unit: metric.unit ?? '',
    }));
  }, [structuralMetrics]);

  const selectedMetric = useMemo(() => {
    return structuralMetrics.find(metric => metric.key === xMetricKey) ?? null;
  }, [structuralMetrics, xMetricKey]);

  const strengthItems = strengthData?.data ?? [];
  const strengthMap = useMemo(() => {
    const map = new Map<number, { yValue: number; totalVoters: number }>();
    strengthItems.forEach(item => {
      const rawTotal = item.total_voters ?? 0;
      const totalVoters = rawTotal > 0 ? rawTotal : (item.votes ?? 0);
      map.set(item.constituency_number, {
        yValue: item.percent,
        totalVoters,
      });
    });
    return map;
  }, [strengthItems]);

  const points = useMemo(() => {
    if (!selectedMetric) return [];
    return structuralValues
      .map((item): ScatterPoint | null => {
        const xValue = item.metrics[xMetricKey];
        if (xValue === null || xValue === undefined) return null;
        const strength = strengthMap.get(item.constituency_number);
        if (!strength) return null;
        const yValue = strength.yValue;
        if (xValue === 0 || yValue === 0) return null;
        return {
          constituency_number: item.constituency_number,
          constituency_name: item.constituency_name,
          x_value: Number(xValue),
          y_value: yValue,
          total_voters: strength.totalVoters,
        };
      })
      .filter((item): item is ScatterPoint => Boolean(item));
  }, [structuralValues, xMetricKey, selectedMetric, strengthMap]);

  const partyLabel = selectedParty
    ? getPartyDisplayName(selectedParty, { combineCduCsu: true })
    : 'Party';
  const partyColor = selectedParty ? getPartyColor(selectedParty, { combineCduCsu: true }) : '#009ee0';
  const voteLabel = voteType === 1 ? 'First vote share' : 'Second vote share';
  const xAxisLabel = selectedMetric
    ? selectedMetric.unit
      ? `${selectedMetric.label} (${selectedMetric.unit})`
      : selectedMetric.label
    : 'Metric';
  const xAxisUnit = selectedMetric?.unit === '%' ? '%' : '';
  const yAxisLabel = `${partyLabel} ${voteLabel}`;

  const axisLabelStyle = {
    fill: 'var(--text-muted)',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 0.4,
  };
  const axisTickStyle = {
    fill: 'var(--text-muted)',
    fontSize: 12,
  };

  const formatMetricValue = (value: number, unit?: string | null) => {
    const isPercent = unit?.includes('%');
    const formatted = value.toLocaleString(undefined, { maximumFractionDigits: isPercent ? 1 : 2 });
    return unit ? `${formatted} ${unit}` : formatted;
  };

  const loading = loadingParties || loadingStructural || loadingStrength;
  const stats = useMemo(() => {
    if (points.length === 0) return null;
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    points.forEach(point => {
      xMin = Math.min(xMin, point.x_value);
      xMax = Math.max(xMax, point.x_value);
      yMin = Math.min(yMin, point.y_value);
      yMax = Math.max(yMax, point.y_value);
    });
    return { count: points.length, xMin, xMax, yMin, yMax };
  }, [points]);

  if (loading) {
    return (
      <div className="mt-8 flex flex-col items-center justify-center px-8 py-16">
        <div className="h-[50px] w-[50px] animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-surface-accent border-t-brand-black"></div>
        <div className="mt-4 font-medium text-ink-muted">Loading analysis data...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Correlation explorer</CardTitle>
              <CardSubtitle>
                Compare party vote shares against constituency structure metrics.
              </CardSubtitle>
            </div>
            <ToggleSwitch
              leftLabel="1st"
              rightLabel="2nd"
              value={voteType === 1 ? 'left' : 'right'}
              onChange={(value) => setVoteType(value === 'left' ? 1 : 2)}
              leftTitle="Switch to first votes"
              rightTitle="Switch to second votes"
            />
          </div>
          <div className="rounded-lg border border-line bg-surface-muted p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-ink-muted">X-axis metric</span>
                <Select
                  containerClassName="flex-1 min-w-[220px]"
                  className="w-full text-[0.85rem] bg-white"
                  value={xMetricKey}
                  onChange={(e) => setXMetricKey(e.target.value)}
                  disabled={structuralMetrics.length === 0}
                >
                  {metricOptions.map(option => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-ink-muted">Y-axis party</span>
                <Select
                  containerClassName="flex-1 min-w-[220px]"
                  className="w-full text-[0.85rem] bg-white"
                  value={selectedParty ?? ''}
                  onChange={(e) => setSelectedParty(e.target.value)}
                  disabled={partyOptions.length === 0}
                >
                  {partyOptions.map(party => (
                    <option key={party} value={party}>
                      {party}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {stats && (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded border border-line bg-surface px-3 py-2">
                  <div className="text-[0.65rem] font-semibold uppercase tracking-[0.04em] text-ink-muted">Constituencies</div>
                  <div className="text-[0.95rem] font-semibold text-ink">{stats.count.toLocaleString()}</div>
                </div>
                <div className="rounded border border-line bg-surface px-3 py-2">
                  <div className="text-[0.65rem] font-semibold uppercase tracking-[0.04em] text-ink-muted">{xAxisLabel} range</div>
                  <div className="text-[0.95rem] font-semibold text-ink">
                    {formatMetricValue(stats.xMin, selectedMetric?.unit)} – {formatMetricValue(stats.xMax, selectedMetric?.unit)}
                  </div>
                </div>
                <div className="rounded border border-line bg-surface px-3 py-2">
                  <div className="text-[0.65rem] font-semibold uppercase tracking-[0.04em] text-ink-muted">{partyLabel} range</div>
                  <div className="text-[0.95rem] font-semibold text-ink">
                    {stats.yMin.toFixed(1)}% – {stats.yMax.toFixed(1)}%
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <div className="h-[600px] p-4">
          {points.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-ink-muted">
              <div className="text-sm">No data available for the selected axes.</div>
            </div>
          ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 40, left: 40 }}>
                  <CartesianGrid stroke="var(--border-color)" strokeDasharray="4 4" />
                  <XAxis
                    type="number"
                    dataKey="x_value"
                    name={xAxisLabel}
                    unit={xAxisUnit}
                    domain={['auto', 'auto']}
                    tickFormatter={(value) => Number(value).toLocaleString()}
                    tick={axisTickStyle}
                    tickLine={{ stroke: 'var(--border-color)' }}
                    axisLine={{ stroke: 'var(--border-color)' }}
                    label={{ value: xAxisLabel, position: 'insideBottom', offset: -18, ...axisLabelStyle }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y_value"
                    name={yAxisLabel}
                    unit="%"
                    domain={[0, 'auto']}
                    tick={axisTickStyle}
                    tickLine={{ stroke: 'var(--border-color)' }}
                    axisLine={{ stroke: 'var(--border-color)' }}
                    label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', ...axisLabelStyle }}
                  />
                  <ZAxis type="number" dataKey="total_voters" range={[140, 400]} name="Voters" />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const d = payload[0].payload as ScatterPoint;
                        return (
                        <div className="pointer-events-none min-w-[220px] max-w-[280px] rounded bg-white p-3 shadow-[0_4px_20px_rgba(0,0,0,0.25)]">
                            <div className="mb-2 border-b border-[#eee] pb-2 text-base font-bold text-ink">
                              {d.constituency_name} (WK {d.constituency_number})
                            </div>
                            <div className="mb-2 text-[0.7rem] uppercase tracking-[0.05em] text-ink-faint">
                              {xAxisLabel} vs {partyLabel}
                            </div>
                            <div className="text-[0.85rem] text-ink">
                              <span className="font-semibold">{xAxisLabel}:</span> {formatMetricValue(d.x_value, selectedMetric?.unit)}
                            </div>
                            <div className="text-[0.85rem] text-ink">
                              <span className="font-semibold">{partyLabel}:</span> {d.y_value.toFixed(1)}%
                            </div>
                            <div className="mt-2 text-[0.8rem] text-ink-faint">Voters: {d.total_voters.toLocaleString()}</div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Scatter name="Constituencies" data={points} fill={partyColor} fillOpacity={0.6} stroke={partyColor} strokeWidth={0.4} />
                </ScatterChart>
              </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
};
