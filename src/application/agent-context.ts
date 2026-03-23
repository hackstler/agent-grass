import type { AgentContext } from "../agent/types.js";
import type { AgentContextParams, AgentContextKey } from "../domain/entities/index.js";

/**
 * Builds an AgentContext object for passing to tools via experimental_context.
 */
export function createAgentContext(params: AgentContextParams): AgentContext {
  return {
    userId: params.userId,
    orgId: params.orgId,
    conversationId: params.conversationId,
  };
}

/**
 * Builds options for AgentRunner.generate() / stream().
 */
export function buildAgentOptions(params: AgentContextParams) {
  return {
    experimental_context: createAgentContext(params),
    maxSteps: 30,
    ...(params.onFinish && { onFinish: params.onFinish }),
  };
}

/**
 * Type-safe extraction of a value from tool execution context.
 */
export function getAgentContextValue(
  context: { experimental_context?: unknown } | undefined,
  key: AgentContextKey,
): string | undefined {
  if (!context?.experimental_context) return undefined;
  const ctx = context.experimental_context as Record<string, unknown>;
  return ctx[key] as string | undefined;
}
