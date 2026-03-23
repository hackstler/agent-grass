import { tool } from "ai";
import { z } from "zod";
import type { CalendarApiService } from "../services/calendar-api.service.js";
import { getAgentContextValue } from "../../../application/agent-context.js";
import { calendarConfig } from "../config/calendar.config.js";

export interface UpdateEventDeps {
  calendarService: CalendarApiService;
}

const ISO_8601_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function createUpdateEventTool({ calendarService }: UpdateEventDeps) {
  return tool({
    description:
      "Update an existing event in the user's Google Calendar. Only the provided fields will be modified. " +
      "Dates MUST be absolute ISO 8601 datetimes — never relative.",

    inputSchema: z.object({
      eventId: z.string().min(1).describe("ID of the calendar event to update (obtained from listCalendarEvents)"),
      summary: z.string().optional().describe("New title for the event"),
      start: z
        .string()
        .regex(ISO_8601_DATETIME, "Must be ISO 8601 datetime")
        .optional()
        .describe("New start date/time in ISO 8601 format. Must be an absolute date."),
      end: z
        .string()
        .regex(ISO_8601_DATETIME, "Must be ISO 8601 datetime")
        .optional()
        .describe("New end date/time in ISO 8601 format. Must be an absolute date."),
      description: z.string().optional().describe("New description or notes"),
      location: z.string().optional().describe("New location"),
      attendees: z.array(z.string()).optional().describe("Updated list of attendee email addresses"),
      timeZone: z
        .string()
        .default(calendarConfig.defaultTimeZone)
        .describe(`IANA time zone. Defaults to ${calendarConfig.defaultTimeZone}.`),
    }),

    execute: async ({ eventId, summary, start, end, description, location, attendees, timeZone }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error("Missing userId in request context");

      return calendarService.updateEvent(userId, eventId, {
        ...(summary !== undefined ? { summary } : {}),
        ...(start !== undefined ? { start } : {}),
        ...(end !== undefined ? { end } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(attendees !== undefined ? { attendees } : {}),
        timeZone,
      });
    },
  });
}
