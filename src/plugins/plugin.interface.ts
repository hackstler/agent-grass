import type { Hono } from "hono";
import type { Agent, ToolsInput } from "@mastra/core/agent";

export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly agent: Agent;
  readonly tools: ToolsInput;
  routes?(): Hono;
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}
