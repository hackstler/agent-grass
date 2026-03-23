import type { OAuthTokenProvider } from "../../google-common/oauth-token-provider.js";
import { calendarConfig } from "../config/calendar.config.js";

const BASE_URL = "https://www.googleapis.com/calendar/v3";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiObject = Record<string, any>;

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  location: string;
  attendees: string[];
  htmlLink: string;
  status: string;
}

export interface CalendarCreateResult {
  success: boolean;
  eventId: string;
  htmlLink: string;
}

export interface CalendarUpdateResult {
  success: boolean;
  eventId: string;
}

export interface CalendarDeleteResult {
  success: boolean;
  deletedEventId: string;
}

export class CalendarApiService {
  private readonly tokenProvider: OAuthTokenProvider;

  constructor(tokenProvider: OAuthTokenProvider) {
    this.tokenProvider = tokenProvider;
  }

  private async getAuthHeaders(userId: string): Promise<Record<string, string>> {
    const token = await this.tokenProvider.getAccessToken(userId, [...calendarConfig.scopes]);
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async listEvents(
    userId: string,
    timeMin?: string,
    timeMax?: string,
    maxResults?: number,
  ): Promise<CalendarEvent[]> {
    const headers = await this.getAuthHeaders(userId);
    const calendarId = calendarConfig.defaultCalendarId;

    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: timeMin ?? new Date().toISOString(),
      maxResults: String(maxResults ?? calendarConfig.maxResults),
    });

    if (timeMax) {
      params.set("timeMax", timeMax);
    }

    const url = `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google Calendar API error (listEvents): ${response.status} — ${body}`);
    }

    const data = (await response.json()) as ApiObject;
    const items = (data["items"] as ApiObject[] | undefined) ?? [];

    return items.map((item) => ({
      id: String(item["id"] ?? ""),
      summary: String(item["summary"] ?? ""),
      description: String(item["description"] ?? ""),
      start: String(item["start"]?.["dateTime"] ?? item["start"]?.["date"] ?? ""),
      end: String(item["end"]?.["dateTime"] ?? item["end"]?.["date"] ?? ""),
      location: String(item["location"] ?? ""),
      attendees: ((item["attendees"] as ApiObject[] | undefined) ?? []).map(
        (a) => String(a["email"] ?? ""),
      ),
      htmlLink: String(item["htmlLink"] ?? ""),
      status: String(item["status"] ?? ""),
    }));
  }

  async createEvent(
    userId: string,
    data: {
      summary: string;
      start: string;
      end: string;
      description?: string | undefined;
      location?: string | undefined;
      attendees?: string[] | undefined;
      timeZone?: string | undefined;
    },
  ): Promise<CalendarCreateResult> {
    const headers = await this.getAuthHeaders(userId);
    const calendarId = calendarConfig.defaultCalendarId;
    const timeZone = data.timeZone ?? calendarConfig.defaultTimeZone;

    const body: Record<string, unknown> = {
      summary: data.summary,
      start: { dateTime: data.start, timeZone },
      end: { dateTime: data.end, timeZone },
    };

    if (data.description !== undefined) body["description"] = data.description;
    if (data.location !== undefined) body["location"] = data.location;
    if (data.attendees && data.attendees.length > 0) {
      body["attendees"] = data.attendees.map((email) => ({ email }));
    }

    const url = `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Calendar API error (createEvent): ${response.status} — ${text}`);
    }

    const result = (await response.json()) as ApiObject;
    return {
      success: true,
      eventId: String(result["id"] ?? ""),
      htmlLink: String(result["htmlLink"] ?? ""),
    };
  }

  async updateEvent(
    userId: string,
    eventId: string,
    data: {
      summary?: string | undefined;
      start?: string | undefined;
      end?: string | undefined;
      description?: string | undefined;
      location?: string | undefined;
      attendees?: string[] | undefined;
      timeZone?: string | undefined;
    },
  ): Promise<CalendarUpdateResult> {
    const headers = await this.getAuthHeaders(userId);
    const calendarId = calendarConfig.defaultCalendarId;
    const timeZone = data.timeZone ?? calendarConfig.defaultTimeZone;

    const body: Record<string, unknown> = {};

    if (data.summary !== undefined) body["summary"] = data.summary;
    if (data.description !== undefined) body["description"] = data.description;
    if (data.location !== undefined) body["location"] = data.location;
    if (data.start !== undefined) body["start"] = { dateTime: data.start, timeZone };
    if (data.end !== undefined) body["end"] = { dateTime: data.end, timeZone };
    if (data.attendees !== undefined) {
      body["attendees"] = data.attendees.map((email) => ({ email }));
    }

    const url = `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Calendar API error (updateEvent): ${response.status} — ${text}`);
    }

    const result = (await response.json()) as ApiObject;
    return {
      success: true,
      eventId: String(result["id"] ?? eventId),
    };
  }

  async deleteEvent(userId: string, eventId: string): Promise<CalendarDeleteResult> {
    const headers = await this.getAuthHeaders(userId);
    const calendarId = calendarConfig.defaultCalendarId;

    const url = `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers,
    });

    if (!response.ok && response.status !== 204) {
      const text = await response.text();
      throw new Error(`Google Calendar API error (deleteEvent): ${response.status} — ${text}`);
    }

    return {
      success: true,
      deletedEventId: eventId,
    };
  }
}
