import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { Metric } from '../types';

/** One card in the Overview grid: name, latest value, unit (PRD R2). */
export function MetricCard({ metric }: { metric: Metric }): ReactElement {
  return (
    <Link to={`/metrics/${metric.id}`} className="metric-card">
      <div className="metric-card__name">{metric.name}</div>
      <div className="metric-card__value">
        {metric.latestValue}
        <span className="metric-card__unit"> {metric.unit}</span>
      </div>
    </Link>
  );
}

