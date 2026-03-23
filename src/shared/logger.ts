import pino from "pino";

const isDev = process.env["NODE_ENV"] === "development";

function createLogger() {
  const level = process.env["LOG_LEVEL"] ?? "info";

  if (isDev) {
    try {
      return pino({
        level,
        transport: { target: "pino-pretty", options: { colorize: true } },
      });
    } catch {
      // pino-pretty not installed — fall through to JSON logger
    }
  }

  return pino({ level });
}

export const logger = createLogger();

export type { Logger } from "pino";
