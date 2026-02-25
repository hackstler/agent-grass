import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  pgEnum,
  vector,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================
// Enums
// ============================================================

export const conversationRoleEnum = pgEnum("conversation_role", [
  "user",
  "assistant",
  "system",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "pending",
  "processing",
  "indexed",
  "failed",
]);

export const contentTypeEnum = pgEnum("content_type", [
  "pdf",
  "markdown",
  "html",
  "code",
  "text",
  "url",
  "youtube",
]);

// ============================================================
// Tables
// ============================================================

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  orgId: text("org_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  config: jsonb("config").$type<{
    memoryStrategy: "single-turn" | "fixed-window" | "summary";
    windowSize?: number;
    systemPrompt?: string;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: conversationRoleEnum("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<{
    tokens?: number;
    latencyMs?: number;
    costUsd?: number;
    retrievedChunks?: string[];
    model?: string;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id"),
  title: text("title").notNull(),
  source: text("source").notNull(), // file path, URL, etc.
  contentType: contentTypeEnum("content_type").notNull(),
  status: documentStatusEnum("status").notNull().default("pending"),
  chunkCount: integer("chunk_count").default(0),
  metadata: jsonb("metadata").$type<{
    size?: number;
    pageCount?: number;
    author?: string;
    language?: string;
    tags?: string[];
    [key: string]: unknown;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  indexedAt: timestamp("indexed_at", { withTimezone: true }),
});

// Embedding dimension: 768 for Gemini gemini-embedding-001 (default)
// 1536 for OpenAI text-embedding-3-small — set EMBEDDING_DIM env var to override
const EMBEDDING_DIM = Number(process.env["EMBEDDING_DIM"] ?? 768);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    chunkMetadata: jsonb("chunk_metadata").$type<{
      chunkIndex: number;
      startChar?: number;
      endChar?: number;
      pageNumber?: number;
      section?: string;
      tokenCount?: number;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // IVFFlat index for approximate nearest neighbor search
    // listCount tuning: use ~sqrt(rows) for <1M rows
    embeddingIdx: index("document_chunks_embedding_idx").using(
      "ivfflat",
      table.embedding.op("vector_cosine_ops")
    ),
    documentIdIdx: index("document_chunks_document_id_idx").on(table.documentId),
  })
);

// ============================================================
// Relations
// ============================================================

export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const documentsRelations = relations(documents, ({ many }) => ({
  chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
}));

// ============================================================
// Types
// ============================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;
