/**
 * Shared temporal context for agent system prompts.
 *
 * Injected dynamically on every LLM call so agents always know the current
 * date, time, day-of-week, and timezone. This enables correct resolution of
 * relative dates like "mañana", "el viernes", "la semana que viene".
 *
 * IMPORTANT: The timezone should ideally come from the user's org settings.
 * Currently defaults to "Europe/Madrid" (primary market). When multi-timezone
 * support is needed, pass the org's timezone from the request context.
 */

import { calendarConfig } from "../plugins/calendar/config/calendar.config.js";

export function getTemporalContext(timeZone: string = calendarConfig.defaultTimeZone): string {
  const now = new Date();

  const dateStr = now.toLocaleDateString("es-ES", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const timeStr = now.toLocaleTimeString("es-ES", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Build a timezone-aware ISO 8601 string (not UTC).
  // Intl.DateTimeFormat gives us the local date/time parts in the target timezone;
  // we reconstruct an ISO string with the correct offset.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const localIso = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;

  // Calculate UTC offset for the timezone
  const utcMs = now.getTime();
  const localMs = new Date(localIso + "Z").getTime();
  const offsetMin = Math.round((localMs - utcMs) / 60_000);
  // Flip sign: if local is ahead of UTC, offset string is positive
  const absOffset = Math.abs(offsetMin);
  const offsetSign = offsetMin <= 0 ? "+" : "-";
  const offsetStr = `${offsetSign}${String(Math.floor(absOffset / 60)).padStart(2, "0")}:${String(absOffset % 60).padStart(2, "0")}`;

  return `Fecha actual: ${dateStr}, ${timeStr}
Zona horaria: ${timeZone}
ISO 8601 (local): ${localIso}${offsetStr}`;
}
