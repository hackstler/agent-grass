import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { calendarConfig } from "./config/calendar.config.js";

export function createCalendarAgent(tools: ToolsInput): Agent {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for CalendarAgent");
  }

  const google = createGoogleGenerativeAI({ apiKey });

  return new Agent({
    id: calendarConfig.agentName,
    name: calendarConfig.agentName,
    description:
      "Manages Google Calendar: list, create, update, and delete events. Use when the user wants to interact with their calendar.",
    instructions: `You are a specialist in managing Google Calendar.
Use listCalendarEvents to show upcoming events, createCalendarEvent to schedule new events,
updateCalendarEvent to modify existing events, and deleteCalendarEvent to remove events.
Always confirm with the user before creating, updating, or deleting events.
If the user's Google account is not connected, inform them they need to connect it in Settings.
When creating events, make sure to ask for date, time, and duration if not provided.`,
    model: google("gemini-2.5-flash"),
    tools,
  });
}
