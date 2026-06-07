import type { ReactElement } from 'react';
import type { MetricPoint } from '../types';

const WIDTH = 640;
const HEIGHT = 240;

/** Minimal SVG line chart for a metric time series (PRD R3). */
export function LineChart({ points }: { points: MetricPoint[] }): ReactElement {
  if (points.length === 0) {
    return <div className="line-chart line-chart--empty">No data for this range.</div>;
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const path = points
    .map((p, i) => {
      const x = (i / Math.max(1, points.length - 1)) * WIDTH;
      const y = HEIGHT - ((p.value - min) / span) * HEIGHT;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="line-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

