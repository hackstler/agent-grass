import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  boolean,
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
  "entity",
]);

// ============================================================
// Tables
// ============================================================

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  name: text("name"),
  surname: text("surname"),
  orgId: text("org_id").notNull(),
  role: text("role").$type<"admin" | "user" | "super_admin">().notNull().default("user"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export interface OrgFeatures {
  quotes?: boolean;
}

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull().unique(),
  slug: text("slug").unique(),
  name: text("name"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  nif: text("nif"),
  logo: text("logo"),
  web: text("web"),
  vatRate: numeric("vat_rate", { precision: 5, scale: 4 }),
  currency: text("currency").notNull().default("€"),
  features: jsonb("features").$type<OrgFeatures>().default({}),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
  // 'disconnected' | 'pending' | 'qr' | 'code' | 'connected'
  qrData: text("qr_data"),
  phone: text("phone"),
  linkingMethod: text("linking_method").notNull().default("qr"),
  pairingCode: text("pairing_code"),
  phoneNumber: text("phone_number"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("google"),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    tokenExpiry: timestamp("token_expiry", { withTimezone: true }),
    scopes: text("scopes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("oauth_tokens_user_id_idx").on(table.userId),
    userProviderUq: uniqueIndex("oauth_tokens_user_provider_uq").on(table.userId, table.provider),
  })
);

export const catalogs = pgTable("catalogs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  effectiveDate: timestamp("effective_date", { withTimezone: true }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    catalogId: uuid("catalog_id")
      .notNull()
      .references(() => catalogs.id, { onDelete: "cascade" }),
    code: integer("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    pricePerUnit: numeric("price_per_unit", { precision: 10, scale: 2 }).notNull(),
    unit: text("unit").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    catalogIdx: index("catalog_items_catalog_id_idx").on(t.catalogId),
    catalogCodeUq: uniqueIndex("catalog_items_catalog_code_uq").on(t.catalogId, t.code),
  })
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    role: text("role").notNull().default("user"),
    email: text("email"),
    tokenHash: text("token_hash").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tokenHashIdx: index("invitations_token_hash_idx").on(table.tokenHash),
    orgIdIdx: index("invitations_org_id_idx").on(table.orgId),
  })
);

// ── Quote line item JSON type (stored in quotes.lineItems JSONB) ──────────────
export interface QuoteLineItemJson {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

// ── Grass comparison JSONB types (stored in quotes.quoteData) ─────────────────
export interface GrassComparisonRowJson {
  grassName: string;
  pricePerM2: number;
  totalGrassInstalled: number;
  aridosTotal: number;
  traviesasTotal: number;
  baseImponible: number;
  iva: number;
  totalConIva: number;
}

export interface GrassQuoteDataJson {
  areaM2: number;
  surfaceType: "SOLADO" | "TIERRA";
  perimeterLm: number;
  sacasAridos: number;
  rows: GrassComparisonRowJson[];
  traviesasNote: string;
  aridosNote?: string;
}

export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  quoteNumber: text("quote_number").notNull(),
  clientName: text("client_name").notNull(),
  clientAddress: text("client_address"),
  lineItems: jsonb("line_items").notNull().$type<QuoteLineItemJson[]>(),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  vatAmount: numeric("vat_amount", { precision: 10, scale: 2 }).notNull(),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  pdfBase64: text("pdf_base64"),
  filename: text("filename").notNull(),
  quoteData: jsonb("quote_data").$type<GrassQuoteDataJson | null>(),
  surfaceType: text("surface_type"),
  areaM2: numeric("area_m2", { precision: 10, scale: 2 }),
  perimeterLm: numeric("perimeter_lm", { precision: 10, scale: 2 }),
  province: text("province"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Grass pricing lookup table (price/m² by grass type × surface × m²) ───────
export const grassPricing = pgTable(
  "grass_pricing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    catalogItemId: uuid("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    surfaceType: text("surface_type").notNull(), // "SOLADO" | "TIERRA"
    m2: integer("m2").notNull(), // 1-650
    pricePerM2: numeric("price_per_m2", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    lookupIdx: index("grass_pricing_lookup_idx").on(t.catalogItemId, t.surfaceType, t.m2),
    uniqueEntry: uniqueIndex("grass_pricing_unique_entry").on(t.catalogItemId, t.surfaceType, t.m2),
  })
);

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
  oauthTokens: many(oauthTokens),
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

export const oauthTokensRelations = relations(oauthTokens, ({ one }) => ({
  user: one(users, {
    fields: [oauthTokens.userId],
    references: [users.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  creator: one(users, { fields: [invitations.createdBy], references: [users.id], relationName: "invitationCreator" }),
  usedByUser: one(users, { fields: [invitations.usedBy], references: [users.id], relationName: "invitationUsedBy" }),
}));

export const quotesRelations = relations(quotes, ({ one }) => ({
  user: one(users, { fields: [quotes.userId], references: [users.id] }),
}));

export const catalogsRelations = relations(catalogs, ({ many }) => ({
  items: many(catalogItems),
}));

export const catalogItemsRelations = relations(catalogItems, ({ one, many }) => ({
  catalog: one(catalogs, {
    fields: [catalogItems.catalogId],
    references: [catalogs.id],
  }),
  grassPrices: many(grassPricing),
}));

export const grassPricingRelations = relations(grassPricing, ({ one }) => ({
  catalogItem: one(catalogItems, {
    fields: [grassPricing.catalogItemId],
    references: [catalogItems.id],
  }),
}));

// ============================================================
// Types
// ============================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
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
export type OAuthToken = typeof oauthTokens.$inferSelect;
export type NewOAuthToken = typeof oauthTokens.$inferInsert;
export type Catalog = typeof catalogs.$inferSelect;
export type NewCatalog = typeof catalogs.$inferInsert;
export type CatalogItem = typeof catalogItems.$inferSelect;
export type NewCatalogItem = typeof catalogItems.$inferInsert;
export type InvitationRow = typeof invitations.$inferSelect;
export type NewInvitationRow = typeof invitations.$inferInsert;
export type QuoteRow = typeof quotes.$inferSelect;
export type NewQuoteRow = typeof quotes.$inferInsert;
export type GrassPricingRow = typeof grassPricing.$inferSelect;
export type NewGrassPricingRow = typeof grassPricing.$inferInsert;
