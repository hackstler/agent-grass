export const calendarConfig = {
  agentName: "CalendarAgent",
  maxResults: 20,
  defaultCalendarId: "primary",
  /** IANA timezone used when the user/org doesn't specify one. */
  defaultTimeZone: "Europe/Madrid",
  scopes: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
} as const;
