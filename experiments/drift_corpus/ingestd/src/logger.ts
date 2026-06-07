import { LogLevel } from "./types";

export interface Logger {
  debug(event: string, msg: string, fields?: Record<string, unknown>): void;
  info(event: string, msg: string, fields?: Record<string, unknown>): void;
  warn(event: string, msg: string, fields?: Record<string, unknown>): void;
  error(event: string, msg: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  json: boolean;
  verbose: boolean;
}

// Structured logger (PRD R12 / ARCHITECTURE 4.10). With json=true every line is
// a single NDJSON object carrying ts/level/event/msg plus extra fields. Text
// mode is human-readable. debug() is suppressed unless verbose=true.
export function createLogger(opts: LoggerOptions): Logger {
  function emit(
    level: LogLevel,
    event: string,
    msg: string,
    fields?: Record<string, unknown>,
  ): void {
    if (level === "debug" && !opts.verbose) return;
    const ts = new Date().toISOString();
    if (opts.json) {
      const record = { ts, level, event, msg, ...(fields ?? {}) };
      const line = JSON.stringify(record);
      if (level === "error" || level === "warn") process.stderr.write(line + "\n");
      else process.stdout.write(line + "\n");
      return;
    }
    const extra = fields && Object.keys(fields).length
      ? " " + JSON.stringify(fields)
      : "";
    const line = `${ts} ${level.toUpperCase()} [${event}] ${msg}${extra}`;
    if (level === "error" || level === "warn") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  }

  return {
    debug: (e, m, f) => emit("debug", e, m, f),
    info: (e, m, f) => emit("info", e, m, f),
    warn: (e, m, f) => emit("warn", e, m, f),
    error: (e, m, f) => emit("error", e, m, f),
  };
}
