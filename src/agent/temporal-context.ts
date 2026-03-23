/**
 * Shared temporal context for agent system prompts.
 *
 * Injected dynamically on every LLM call so agents always know the current
 * date, time, day-of-week, and timezone. This enables correct resolution of
 * relative dates like "mañana", "el viernes", "la semana que viene".
 */

const DEFAULT_TIMEZONE = "Europe/Madrid";

export function getTemporalContext(timeZone: string = DEFAULT_TIMEZONE): string {
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

  return `Fecha actual: ${dateStr}, ${timeStr}
Zona horaria: ${timeZone}
ISO 8601: ${now.toISOString()}`;
}
