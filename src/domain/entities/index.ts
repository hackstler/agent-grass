/**
 * Domain entities — pure TypeScript interfaces, zero infrastructure dependencies.
 *
 * These mirror the Drizzle-inferred types in infrastructure/db/schema.ts.
 * Because TypeScript uses structural typing, Drizzle rows are assignable
 * to these interfaces without explicit mapping.
 */

// ── User ────────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string | null;
  orgId: string;
  role: "admin" | "user";
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface NewUser {
  id?: string | undefined;
  email?: string | null | undefined;
  orgId: string;
  role?: "admin" | "user" | undefined;
  metadata?: Record<string, unknown> | null | undefined;
  createdAt?: Date | undefined;
}

// ── Conversation ────────────────────────────────────────────────────────────────

export interface ConversationConfig {
  memoryStrategy: "single-turn" | "fixed-window" | "summary";
  windowSize?: number;
  systemPrompt?: string;
}

export interface Conversation {
  id: string;
  userId: string | null;
  title: string | null;
  config: ConversationConfig | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewConversation {
  id?: string | undefined;
  userId?: string | null | undefined;
  title?: string | null | undefined;
  config?: ConversationConfig | null | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

// ── Message ─────────────────────────────────────────────────────────────────────

export interface MessageMetadata {
  tokens?: number;
  latencyMs?: number;
  costUsd?: number;
  retrievedChunks?: string[];
  model?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: MessageMetadata | null;
  createdAt: Date;
}

// ── Topic ───────────────────────────────────────────────────────────────────────

export interface Topic {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

export interface NewTopic {
  id?: string | undefined;
  orgId: string;
  name: string;
  description?: string | null | undefined;
  createdAt?: Date | undefined;
}

// ── Document ────────────────────────────────────────────────────────────────────

export type ContentType = "pdf" | "markdown" | "html" | "code" | "text" | "url" | "youtube";
export type DocumentStatus = "pending" | "processing" | "indexed" | "failed";

export interface DocumentMetadata {
  size?: number;
  pageCount?: number;
  author?: string;
  language?: string;
  tags?: string[];
  summary?: string;
  keywords?: string[];
  entities?: string[];
  detectedLanguage?: string;
  [key: string]: unknown;
}

export interface Document {
  id: string;
  orgId: string;
  topicId: string | null;
  title: string;
  source: string;
  contentType: ContentType;
  status: DocumentStatus;
  chunkCount: number | null;
  metadata: DocumentMetadata | null;
  createdAt: Date;
  indexedAt: Date | null;
}

export interface NewDocument {
  id?: string | undefined;
  orgId: string;
  topicId?: string | null | undefined;
  title: string;
  source: string;
  contentType: ContentType;
  status?: DocumentStatus | undefined;
  chunkCount?: number | null | undefined;
  metadata?: DocumentMetadata | null | undefined;
  createdAt?: Date | undefined;
  indexedAt?: Date | null | undefined;
}

// ── DocumentChunk ───────────────────────────────────────────────────────────────

export interface ChunkMetadata {
  chunkIndex: number;
  startChar?: number;
  endChar?: number;
  pageNumber?: number;
  section?: string;
  tokenCount?: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  contextPrefix: string | null;
  chunkMetadata: ChunkMetadata | null;
  createdAt: Date;
}

// ── WhatsApp Session ────────────────────────────────────────────────────────────

export interface WhatsappSession {
  id: string;
  orgId: string;
  userId: string;
  status: string;
  qrData: string | null;
  phone: string | null;
  updatedAt: Date;
}

export interface NewWhatsappSession {
  id?: string | undefined;
  orgId: string;
  userId: string;
  status?: string | undefined;
  qrData?: string | null | undefined;
  phone?: string | null | undefined;
  updatedAt?: Date | undefined;
}
