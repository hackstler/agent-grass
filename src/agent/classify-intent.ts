import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { ragConfig } from "../plugins/rag/config/rag.config.js";

const google = createGoogleGenerativeAI({
  apiKey: (process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"])!,
});

const intentSchema = z.object({
  intent: z.enum(["confirm", "deny", "new_intent"]),
});

/**
 * Uses the LLM to classify whether a user message is confirming a pending action,
 * denying it, or starting a completely new topic.
 *
 * Language-agnostic: works in Spanish, English, Catalan, emoji, slang, etc.
 * The LLM interprets the intent, not a regex.
 */
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
