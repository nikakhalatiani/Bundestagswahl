import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import logo from './assets/Bundesarchiv-Logo.svg';
import { Dashboard } from './pages/Dashboard';
import { Members } from './pages/Members';
import { ConstituencyAnalysis } from './pages/ConstituencyAnalysis';
import { ForeignerAfdScatterPage } from './pages/ForeignerAfdScatterPage';
import { cn } from './utils/cn';
import { Select } from './components/ui/Select';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});


import { Stimmzettel } from './pages/Stimmzettel';

function Navigation({ year, setYear }: { year: number; setYear: (y: number) => void }) {
  const location = useLocation();

  return (
    <>
      <header className="sticky top-0 z-[100] shadow-md">
        <div className="ml-[6px] flex flex-wrap items-center justify-between bg-surface pr-8">
          <div className="flex items-center gap-4">
            <img src={logo} alt="Bundesarchiv Logo" className="h-[90px] w-auto" />
            <h1 className="text-2xl font-extrabold leading-tight text-ink">German Federal Election Explorer</h1>
          </div>
          <div className="flex items-center gap-2 px-4 py-3 text-[0.9rem] text-ink-muted">
            <label>Election year:</label>
            <Select
              className="font-semibold"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              <option value={2021}>2021</option>
              <option value={2025}>2025</option>
            </Select>
          </div>
        </div>
        <nav className="ml-[6px] border-b border-line bg-surface px-8">
          <ul className="flex list-none gap-2 overflow-x-auto">
            <li>
              <Link
                to="/"
                className={cn(
                  'block whitespace-nowrap border-b-[3px] border-transparent px-6 py-4 font-medium text-ink-muted transition hover:bg-surface-muted hover:text-ink',
                  location.pathname === '/' && 'border-brand-gold bg-surface-muted font-semibold text-ink'
                )}
              >
                Seat distribution
              </Link>
            </li>
            <li>
              <Link
                to="/members"
                className={cn(
                  'block whitespace-nowrap border-b-[3px] border-transparent px-6 py-4 font-medium text-ink-muted transition hover:bg-surface-muted hover:text-ink',
                  location.pathname === '/members' && 'border-brand-gold bg-surface-muted font-semibold text-ink'
                )}
              >
                Members
              </Link>
            </li>
            <li>
              <Link
                to="/analysis"
                className={cn(
                  'block whitespace-nowrap border-b-[3px] border-transparent px-6 py-4 font-medium text-ink-muted transition hover:bg-surface-muted hover:text-ink',
                  location.pathname === '/analysis' && 'border-brand-gold bg-surface-muted font-semibold text-ink'
                )}
              >
                Constituency analysis
              </Link>
            </li>
            <li>
              <Link
                to="/foreigner-afd"
                className={cn(
                  'block whitespace-nowrap border-b-[3px] border-transparent px-6 py-4 font-medium text-ink-muted transition hover:bg-surface-muted hover:text-ink',
                  location.pathname === '/foreigner-afd' && 'border-brand-gold bg-surface-muted font-semibold text-ink'
                )}
              >
                Correlation explorer
              </Link>
            </li>
            <li>
              <Link
                to="/ballot"
                className={cn(
                  'block whitespace-nowrap border-b-[3px] border-transparent px-6 py-4 font-medium text-ink-muted transition hover:bg-surface-muted hover:text-ink',
                  location.pathname === '/ballot' && 'border-brand-gold bg-surface-muted font-semibold text-ink'
                )}
              >
                Cast Vote
              </Link>
            </li>
          </ul>
        </nav>
      </header>
    </>
  );
}

function AppContent() {
  const [year, setYear] = useState(2025);

  return (
    <>
      <Navigation year={year} setYear={setYear} />
      <main className="mx-auto w-full max-w-[1400px] flex-1 p-4">
        <Routes>
          <Route path="/" element={<Dashboard year={year} />} />
          <Route path="/members" element={<Members year={year} />} />
          <Route path="/analysis" element={<ConstituencyAnalysis year={year} />} />
          <Route path="/foreigner-afd" element={<ForeignerAfdScatterPage year={year} />} />
          <Route path="/ballot" element={<Stimmzettel />} />
        </Routes>
      </main>
    </>
  );
}

export default function AppNew() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AppContent />
      </Router>
    </QueryClientProvider>
  );
}
