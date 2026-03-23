import { generateText, streamText, stepCountIs } from "ai";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type { AgentContext, AgentGenerateResult, AgentStreamResult } from "./types.js";

export interface AgentRunnerConfig {
  model: LanguageModel;
  system: string | (() => string);
  tools: ToolSet;
  maxSteps?: number;
}

export interface GenerateOptions {
  prompt: string;
  messages?: ModelMessage[];
  experimental_context?: AgentContext;
  maxSteps?: number;
}

export interface StreamOptions {
  prompt: string;
  messages?: ModelMessage[];
  experimental_context?: AgentContext;
  maxSteps?: number;
  // Passthrough to AI SDK — shape determined by the SDK, not us
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onFinish?: (event: any) => void | Promise<void>;
}

/**
 * Minimal wrapper over Vercel AI SDK's generateText/streamText.
 * Maps AI SDK results to domain types (AgentGenerateResult).
 */
export class AgentRunner {
  private readonly config: Required<AgentRunnerConfig>;

  constructor(config: AgentRunnerConfig) {
    this.config = {
      ...config,
      maxSteps: config.maxSteps ?? 30,
    };
  }

  async generate(opts: GenerateOptions): Promise<AgentGenerateResult> {
    const { prompt, messages, experimental_context, maxSteps } = opts;

    const allMessages: ModelMessage[] = [
      ...(messages ?? []),
      { role: "user" as const, content: prompt },
    ];

    const system = typeof this.config.system === "function" ? this.config.system() : this.config.system;

    const result = await generateText({
      model: this.config.model,
      system,
      messages: allMessages,
      tools: this.config.tools,
      stopWhen: stepCountIs(maxSteps ?? this.config.maxSteps),
      ...(experimental_context ? { experimental_context } : {}),
    });

    // Map AI SDK result to our domain type — single point of adaptation
    return {
      text: result.text,
      steps: result.steps.map((step) => ({
        toolResults: (step.toolResults ?? []).map((tr) => ({
          toolName: tr.toolName,
          result: (tr as { output?: unknown }).output ?? (tr as { result?: unknown }).result,
        })),
      })),
    };
  }

  async stream(opts: StreamOptions): Promise<AgentStreamResult> {
    const { prompt, messages, experimental_context, maxSteps, onFinish } = opts;

    const allMessages: ModelMessage[] = [
      ...(messages ?? []),
      { role: "user" as const, content: prompt },
    ];

    const system = typeof this.config.system === "function" ? this.config.system() : this.config.system;

    return streamText({
      model: this.config.model,
      system,
      messages: allMessages,
      tools: this.config.tools,
      stopWhen: stepCountIs(maxSteps ?? this.config.maxSteps),
      ...(experimental_context ? { experimental_context } : {}),
      ...(onFinish ? { onFinish } : {}),
    });
  }
}
