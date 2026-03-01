import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "../db/client.js";
import { topics } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

export interface EnrichmentResult {
  summary: string;
  keywords: string[];
  entities: string[];
  suggestedTopic: string;
  language: string;
}

/**
 * Enrich a document with LLM-extracted metadata before chunking.
 * Single Gemini Flash call per document using JSON mode.
 */
export async function enrichDocument(
  content: string,
  existingMetadata: Record<string, unknown>
): Promise<EnrichmentResult> {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) throw new Error("GOOGLE_API_KEY is required for enrichment");

  const google = new GoogleGenerativeAI(apiKey);
  const model = google.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  // Truncate content to avoid exceeding context window (keep first ~30k chars)
  const truncated = content.length > 30_000 ? content.slice(0, 30_000) + "\n[...truncated]" : content;

  const prompt = `Analyze the following document and return a JSON object with exactly these fields:

- "summary": A concise summary in 1-2 sentences (in the document's language)
- "keywords": An array of 5-10 relevant keywords (in the document's language)
- "entities": An array of named entities mentioned (people, companies, places, products)
- "suggestedTopic": A short, human-readable topic name that categorizes this document (e.g. "recetas saludables", "machine learning", "finanzas personales")
- "language": The ISO 639-1 language code of the document (e.g. "es", "en", "ko")

Title: ${existingMetadata["title"] ?? "Unknown"}

Document:
${truncated}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  try {
    const parsed = JSON.parse(text) as EnrichmentResult;
    return {
      summary: parsed.summary ?? "",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      suggestedTopic: parsed.suggestedTopic ?? "general",
      language: parsed.language ?? "es",
    };
  } catch {
    console.warn("[enricher] Failed to parse LLM response, using defaults");
    return {
      summary: "",
      keywords: [],
      entities: [],
      suggestedTopic: "general",
      language: "es",
    };
  }
}

/**
 * Resolve a suggested topic name to a topic ID.
 * Creates the topic if it doesn't exist.
 */
export async function resolveTopic(orgId: string, suggestedTopic: string): Promise<string> {
  const normalized = suggestedTopic.trim().toLowerCase();

  // Try to find existing topic
  const existing = await db.query.topics.findFirst({
    where: and(
      eq(topics.orgId, orgId),
      sql`lower(${topics.name}) = ${normalized}`
    ),
    columns: { id: true },
  });

  if (existing) return existing.id;

  // Create new topic
  const [created] = await db
    .insert(topics)
    .values({ orgId, name: suggestedTopic.trim() })
    .onConflictDoNothing()
    .returning({ id: topics.id });

  // If conflict (race condition), re-query
  if (!created) {
    const retry = await db.query.topics.findFirst({
      where: and(
        eq(topics.orgId, orgId),
        sql`lower(${topics.name}) = ${normalized}`
      ),
      columns: { id: true },
    });
    return retry!.id;
  }

  return created.id;
}
