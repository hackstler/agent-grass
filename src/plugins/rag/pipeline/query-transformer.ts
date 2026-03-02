import type { QueryEnhancement } from "../config/rag.config.js";

export interface QueryTransformResult {
  queries: string[];
  strategy: QueryEnhancement;
}

/**
 * Transform a user query into one or more enhanced queries for better retrieval.
 */
export async function transformQuery(
  originalQuery: string,
  strategy: QueryEnhancement,
  llmClient: { complete: (prompt: string) => Promise<string> },
  multiQueryCount = 3
): Promise<QueryTransformResult> {
  switch (strategy) {
    case "none":
      return { queries: [originalQuery], strategy: "none" };

    case "multi-query":
      return multiQuery(originalQuery, llmClient, multiQueryCount);

    case "hyde":
      return hyde(originalQuery, llmClient);

    case "step-back":
      return stepBack(originalQuery, llmClient);

    default:
      return { queries: [originalQuery], strategy: "none" };
  }
}

/**
 * Multi-query: generate N alternative phrasings of the query.
 * Improves recall when the user's phrasing differs from the document.
 */
async function multiQuery(
  query: string,
  llm: { complete: (prompt: string) => Promise<string> },
  count: number
): Promise<QueryTransformResult> {
  const prompt = `Generate ${count} different phrasings of this question to improve document retrieval.
Return only the rephrased questions, one per line, no numbering or extra text.

Original question: ${query}

Rephrased questions:`;

  const response = await llm.complete(prompt);
  const queries = [
    query,
    ...response
      .split("\n")
      .map((q) => q.trim())
      .filter((q) => q.length > 0)
      .slice(0, count),
  ];

  return { queries, strategy: "multi-query" };
}

/**
 * HyDE (Hypothetical Document Embeddings): generate a hypothetical answer
 * and embed that instead of (or alongside) the query.
 * Works well when the document vocabulary differs from the query vocabulary.
 */
async function hyde(
  query: string,
  llm: { complete: (prompt: string) => Promise<string> }
): Promise<QueryTransformResult> {
  const prompt = `Write a short, factual passage that would answer this question.
Write as if it were an excerpt from a document that contains the answer.
Keep it under 100 words, technical and precise.

Question: ${query}

Hypothetical passage:`;

  const hypotheticalAnswer = await llm.complete(prompt);

  return {
    queries: [query, hypotheticalAnswer.trim()],
    strategy: "hyde",
  };
}

/**
 * Step-back: abstract the query to a more general question.
 * Retrieves broader context that may contain the specific answer.
 */
async function stepBack(
  query: string,
  llm: { complete: (prompt: string) => Promise<string> }
): Promise<QueryTransformResult> {
  const prompt = `Given this specific question, what is a more general question that would provide useful background context?
Return only the general question, nothing else.

Specific question: ${query}

General question:`;

  const generalQuery = await llm.complete(prompt);

  return {
    queries: [query, generalQuery.trim()],
    strategy: "step-back",
  };
}
