import type { ToolSet } from "ai";

/**
 * Context passed to tools via `experimental_context`.
 */
export interface AgentContext {
  userId: string;
  orgId: string;
  conversationId: string;
}

/**
 * Tool map type — alias for AI SDK's ToolSet.
 */
export type AgentTools = ToolSet;

/** Individual tool execution result within a step. */
export interface AgentToolResult {
  toolName: string;
  result: unknown;
}

/** A single step in the agent's multi-step execution. */
export interface AgentStep {
  toolResults: AgentToolResult[];
}

/** Typed result of AgentRunner.generate(). */
export interface AgentGenerateResult {
  text: string;
  steps: AgentStep[];
}

/**
 * Typed result of a delegation tool call.
 * Shared contract between delegation.ts and all consumers
 * (chat.routes.ts, internal.controller.ts, extract-sources.ts).
 */
export interface DelegationResult {
  text: string;
  toolResults: AgentToolResult[];
}

/** Chunk from the agent stream — discriminated union on `type`. */
export interface AgentStreamChunk {
  readonly type: string;
  [key: string]: unknown;
}

/** Domain-level stream result — decoupled from AI SDK's internal Output generic. */
export interface AgentStreamResult {
  readonly fullStream: AsyncIterable<AgentStreamChunk>;
}

/**
 * A media attachment (image or document) to include alongside a text prompt.
 * Used for multimodal inputs — e.g., a WhatsApp photo of a receipt.
 */
export interface MediaAttachment {
  /** Raw binary content. */
  data: Uint8Array;
  /** MIME type, e.g. "image/jpeg", "application/pdf". */
  mimeType: string;
  /** Original filename (optional, for documents). */
  filename?: string;
}
