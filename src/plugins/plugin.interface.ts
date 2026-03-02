import type { Hono } from "hono";
import type { Agent } from "@mastra/core/agent";

export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly agent: Agent;
  readonly tools: Record<string, unknown>;
  routes?(): Hono;
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}
