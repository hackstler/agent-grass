import { tool } from "ai";
import { z } from "zod";
import type { CalendarApiService, CalendarEvent } from "../services/calendar-api.service.js";
import { getAgentContextValue } from "../../../application/agent-context.js";
import { calendarConfig } from "../config/calendar.config.js";
import { logger } from "../../../shared/logger.js";

export interface CreateEventDeps {
  calendarService: CalendarApiService;
}

/**
 * Matches ISO 8601 datetime: YYYY-MM-DDTHH:MM:SS (with optional offset/Z).
 * Rejects non-ISO strings like "mañana a las 3" that the LLM might generate.
 */
const ISO_8601_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Check if two time ranges overlap. */
function hasOverlap(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && startB < endA;
}

/** Find free slots around the requested time on the same day. */
function findSuggestedSlots(
  requestedStart: Date,
  durationMs: number,
  events: CalendarEvent[],
  maxSlots = 3,
): string[] {
  // Build a list of busy ranges for the day (sorted)
  const dayStart = new Date(requestedStart);
  dayStart.setHours(8, 0, 0, 0);
  const dayEnd = new Date(requestedStart);
  dayEnd.setHours(21, 0, 0, 0);

  const busy = events
    .map((e) => ({ start: new Date(e.start), end: new Date(e.end) }))
    .filter((b) => b.start < dayEnd && b.end > dayStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots: string[] = [];
  let cursor = dayStart;

  for (const block of busy) {
    const gapEnd = block.start;
    if (gapEnd.getTime() - cursor.getTime() >= durationMs && cursor >= dayStart) {
      // There's a free slot before this busy block
      const slotStart = new Date(Math.max(cursor.getTime(), dayStart.getTime()));
      const slotEnd = new Date(slotStart.getTime() + durationMs);
      if (slotEnd <= dayEnd) {
        const hStart = slotStart.toTimeString().slice(0, 5);
        const hEnd = slotEnd.toTimeString().slice(0, 5);
        slots.push(`${hStart}-${hEnd}`);
      }
    }
    cursor = new Date(Math.max(cursor.getTime(), block.end.getTime()));
    if (slots.length >= maxSlots) break;
  }

  // Check gap after last busy block
  if (slots.length < maxSlots && dayEnd.getTime() - cursor.getTime() >= durationMs) {
    const slotEnd = new Date(cursor.getTime() + durationMs);
    if (slotEnd <= dayEnd) {
      const hStart = cursor.toTimeString().slice(0, 5);
      const hEnd = slotEnd.toTimeString().slice(0, 5);
      slots.push(`${hStart}-${hEnd}`);
    }
  }

  return slots;
}

export function createCreateEventTool({ calendarService }: CreateEventDeps) {
  return tool({
    description:
      "Create a new event in the user's Google Calendar. Requires the user's Google account to be connected. " +
      "IMPORTANT: 'start' and 'end' MUST be absolute ISO 8601 datetimes (e.g. 2026-03-24T15:00:00+01:00). " +
      "Never pass relative dates like 'mañana' — resolve them to absolute dates first using the temporal context. " +
      "This tool automatically checks for conflicts — if there is an overlapping event, the event will NOT be " +
      "created and a conflict response with suggested alternative slots will be returned instead.",

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

      // ── Deterministic conflict check ──
      // Fetch events for the target day to detect overlaps BEFORE creating.
      try {
        const dayStart = new Date(startDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(startDate);
        dayEnd.setHours(23, 59, 59, 999);

        const existingEvents = await calendarService.listEvents(
          userId,
          dayStart.toISOString(),
          dayEnd.toISOString(),
          50,
        );

        const conflicts = existingEvents.filter((ev) =>
          hasOverlap(startDate, endDate, new Date(ev.start), new Date(ev.end)),
        );

        if (conflicts.length > 0) {
          const durationMs = endDate.getTime() - startDate.getTime();
          const suggestedSlots = findSuggestedSlots(startDate, durationMs, existingEvents);

          const conflictDetails = conflicts.map((c) => ({
            summary: c.summary,
            start: c.start,
            end: c.end,
          }));

          logger.info(
            { userId, requestedStart: start, conflicts: conflictDetails.length },
            "[Calendar] Conflict detected — event NOT created",
          );

          return {
            success: false,
            conflict: true,
            message:
              `No se ha creado el evento porque hay un conflicto de horario. ` +
              `Ya tienes "${conflicts[0]!.summary}" de ${formatTime(conflicts[0]!.start)} a ${formatTime(conflicts[0]!.end)}.`,
            conflictingEvents: conflictDetails,
            suggestedSlots,
            suggestion:
              suggestedSlots.length > 0
                ? `Huecos libres ese día: ${suggestedSlots.join(", ")}. Pregunta al usuario qué hora prefiere.`
                : "No hay huecos libres evidentes en horario laboral (8:00-21:00). Pregunta al usuario si quiere otro día.",
            retryable: true,
          };
        }
      } catch (err) {
        // If conflict check fails (e.g. auth issue), log but proceed with creation
        // — better to create with a potential overlap than to block entirely.
        logger.warn({ err, userId }, "[Calendar] Conflict check failed — proceeding with creation");
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

/** Extract HH:MM from an ISO datetime string. */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toTimeString().slice(0, 5);
  } catch {
    return iso;
  }
}
