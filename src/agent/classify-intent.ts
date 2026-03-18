import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";

/**
 * Lightweight intent classifier for the human-in-the-loop approval flow.
 *
 * Called by controllers BEFORE the agent pipeline starts, to decide whether
 * to confirm/deny pending actions or treat the message as a new intent.
 *
 * Uses gemini-2.0-flash (cheapest, fastest) — classifying "sí"/"no" doesn't
 * need the reasoning power of Pro. This is a single structured output call.
 *
 * Why a separate LLM call instead of the coordinator agent:
 * The ExecutionContext must be updated BEFORE the agent runs. The coordinator
 * is the agent — it can't classify first and then act, because needsApproval
 * is evaluated during its execution. The context needs to be ready before that.
 */

const google = createGoogleGenerativeAI({
  apiKey: (process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"])!,
});

const intentSchema = z.object({
  intent: z.enum(["confirm", "deny", "new_intent"]),
});

export async function classifyConfirmationIntent(
  userMessage: string,
  pendingActionDescriptions: string[],
): Promise<"confirm" | "deny" | "new_intent"> {
  try {
    const result = await generateObject({
      model: google("gemini-2.5-flash"),
      schema: intentSchema,
      prompt: `The user was asked to confirm the following action(s):
${pendingActionDescriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")}

The user responded: "${userMessage}"

Classify the user's intent:
- "confirm" if they are approving/accepting the action (e.g., "sí", "dale", "ok", "send it", "👍", "va", "venga")
- "deny" if they are rejecting/cancelling the action (e.g., "no", "cancel", "mejor no", "déjalo")
- "new_intent" if they are asking about something completely different, ignoring the pending action`,
    });

    return result.object.intent;
  } catch (error) {
    console.error("[classify-intent] LLM classification failed, defaulting to new_intent:", error);
    return "new_intent";
  }
}
