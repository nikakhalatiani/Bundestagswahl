import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IncomeConstituencyMap, IncomeData } from '../components/IncomeConstituencyMap';

interface IncomeMapPageProps {
  year: number;
}

export function IncomeMapPage({ year }: IncomeMapPageProps) {
  const [selectedConstituency, setSelectedConstituency] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<{ data: IncomeData[] }>({
    queryKey: ['income-map', year],
    queryFn: async () => {
      const res = await fetch(`/api/disposable-income?year=${year}`);
      if (!res.ok) throw new Error('Failed to fetch income data');
      return res.json();
    }
  });

  if (isLoading) return (
      <div className="loading" style={{marginTop: '2rem'}}>
          <div className="spinner"></div>
          <div className="loading-text">Loading income data...</div>
      </div>
  );
  
  if (error) return <div className="error">Error loading data: {String(error)}</div>;

  return (
    <div style={{ padding: '1rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div className="card">
        <div className="card-header">
            <div>
                <h2 className="card-title">Income & Election Results Map</h2>
                <div className="card-subtitle">
                   Map displays the winning party (color) and disposable income per capita (opacity).
                   <br/>
                   Darker colors indicate higher income.
                </div>
            </div>
        </div>
        <IncomeConstituencyMap 
            year={year} 
            data={data?.data || []} 
            selectedConstituencyNumber={selectedConstituency}
            onSelectConstituency={setSelectedConstituency}
        />
      </div>
    </div>
  );
}
