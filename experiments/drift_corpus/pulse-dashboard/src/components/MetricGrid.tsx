import { useState, type ReactElement } from 'react';
import type { Metric } from '../types';
import { config } from '../config';
import { MetricCard } from './MetricCard';

/**
 * Paginated grid of metric cards. Pages at config.pageSize (25) cards per page
 * (PRD R2).
 */
export function MetricGrid({ metrics }: { metrics: Metric[] }): ReactElement {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(metrics.length / config.pageSize));
  const start = page * config.pageSize;
  const visible = metrics.slice(start, start + config.pageSize);

  return (
    <div>
      <div className="metric-grid">
        {visible.map((m) => (
          <MetricCard key={m.id} metric={m} />
        ))}
      </div>
      <div className="metric-grid__pager">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Prev
        </button>
        <span>
          Page {page + 1} of {pageCount}
        </span>
        <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

