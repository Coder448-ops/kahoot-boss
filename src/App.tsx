import React, { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Skeleton } from './components/ui';

const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Connection = React.lazy(() => import('./pages/Connection'));
const Solver = React.lazy(() => import('./pages/Solver'));
const Automation = React.lazy(() => import('./pages/Automation'));
const History = React.lazy(() => import('./pages/History'));
const Statistics = React.lazy(() => import('./pages/Statistics'));
const Settings = React.lazy(() => import('./pages/Settings'));
const About = React.lazy(() => import('./pages/About'));

function Loading() {
  return (
    <div className="space-y-4" aria-label="Loading page">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/connect" element={<Connection />} />
          <Route path="/solver" element={<Solver />} />
          <Route path="/automation" element={<Automation />} />
          <Route path="/history" element={<History />} />
          <Route path="/stats" element={<Statistics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
