import React, { useEffect, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts';

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
    <div className="loading" style={{marginTop: '2rem'}}>
        <div className="spinner"></div>
        <div className="loading-text">Loading analysis data...</div>
    </div>
  );

  return (
    <div style={{ padding: '1rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div className="card">
        <div className="card-header">
           <div>
              <h2 className="card-title">Foreigner % vs. AfD Votes</h2>
              <div className="card-subtitle">
                 Each bubble represents a constituency. Bubble size represents total voters.
              </div>
           </div>
        </div>
      
        <div style={{ height: '600px', padding: '1rem' }}>
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
                    <div style={{ backgroundColor: 'white', padding: '10px', border: '1px solid #ccc', borderRadius: '4px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{d.constituency_name} (WK {d.constituency_number})</div>
                        <div>Foreigners: {d.foreigner_pct.toFixed(1)}%</div>
                        <div>AfD Votes: {d.afd_percent.toFixed(1)}%</div>
                        <div style={{ fontSize: '0.85em', color: '#666', marginTop: '4px' }}>Voters: {d.total_voters.toLocaleString()}</div>
                    </div>
                    );
                }
                return null;
                }} />
                <Scatter name="Constituencies" data={data} fill="#009ee0" fillOpacity={0.5} />
            </ScatterChart>
            </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
