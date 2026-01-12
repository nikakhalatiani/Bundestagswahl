import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import logo from './assets/Bundesarchiv-Logo.svg';
import { Dashboard } from './pages/Dashboard';
import { Members } from './pages/Members';
import { ConstituencyAnalysis } from './pages/ConstituencyAnalysis';
import { IncomeMapPage } from './pages/IncomeMapPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function Navigation({ year, setYear }: { year: number; setYear: (y: number) => void }) {
  const location = useLocation();

  return (
    <>
      <header className="header">
        <div className="header-content">
          <div className="header-branding">
            <img src={logo} alt="Bundesarchiv Logo" className="header-logo" />
            <h1 className="header-title">German Federal Election Explorer</h1>
          </div>
          <div className="year-selector">
            <label>Election year:</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              <option value={2021}>2021</option>
              <option value={2025}>2025</option>
            </select>
          </div>
        </div>
        <nav className="nav">
          <ul className="nav-list">
            <li>
              <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
                Seat distribution
              </Link>
            </li>
            <li>
              <Link to="/members" className={`nav-link ${location.pathname === '/members' ? 'active' : ''}`}>
                Members
              </Link>
            </li>
            <li>
              <Link to="/analysis" className={`nav-link ${location.pathname === '/analysis' ? 'active' : ''}`}>
                Constituency analysis
              </Link>
            </li>
            <li>
              <Link to="/income" className={`nav-link ${location.pathname === '/income' ? 'active' : ''}`}>
                Income Analysis
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
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard year={year} />} />
          <Route path="/members" element={<Members year={year} />} />
          <Route path="/analysis" element={<ConstituencyAnalysis year={year} />} />
          <Route path="/income" element={<IncomeMapPage year={year} />} />
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
