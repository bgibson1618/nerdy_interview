/** A single metric shown in the Overview grid. */
export interface Metric {
  /** Stable identifier; used as the URL segment in /metrics/:metricId. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Unit of measure, e.g. "ms", "req/s", "%". */
  unit: string;
  /** Most recent sample value. */
  latestValue: number;
}

/** One sample in a metric's time series. */
export interface MetricPoint {
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
  /** Sample value at that timestamp. */
  value: number;
}

/** Supported date ranges for the time-series query (PRD R5). */
export type DateRange = '24h' | '7d' | '30d';

/** The authenticated user, returned by GET /me. */
export interface UserProfile {
  id: string;
  email: string;
}

