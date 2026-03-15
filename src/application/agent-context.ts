import { RequestContext } from "@mastra/core/request-context";
import type { AgentContextParams, AgentContextKey } from "../domain/entities/index.js";

/**
 * Creates a Mastra RequestContext from typed params.
 * Single source of truth for context construction — eliminates ad-hoc
 * `new RequestContext([...])` scattered across controllers and routes.
 */
export function createAgentContext(params: AgentContextParams): RequestContext {
  const entries: [string, string][] = [
    ["userId", params.userId],
    ["orgId", params.orgId],
    ["conversationId", params.conversationId],
  ];

  if (params.pdfRequestId) {
    entries.push(["pdfRequestId", params.pdfRequestId]);
  }

  return new RequestContext(entries);
}

/**
 * Builds the full options object for `agent.generate()` / `agent.stream()`.
 * Encapsulates the coupling between RequestContext keys and Mastra memory params.
 *
 * Supports Mastra hooks (onFinish, onStepFinish, delegation) when provided
 * in params — the route handler passes them in, buildAgentOptions passes them through.
 */
export function buildAgentOptions(params: AgentContextParams) {
  return {
    requestContext: createAgentContext(params),
    memory: { thread: params.conversationId, resource: params.userId },
    maxSteps: 30,
    // Mastra hooks — only included if provided by the caller
    ...(params.onFinish && { onFinish: params.onFinish }),
    ...(params.onStepFinish && { onStepFinish: params.onStepFinish }),
    ...(params.delegation && { delegation: params.delegation }),
  };
}

/**
 * Type-safe extraction of a value from Mastra's tool execution context.
 * Replaces fragile `context?.requestContext?.get("key") as string` casts.
 */
export function getAgentContextValue(
  context: { requestContext?: { get(key: string): unknown } } | undefined,
  key: AgentContextKey,
): string | undefined {
  return context?.requestContext?.get(key) as string | undefined;
}
