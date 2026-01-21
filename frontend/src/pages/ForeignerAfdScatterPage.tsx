import React, { useEffect, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts';
import { Card, CardHeader, CardSubtitle, CardTitle } from '../components/ui/Card';

type DataPoint = {
  constituency_number: number;
  constituency_name: string;
  foreigner_pct: number;
  afd_percent: number;
  total_voters: number;
};

export const ForeignerAfdScatterPage: React.FC = () => {
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/foreigner-afd')
      .then(res => res.json())
      .then(json => {
        setData(json.data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  if (loading) return (
    <div className="mt-8 flex flex-col items-center justify-center px-8 py-16">
        <div className="h-[50px] w-[50px] animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-surface-accent border-t-brand-black"></div>
        <div className="mt-4 font-medium text-ink-muted">Loading analysis data...</div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <Card>
        <CardHeader>
           <div>
              <CardTitle>Foreigner % vs. AfD Votes</CardTitle>
              <CardSubtitle>
                 Each bubble represents a constituency. Bubble size represents total voters.
              </CardSubtitle>
           </div>
        </CardHeader>
        <div className="h-[600px] p-4">
            <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 40, left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                type="number" 
                dataKey="foreigner_pct" 
                name="Foreigner %" 
                unit="%" 
                ticks={[0, 10, 20, 30, 40]}
                domain={[0, 'auto']}
                label={{ value: "Foreigner Percentage", position: 'insideBottom', offset: -20 }}
                />
                <YAxis 
                type="number" 
                dataKey="afd_percent" 
                name="AfD Vote %" 
                unit="%" 
                label={{ value: "AfD Second Votes %", angle: -90, position: 'insideLeft' }} 
                />
                <ZAxis type="number" dataKey="total_voters" range={[50, 400]} name="Voters" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                if (active && payload && payload.length) {
                    const d = payload[0].payload;
                    return (
                    <div className="rounded border border-[#ccc] bg-white p-2.5 shadow-[0_2px_5px_rgba(0,0,0,0.1)]">
                        <div className="mb-1 font-bold">{d.constituency_name} (WK {d.constituency_number})</div>
                        <div>Foreigners: {d.foreigner_pct.toFixed(1)}%</div>
                        <div>AfD Votes: {d.afd_percent.toFixed(1)}%</div>
                        <div className="mt-1 text-[0.85em] text-ink-muted">Voters: {d.total_voters.toLocaleString()}</div>
                    </div>
                    );
                }
                return null;
                }} />
                <Scatter name="Constituencies" data={data} fill="#009ee0" fillOpacity={0.5} />
            </ScatterChart>
            </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};
