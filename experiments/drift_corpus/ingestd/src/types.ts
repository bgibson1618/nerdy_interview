// Shared types and constants for ingestd.

export type Status =
  | "pending"
  | "in_progress"
  | "done"
  | "failed"
  | "dead";

export const STATUSES: Status[] = [
  "pending",
  "in_progress",
  "done",
  "failed",
  "dead",
];

export type LogLevel = "debug" | "info" | "warn" | "error";

// Process exit codes (PRD R11 / ARCHITECTURE 4.9).
export const EXIT_CODES = {
  OK: 0,
  ERROR: 1,
  CONFIG: 2,
  INTERRUPTED: 3,
  DEAD_LETTER: 4,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export interface Config {
  sources: string[];
  pollIntervalMs: number;
  batchSize: number;
  flushIntervalMs: number;
  concurrency: number;
  maxRetries: number;
  backoffBaseMs: number;
  backoffFactor: number;
  backoffMaxMs: number;
  dedupWindowHours: number;
  retentionHours: number;
  deadLetterAbortThreshold: number;
  // Optional opaque token handed to the sink handler. Example configs use a
  // placeholder such as FAKE_DEMO_SECRET.
  sinkToken?: string;
}

export interface ManifestRow {
  id: number;
  path: string;
  content_hash: string | null;
  size_bytes: number;
  mtime_ms: number;
  status: Status;
  attempts: number;
  last_error: string | null;
  discovered_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface TaskResult {
  id: number;
  status: Status;
  attempts: number;
  lastError: string | null;
}

export interface RunSummary {
  scanned: number;
  enqueued: number;
  deduped: number;
  processed: number;
  failed: number;
  dead: number;
}

// The sink handler an integrator supplies. Receives the manifest row and the
// optional sink token; throwing triggers the retry policy (R4/R5).
export type SinkHandler = (
  row: ManifestRow,
  token: string | undefined,
) => Promise<void>;
