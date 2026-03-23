import { tool } from "ai";
import { z } from "zod";
import type { CalendarApiService } from "../services/calendar-api.service.js";
import { getAgentContextValue } from "../../../application/agent-context.js";
import { calendarConfig } from "../config/calendar.config.js";

export interface CreateEventDeps {
  calendarService: CalendarApiService;
}

/**
 * Matches ISO 8601 datetime: YYYY-MM-DDTHH:MM:SS (with optional offset/Z).
 * Rejects non-ISO strings like "mañana a las 3" that the LLM might generate.
 */
const ISO_8601_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function createCreateEventTool({ calendarService }: CreateEventDeps) {
  return tool({
    description:
      "Create a new event in the user's Google Calendar. Requires the user's Google account to be connected. " +
      "IMPORTANT: 'start' and 'end' MUST be absolute ISO 8601 datetimes (e.g. 2026-03-24T15:00:00+01:00). " +
      "Never pass relative dates like 'mañana' — resolve them to absolute dates first using the temporal context.",

    inputSchema: z.object({
      summary: z.string().min(1).describe("Title of the event"),
      start: z
        .string()
        .regex(ISO_8601_DATETIME, "Must be ISO 8601 datetime (e.g. 2026-03-24T15:00:00+01:00). Resolve relative dates before calling.")
        .describe("Start date/time in ISO 8601 format. REQUIRED — must be an absolute date, not relative."),
      end: z
        .string()
        .regex(ISO_8601_DATETIME, "Must be ISO 8601 datetime (e.g. 2026-03-24T16:00:00+01:00). Resolve relative dates before calling.")
        .describe("End date/time in ISO 8601 format. REQUIRED — must be an absolute date, not relative."),
      description: z.string().optional().describe("Description or notes for the event"),
      location: z.string().optional().describe("Location of the event"),
      attendees: z.array(z.string()).optional().describe("List of attendee email addresses"),
      timeZone: z
        .string()
        .default(calendarConfig.defaultTimeZone)
        .describe(`IANA time zone (e.g. Europe/Madrid). Defaults to ${calendarConfig.defaultTimeZone}.`),
    }),

    execute: async ({ summary, start, end, description, location, attendees, timeZone }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error("Missing userId in request context");

      // Guardrail: reject events in the past
      const startDate = new Date(start);
      if (startDate.getTime() < Date.now() - 5 * 60_000) {
        return {
          success: false,
          error: "VALIDATION_FAILED",
          details: `Start time (${start}) is in the past. Current time is ${new Date().toISOString()}.`,
          suggestion: "Use the temporal context to calculate the correct future date and retry.",
          retryable: true,
        };
      }

      // Guardrail: end must be after start
      const endDate = new Date(end);
      if (endDate <= startDate) {
        return {
          success: false,
          error: "VALIDATION_FAILED",
          details: `End time (${end}) must be after start time (${start}).`,
          suggestion: "Set end to at least 30 minutes after start.",
          retryable: true,
        };
      }

      return calendarService.createEvent(userId, {
        summary,
        start,
        end,
        ...(description !== undefined ? { description } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(attendees !== undefined ? { attendees } : {}),
        timeZone,
      });
    },
  });
}
