import { createEmbedding } from "./embeddings.js";
import { retrieve, retrieveMultiQuery, retrieveHybrid } from "./retriever.js";
import { rerank } from "./reranker.js";
import type { IEmbedder, IRetriever, IReranker } from "./interfaces.js";

/**
 * Singleton adapters that bridge the existing RAG functions into the
 * IEmbedder / IRetriever / IReranker interfaces.
 *
 * Inject these into createToolRegistry() and createRagRetrievalWorkflow()
 * instead of importing the functions directly.
 */

export const defaultEmbedder: IEmbedder = {
  embed: createEmbedding,
};

export const pgvectorRetriever: IRetriever = {
  retrieve,
  retrieveMultiQuery,
  retrieveHybrid,
};

export const defaultReranker: IReranker = {
  rerank,
};
