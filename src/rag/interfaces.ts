import type { DocumentChunk } from "../db/schema.js";

// ============================================================
// Shared domain types
// ============================================================

export interface RetrievedChunk {
  id: string;
  content: string;
  score: number;
  documentId: string;
  documentTitle: string;
  documentSource: string;
  metadata: DocumentChunk["chunkMetadata"];
}

export interface RetrieverOptions {
  topK: number;
  similarityThreshold: number;
  orgId?: string;
  documentIds?: string[];
  topicId?: string;
}

export interface RerankerOptions {
  topK: number;
  provider: "cohere" | "local";
}

// ============================================================
// Interfaces (contracts — swap providers without touching tools)
// ============================================================

export interface IEmbedder {
  embed(text: string): Promise<number[]>;
}

export interface IRetriever {
  retrieve(queryEmbedding: number[], options: RetrieverOptions): Promise<RetrievedChunk[]>;
  retrieveMultiQuery(queryEmbeddings: number[][], options: RetrieverOptions): Promise<RetrievedChunk[]>;
  retrieveHybrid(queryEmbedding: number[], queryText: string, options: RetrieverOptions): Promise<RetrievedChunk[]>;
}

export interface IReranker {
  rerank(query: string, chunks: RetrievedChunk[], options: RerankerOptions): Promise<RetrievedChunk[]>;
}

export interface RetrievalPipelineOptions {
  topK?: number;
  orgId?: string;
  documentIds?: string[];
  topicId?: string;
  queryText?: string;
}

export interface RetrievalPipelineResult {
  chunks: RetrievedChunk[];
  chunkCount: number;
  expanded: boolean;
}
