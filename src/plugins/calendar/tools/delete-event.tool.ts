import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CalendarApiService } from "../services/calendar-api.service.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface DeleteEventDeps {
  calendarService: CalendarApiService;
}

export function createDeleteEventTool({ calendarService }: DeleteEventDeps) {
  return createTool({
    id: "deleteCalendarEvent",
    description:
      "Delete an event from the user's Google Calendar. This action is irreversible.",

    inputSchema: z.object({
      eventId: z.string().describe("ID of the calendar event to delete"),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      deletedEventId: z.string(),
    }),

    execute: async ({ eventId }, context) => {
      const userId = getAgentContextValue(context, "userId");
      if (!userId) throw new Error('Missing userId in request context');
      const result = await calendarService.deleteEvent(userId, eventId);
      return result;
    },
  });
}
