import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  pgEnum,
  vector,
  customType,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
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
  orgId: text("org_id").notNull(),
  role: text("role").$type<"admin" | "user">().notNull().default("user"),
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

export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index("topics_org_id_idx").on(table.orgId),
    orgNameIdx: uniqueIndex("topics_org_id_name_idx").on(table.orgId, table.name),
  })
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
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
      summary?: string;
      keywords?: string[];
      entities?: string[];
      detectedLanguage?: string;
      [key: string]: unknown;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index("documents_org_id_idx").on(table.orgId),
    sourceIdx: index("documents_source_idx").on(table.source),
    topicIdx: index("documents_topic_id_idx").on(table.orgId, table.topicId),
  })
);

export const whatsappSessions = pgTable("whatsapp_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("disconnected"),
  // 'disconnected' | 'pending' | 'qr' | 'connected'
  qrData: text("qr_data"),
  phone: text("phone"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
    contextPrefix: text("context_prefix"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    searchVector: tsvector("search_vector"),
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
    searchIdx: index("document_chunks_search_idx").using("gin", table.searchVector),
  })
);

// ============================================================
// Relations
// ============================================================

export const usersRelations = relations(users, ({ many, one }) => ({
  conversations: many(conversations),
  whatsappSession: one(whatsappSessions),
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

export const topicsRelations = relations(topics, ({ many }) => ({
  documents: many(documents),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  chunks: many(documentChunks),
  topic: one(topics, { fields: [documents.topicId], references: [topics.id] }),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
}));

export const whatsappSessionsRelations = relations(whatsappSessions, ({ one }) => ({
  user: one(users, {
    fields: [whatsappSessions.userId],
    references: [users.id],
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
export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;
export type WhatsappSession = typeof whatsappSessions.$inferSelect;
export type NewWhatsappSession = typeof whatsappSessions.$inferInsert;
