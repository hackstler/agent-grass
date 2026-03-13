import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CalendarApiService } from "../services/calendar-api.service.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface UpdateEventDeps {
  calendarService: CalendarApiService;
}

export function createUpdateEventTool({ calendarService }: UpdateEventDeps) {
  return createTool({
    id: "updateCalendarEvent",
    description:
      "Update an existing event in the user's Google Calendar. Only the provided fields will be modified.",

    inputSchema: z.object({
      eventId: z.string().describe("ID of the calendar event to update"),
      summary: z.string().optional().describe("New title for the event"),
      start: z.string().optional().describe("New start date/time in ISO 8601 format"),
      end: z.string().optional().describe("New end date/time in ISO 8601 format"),
      description: z.string().optional().describe("New description or notes"),
      location: z.string().optional().describe("New location"),
      attendees: z.array(z.string()).optional().describe("Updated list of attendee email addresses"),
      timeZone: z.string().optional().describe("IANA time zone (e.g. Europe/Madrid). Defaults to UTC."),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      eventId: z.string(),
    }),

    execute: async ({ eventId, summary, start, end, description, location, attendees, timeZone }, context) => {
      const userId = getAgentContextValue(context, "userId");
      if (!userId) throw new Error('Missing userId in request context');
      const updates: Record<string, unknown> = {};
      if (summary !== undefined) updates["summary"] = summary;
      if (start !== undefined) updates["start"] = start;
      if (end !== undefined) updates["end"] = end;
      if (description !== undefined) updates["description"] = description;
      if (location !== undefined) updates["location"] = location;
      if (attendees !== undefined) updates["attendees"] = attendees;
      if (timeZone !== undefined) updates["timeZone"] = timeZone;

      return calendarService.updateEvent(userId, eventId, updates as {
        summary?: string;
        start?: string;
        end?: string;
        description?: string;
        location?: string;
        attendees?: string[];
        timeZone?: string;
      });
    },
  });
}
