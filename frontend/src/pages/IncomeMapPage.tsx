import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IncomeConstituencyMap, IncomeData } from '../components/IncomeConstituencyMap';
import { Card, CardHeader, CardSubtitle, CardTitle } from '../components/ui/Card';

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
      <div className="mt-8 flex flex-col items-center justify-center px-8 py-16">
          <div className="h-[50px] w-[50px] animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-surface-accent border-t-brand-black"></div>
          <div className="mt-4 font-medium text-ink-muted">Loading income data...</div>
      </div>
  );
  
  if (error) return (
    <div className="rounded-lg border-2 border-[#d00] bg-[#fee] p-6 font-medium text-[#d00]">
      Error loading data: {String(error)}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <Card>
        <CardHeader>
            <div>
                <CardTitle>Income & Election Results Map</CardTitle>
                <CardSubtitle>
                   Map displays the winning party (color) and disposable income per capita (opacity).
                   <br/>
                   Darker colors indicate higher income.
                </CardSubtitle>
            </div>
        </CardHeader>
        <IncomeConstituencyMap
            year={year} 
            data={data?.data || []} 
            selectedConstituencyNumber={selectedConstituency}
            onSelectConstituency={setSelectedConstituency}
        />
      </Card>
    </div>
  );
}
