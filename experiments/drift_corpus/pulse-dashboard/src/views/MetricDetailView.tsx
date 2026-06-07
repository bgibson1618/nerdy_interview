import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { getMetricSeries } from '../api/metrics';
import { usePolling } from '../hooks/usePolling';
import { LineChart } from '../components/LineChart';
import { ErrorState } from '../components/ErrorState';
import { config, flags } from '../config';
import type { DateRange, MetricPoint } from '../types';

/** Metric Detail route `/metrics/:metricId` (PRD R1, R3, R4, R5, R7). */
export function MetricDetailView(): ReactElement {
  const { metricId = '' } = useParams();
  const [range] = useState<DateRange>(config.defaultDateRange);

  const { data, error, loading, refetch } = usePolling<MetricPoint[]>(
    () => getMetricSeries(metricId, range),
    [metricId, range],
  );

  if (error) {
    return <ErrorState message={error.message} onRetry={refetch} />;
  }
  if (loading && !data) {
    return <div className="loading">Loading series…</div>;
  }

  const points = data ?? [];
  const values = points.map((p) => p.value);
  const latest = values.length ? values[values.length - 1] : 0;
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;

  function downloadCsv(): void {
    const rows = points.map((p) => `${p.timestamp},${p.value}`).join('\n');
    const blob = new Blob([`timestamp,value\n${rows}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${metricId}-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <h1>{metricId}</h1>
      <header className="detail-header">
        <span>Latest: {latest}</span>
        <span>Min: {min}</span>
        <span>Max: {max}</span>
      </header>
      <LineChart points={points} />
      {flags.enableExport && (
        <button className="detail-export" onClick={downloadCsv}>
          Download CSV
        </button>
      )}
    </section>
  );
}

