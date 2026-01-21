import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import logo from './assets/Bundesarchiv-Logo.svg';
import { Dashboard } from './pages/Dashboard';
import { Members } from './pages/Members';
import { ConstituencyAnalysis } from './pages/ConstituencyAnalysis';
import { IncomeMapPage } from './pages/IncomeMapPage';
import { ForeignerAfdScatterPage } from './pages/ForeignerAfdScatterPage';
import { PartyStrengthPage } from './pages/PartyStrengthPage';
import { cn } from './utils/cn';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

const selectBaseClass = `appearance-none rounded-md border border-line bg-surface-muted px-3 py-2 pr-8 text-[0.9rem] font-semibold text-ink transition hover:border-ink-faint hover:bg-surface-accent focus:border-brand-black focus:outline-none focus:ring-2 focus:ring-black/5 bg-[url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e")] bg-no-repeat bg-[right_0.5rem_center] bg-[length:0.9em]`;

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
            <select
              className={selectBaseClass}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              <option value={2021}>2021</option>
              <option value={2025}>2025</option>
            </select>
          </div>
        </div>
        <nav className="ml-[6px] border-b border-line bg-surface px-8">
          <ul className="flex list-none gap-2 overflow-x-auto">
            <li>
              <Link
                to="/"
                className={cn(
                  'block whitespace-nowrap border-b-[3px] border-transparent px-6 py-4 font-medium text-ink-muted transition hover:bg-surface-muted hover:text-ink',
                  location.pathname === '/' && 'border-brand-gold font-semibold text-brand-black'
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
                  location.pathname === '/members' && 'border-brand-gold font-semibold text-brand-black'
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
                  location.pathname === '/analysis' && 'border-brand-gold font-semibold text-brand-black'
                )}
              >
                Constituency analysis
              </Link>
            </li>
            <li>
              <Link
                to="/party-strength"
                className={cn(
                  'block whitespace-nowrap border-b-[3px] border-transparent px-6 py-4 font-medium text-ink-muted transition hover:bg-surface-muted hover:text-ink',
                  location.pathname === '/party-strength' && 'border-brand-gold font-semibold text-brand-black'
                )}
              >
                Party strongholds
              </Link>
            </li>
            {year === 2025 && (
              <>
                <li>
                  <Link
                    to="/income"
                    className={cn(
                      'block whitespace-nowrap border-b-[3px] border-transparent px-6 py-4 font-medium text-ink-muted transition hover:bg-surface-muted hover:text-ink',
                      location.pathname === '/income' && 'border-brand-gold font-semibold text-brand-black'
                    )}
                  >
                    Income Analysis
                  </Link>
                </li>
                <li>
                  <Link
                    to="/foreigner-afd"
                    className={cn(
                      'block whitespace-nowrap border-b-[3px] border-transparent px-6 py-4 font-medium text-ink-muted transition hover:bg-surface-muted hover:text-ink',
                      location.pathname === '/foreigner-afd' && 'border-brand-gold font-semibold text-brand-black'
                    )}
                  >
                    Foreigner/AfD Analysis
                  </Link>
                </li>
              </>
            )}
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
          <Route path="/party-strength" element={<PartyStrengthPage year={year} />} />
          <Route path="/income" element={<IncomeMapPage year={year} />} />
          <Route path="/foreigner-afd" element={<ForeignerAfdScatterPage />} />
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
