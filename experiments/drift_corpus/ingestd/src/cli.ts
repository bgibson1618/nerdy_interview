#!/usr/bin/env node
import { EXIT_CODES } from "./types";
import { ConfigError, loadConfig } from "./config";
import { createLogger } from "./logger";
import { Ingestor } from "./ingestor";

interface ParsedArgs {
  command: string;
  config: string;
  db: string;
  json: boolean;
  verbose: boolean;
  once: boolean;
  dead: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: "",
    config: "./ingestd.config.json",
    db: "./ingestd.sqlite",
    json: false,
    verbose: false,
    once: false,
    dead: false,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!args.command && !a.startsWith("-")) {
      args.command = a;
    } else if (a === "--config") {
      args.config = rest[++i];
    } else if (a === "--db") {
      args.db = rest[++i];
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--verbose") {
      args.verbose = true;
    } else if (a === "--once") {
      args.once = true;
    } else if (a === "--dead") {
      args.dead = true;
    }
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv);
  const log = createLogger({ json: args.json, verbose: args.verbose });

  let cfg;
  try {
    cfg = loadConfig(args.config);
  } catch (e) {
    if (e instanceof ConfigError) {
      log.error("config", e.message);
      return EXIT_CODES.CONFIG;
    }
    throw e;
  }

  const ingestor = new Ingestor(cfg, args.db, { logger: log });

  // Graceful shutdown (PRD R11): stop admitting work, finish in-flight, exit 3.
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
    ingestor.stop();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    switch (args.command) {
      case "run": {
        if (args.once) {
          const summary = await ingestor.runOnce();
          log.info("run", "runOnce complete", { ...summary });
        } else {
          const { summary, deadLetterAbort } = await ingestor.runForever();
          log.info("run", "runForever stopped", { ...summary });
          if (deadLetterAbort) return EXIT_CODES.DEAD_LETTER;
        }
        return interrupted ? EXIT_CODES.INTERRUPTED : EXIT_CODES.OK;
      }
      case "scan": {
        const summary = await ingestor.runOnce();
        log.info("scan", "scan complete", { scanned: summary.scanned, enqueued: summary.enqueued });
        return interrupted ? EXIT_CODES.INTERRUPTED : EXIT_CODES.OK;
      }
      case "status": {
        const counts = ingestor.statusCounts();
        log.info("status", "queue counts", counts);
        return EXIT_CODES.OK;
      }
      case "requeue": {
        if (!args.dead) {
          log.error("requeue", "requeue requires --dead");
          return EXIT_CODES.ERROR;
        }
        const n = ingestor.requeueDead();
        log.info("requeue", `requeued ${n} dead items`, { count: n });
        return EXIT_CODES.OK;
      }
      default: {
        log.error("cli", `unknown command: ${args.command || "(none)"}`);
        return EXIT_CODES.ERROR;
      }
    }
  } catch (e) {
    log.error("fatal", e instanceof Error ? e.message : String(e));
    return EXIT_CODES.ERROR;
  } finally {
    ingestor.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch(() => process.exit(EXIT_CODES.ERROR));
