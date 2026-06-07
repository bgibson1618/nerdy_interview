import type { DateRange } from './types';

/**
 * Single source of truth for all tunable values (PRD R8).
 * Nothing here should be hard-coded elsewhere in the app.
 */
export const config = {
  /** Base URL of the Pulse Metrics API. */
  apiBaseUrl: 'https://api.pulse.example.com/v2',
  /** Auto-refresh cadence in milliseconds (PRD R4: 30 seconds). */
  pollIntervalMs: 60000,
  /** Initial active date range (PRD R5: last 7 days). */
  defaultDateRange: '7d' as DateRange,
  /** Metric cards shown per Overview page (PRD R2). */
  pageSize: 50,
} as const;

/**
 * Build-time feature flags (PRD R7).
 */
export const flags = {
  /** Adds a "Download CSV" action on the Metric Detail view. */
  enableExport: true,
  /** Adds a light/dark theme toggle in Settings. */
  enableDarkMode: true,
} as const;

