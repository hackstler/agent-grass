import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CalendarApiService } from "../services/calendar-api.service.js";

export interface CreateEventDeps {
  calendarService: CalendarApiService;
}

export function createCreateEventTool({ calendarService }: CreateEventDeps) {
  return createTool({
    id: "createCalendarEvent",
    description:
      "Create a new event in the user's Google Calendar. Requires the user's Google account to be connected.",

    inputSchema: z.object({
      summary: z.string().describe("Title of the event"),
      start: z.string().describe("Start date/time in ISO 8601 format (e.g. 2025-03-15T10:00:00+01:00)"),
      end: z.string().describe("End date/time in ISO 8601 format (e.g. 2025-03-15T11:00:00+01:00)"),
      description: z.string().optional().describe("Description or notes for the event"),
      location: z.string().optional().describe("Location of the event"),
      attendees: z.array(z.string()).optional().describe("List of attendee email addresses"),
      timeZone: z.string().optional().describe("IANA time zone (e.g. Europe/Madrid). Defaults to UTC."),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      eventId: z.string(),
      htmlLink: z.string(),
    }),

    execute: async ({ summary, start, end, description, location, attendees, timeZone }, context) => {
      const userId = context?.requestContext?.get('userId') as string;
      if (!userId) throw new Error('Missing userId in request context');
      return calendarService.createEvent(userId, {
        summary,
        start,
        end,
        ...(description !== undefined ? { description } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(attendees !== undefined ? { attendees } : {}),
        ...(timeZone !== undefined ? { timeZone } : {}),
      });
    },
  });
}
