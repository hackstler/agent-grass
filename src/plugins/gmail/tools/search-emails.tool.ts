import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { GmailApiService } from "../services/gmail-api.service.js";

export interface SearchEmailsDeps {
  gmailService: GmailApiService;
}

export function createSearchEmailsTool({ gmailService }: SearchEmailsDeps) {
  return createTool({
    id: "searchEmails",
    description:
      "Search the user's Gmail using a Gmail search query (same syntax as the Gmail search bar). Requires the user's Google account to be connected.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe("Gmail search query (e.g. 'from:alice subject:meeting', 'has:attachment', 'newer_than:7d')"),
      maxResults: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum number of emails to return (default: 10)"),
    }),
    outputSchema: z.object({
      emails: z.array(
        z.object({
          id: z.string(),
          subject: z.string(),
          from: z.string(),
          date: z.string(),
          snippet: z.string(),
        }),
      ),
      totalResults: z.number(),
    }),
    execute: async ({ query, maxResults }, context) => {
      const userId = context?.requestContext?.get('userId') as string;
      if (!userId) throw new Error('Missing userId in request context');
      const result = await gmailService.searchEmails(userId, query, maxResults ?? 10);
      return {
        emails: result.map((e) => ({
          id: e.id,
          subject: e.subject,
          from: e.from,
          date: e.date,
          snippet: e.snippet,
        })),
        totalResults: result.length,
      };
    },
  });
}
