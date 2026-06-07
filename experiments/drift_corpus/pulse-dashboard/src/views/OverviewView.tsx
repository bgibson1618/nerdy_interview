import type { ReactElement } from 'react';
import { listMetrics } from '../api/metrics';
import { usePolling } from '../hooks/usePolling';
import { MetricGrid } from '../components/MetricGrid';
import { ErrorState } from '../components/ErrorState';
import type { Metric } from '../types';

/** Overview route `/` — paginated grid of all metrics (PRD R1, R2, R4). */
export function OverviewView(): ReactElement {
  const { data, error, loading, refetch } = usePolling<Metric[]>(listMetrics, []);

  if (error) {
    return <ErrorState message={error.message} onRetry={refetch} />;
  }
  if (loading && !data) {
    return <div className="loading">Loading metrics…</div>;
  }

  return (
    <section>
      <h1>Overview</h1>
      <MetricGrid metrics={data ?? []} />
    </section>
  );
}

