import type { ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { OverviewView } from './views/OverviewView';
import { MetricDetailView } from './views/MetricDetailView';
import { SettingsView } from './views/SettingsView';

/**
 * App shell and routing (PRD R1). Exactly three data routes, each wrapped by
 * RequireAuth (PRD R6).
 */
export function App(): ReactElement {
  return (
    <BrowserRouter>
      <nav className="app-nav">
        <Link to="/">Overview</Link>
        <Link to="/preferences">Settings</Link>
      </nav>
      <main className="app-main">
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <OverviewView />
              </RequireAuth>
            }
          />
          <Route
            path="/metrics/:metricId"
            element={
              <RequireAuth>
                <MetricDetailView />
              </RequireAuth>
            }
          />
          <Route
            path="/preferences"
            element={
              <RequireAuth>
                <SettingsView />
              </RequireAuth>
            }
          />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

