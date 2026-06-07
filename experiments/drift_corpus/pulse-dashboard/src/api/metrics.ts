import type { DateRange, Metric, MetricPoint, UserProfile } from '../types';
import { apiGet } from './client';

/** GET /metrics — list all metrics for the Overview grid (PRD R2). */
export function listMetrics(): Promise<Metric[]> {
  return apiGet<Metric[]>('/metrics');
}

/** GET /metrics/:id — one metric, for the Detail header (PRD R3). */
export function getMetric(id: string): Promise<Metric> {
  return apiGet<Metric>(`/metrics/${encodeURIComponent(id)}`);
}

/** GET /metrics/:id/series?range= — time series for the chart (PRD R3, R5). */
export function getMetricSeries(id: string, range: DateRange): Promise<MetricPoint[]> {
  return apiGet<MetricPoint[]>(
    `/metrics/${encodeURIComponent(id)}/series?range=${range}`,
  );
}

/** GET /me — confirms the current session is valid (PRD R6). */
export function getProfile(): Promise<UserProfile> {
  return apiGet<UserProfile>('/profile');
}

