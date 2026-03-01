import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Chunk } from "../rag/chunker.js";

export interface ContextualizedChunk extends Chunk {
  contextPrefix: string;
}

/**
 * Generate contextual prefixes for each chunk using the Anthropic Contextual Retrieval pattern.
 * The full document is sent once, and each chunk gets a brief prefix (1-2 sentences)
 * that situates it within the document.
 */
export async function contextualizeChunks(
  fullDocument: string,
  chunks: Chunk[]
): Promise<ContextualizedChunk[]> {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) throw new Error("GOOGLE_API_KEY is required for contextualization");

  const google = new GoogleGenerativeAI(apiKey);
  const model = google.getGenerativeModel({ model: "gemini-2.0-flash" });

  // Truncate document to fit in context window
  const truncatedDoc =
    fullDocument.length > 60_000
      ? fullDocument.slice(0, 60_000) + "\n[...truncated]"
      : fullDocument;

  const BATCH_SIZE = 5;
  const results: ContextualizedChunk[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    const prefixes = await Promise.all(
      batch.map(async (chunk) => {
        try {
          const prompt = `<document>
${truncatedDoc}
</document>

<chunk>
${chunk.content}
</chunk>

Da un contexto breve (1-2 frases) para situar este fragmento dentro del documento.
Responde SOLO con el contexto, sin prefijos ni explicaciones.`;

          const result = await model.generateContent(prompt);
          return result.response.text().trim();
        } catch (err) {
          console.warn(`[contextualizer] Failed for chunk ${chunk.metadata.chunkIndex}: ${err instanceof Error ? err.message : String(err)}`);
          return "";
        }
      })
    );

    for (let j = 0; j < batch.length; j++) {
      results.push({
        ...batch[j]!,
        contextPrefix: prefixes[j] ?? "",
      });
    }
  }

  return results;
}
