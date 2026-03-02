import type { ChunkingStrategy } from "../config/rag.config.js";

export interface Chunk {
  content: string;
  metadata: {
    chunkIndex: number;
    startChar: number;
    endChar: number;
    tokenCount: number;
    section?: string;
    pageNumber?: number;
  };
}

export interface ChunkerOptions {
  strategy: ChunkingStrategy;
  chunkSize: number;  // in tokens (approx)
  chunkOverlap: number;
}

// Rough token estimation: 1 token ≈ 4 chars for English
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function charsForTokens(tokens: number): number {
  return tokens * 4;
}

/**
 * Fixed-size chunking with overlap.
 * Best for: uniform documents, customer support, general use.
 */
function chunkFixed(text: string, options: ChunkerOptions): Chunk[] {
  const chunks: Chunk[] = [];
  const charSize = charsForTokens(options.chunkSize);
  const charOverlap = charsForTokens(options.chunkOverlap);
  const step = charSize - charOverlap;

  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(start + charSize, text.length);
    const content = text.slice(start, end).trim();

    if (content.length > 0) {
      chunks.push({
        content,
        metadata: {
          chunkIndex: index++,
          startChar: start,
          endChar: end,
          tokenCount: estimateTokens(content),
        },
      });
    }

    if (end === text.length) break;
    start += step;
  }

  return chunks;
}

/**
 * Semantic chunking: splits on paragraph/section boundaries.
 * Best for: knowledge bases, long-form documents.
 */
function chunkSemantic(text: string, options: ChunkerOptions): Chunk[] {
  const chunks: Chunk[] = [];
  const maxChars = charsForTokens(options.chunkSize);

  // Split on double newlines (paragraphs) or markdown headers
  const paragraphs = text.split(/\n{2,}|(?=#{1,6}\s)/);

  let current = "";
  let currentStart = 0;
  let charOffset = 0;
  let index = 0;

  for (const paragraph of paragraphs) {
    const pLength = paragraph.length + 2; // +2 for the newlines removed in split

    if (current.length + paragraph.length > maxChars && current.length > 0) {
      // Flush current chunk
      chunks.push({
        content: current.trim(),
        metadata: {
          chunkIndex: index++,
          startChar: currentStart,
          endChar: currentStart + current.length,
          tokenCount: estimateTokens(current),
        },
      });
      current = paragraph;
      currentStart = charOffset;
    } else {
      current += (current ? "\n\n" : "") + paragraph;
      if (current === paragraph) currentStart = charOffset;
    }

    charOffset += pLength;
  }

  // Flush last chunk
  if (current.trim()) {
    chunks.push({
      content: current.trim(),
      metadata: {
        chunkIndex: index++,
        startChar: currentStart,
        endChar: currentStart + current.length,
        tokenCount: estimateTokens(current),
      },
    });
  }

  return chunks;
}

/**
 * Hierarchical chunking: creates parent chunks + child chunks.
 * Best for: code assistants, structured documents with sections.
 * Stores large sections as metadata, returns smaller chunks for retrieval.
 */
function chunkHierarchical(text: string, options: ChunkerOptions): Chunk[] {
  // First pass: identify sections by markdown headers
  const sectionPattern = /^(#{1,3}\s.+)$/m;
  const parts = text.split(sectionPattern);

  const chunks: Chunk[] = [];
  let index = 0;
  let charOffset = 0;
  let currentSection = "Introduction";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (sectionPattern.test(part)) {
      currentSection = part.replace(/^#{1,3}\s/, "");
      charOffset += part.length + 1;
      continue;
    }

    // Apply fixed chunking within each section
    const sectionChunks = chunkFixed(part, { ...options, strategy: "fixed" });
    for (const chunk of sectionChunks) {
      chunks.push({
        content: chunk.content,
        metadata: {
          ...chunk.metadata,
          chunkIndex: index++,
          section: currentSection,
          startChar: charOffset + chunk.metadata.startChar,
          endChar: charOffset + chunk.metadata.endChar,
        },
      });
    }

    charOffset += part.length;
  }

  return chunks;
}

export function chunk(text: string, options: ChunkerOptions): Chunk[] {
  switch (options.strategy) {
    case "fixed":
      return chunkFixed(text, options);
    case "semantic":
      return chunkSemantic(text, options);
    case "hierarchical":
      return chunkHierarchical(text, options);
    default:
      return chunkFixed(text, options);
  }
}
