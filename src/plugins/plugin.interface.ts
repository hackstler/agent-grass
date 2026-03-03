import type { Hono } from "hono";
import type { Agent, ToolsInput } from "@mastra/core/agent";

export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly agent: Agent;
  readonly tools: ToolsInput;
  routes?(): Hono;
  /**
   * Called once at startup before any seed/init logic.
   * Use to create plugin-owned tables with CREATE TABLE IF NOT EXISTS.
   */
  ensureTables?(): Promise<void>;
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}
