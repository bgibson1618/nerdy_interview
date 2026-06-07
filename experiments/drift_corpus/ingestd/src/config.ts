import * as fs from "fs";
import { Config } from "./types";

// Default configuration. This object is the single source of truth for the
// numeric defaults documented in PRD §5 / CONTEXT.md.
export const DEFAULT_CONFIG: Config = {
  sources: [],
  pollIntervalMs: 5000,
  batchSize: 128,
  flushIntervalMs: 2000,
  concurrency: 4,
  maxRetries: 5,
  backoffBaseMs: 500,
  backoffFactor: 2,
  backoffMaxMs: 30000,
  dedupWindowHours: 24,
  retentionHours: 168,
  deadLetterAbortThreshold: 100,
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function isPositiveInt(n: unknown): boolean {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

// Validate a fully-merged config. Throws ConfigError (CLI maps to exit 2).
export function validateConfig(c: Config): void {
  if (!Array.isArray(c.sources) || c.sources.length === 0) {
    throw new ConfigError("sources must be a non-empty array");
  }
  const intKeys: (keyof Config)[] = [
    "pollIntervalMs",
    "batchSize",
    "flushIntervalMs",
    "concurrency",
    "maxRetries",
    "backoffBaseMs",
    "backoffMaxMs",
    "dedupWindowHours",
    "retentionHours",
    "deadLetterAbortThreshold",
  ];
  for (const k of intKeys) {
    if (!isPositiveInt(c[k] as number)) {
      throw new ConfigError(`${k} must be a positive integer`);
    }
  }
  if (typeof c.backoffFactor !== "number" || c.backoffFactor <= 1) {
    throw new ConfigError("backoffFactor must be a number greater than 1");
  }
  if (c.flushIntervalMs < c.pollIntervalMs) {
    throw new ConfigError("flushIntervalMs must be <= pollIntervalMs");
  }
}

// Load config from disk, merge over DEFAULT_CONFIG, validate, and return it.
export function loadConfig(path: string): Config {
  let raw: Partial<Config> = {};
  if (fs.existsSync(path)) {
    let text: string;
    try {
      text = fs.readFileSync(path, "utf8");
    } catch (e) {
      throw new ConfigError(`cannot read config at ${path}: ${String(e)}`);
    }
    try {
      raw = JSON.parse(text) as Partial<Config>;
    } catch (e) {
      throw new ConfigError(`invalid JSON in config at ${path}: ${String(e)}`);
    }
  }
  const merged: Config = { ...DEFAULT_CONFIG, ...raw };
  validateConfig(merged);
  return merged;
}
