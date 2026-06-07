// Public library surface for ingestd.
export { Ingestor } from "./ingestor";
export { loadConfig, validateConfig, DEFAULT_CONFIG, ConfigError } from "./config";
export { createLogger } from "./logger";
export { EXIT_CODES, STATUSES } from "./types";
export type {
  Config,
  Status,
  LogLevel,
  ManifestRow,
  TaskResult,
  RunSummary,
  SinkHandler,
  ExitCode,
} from "./types";
