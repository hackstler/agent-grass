/**
 * Domain entities — pure TypeScript interfaces, zero infrastructure dependencies.
 *
 * These mirror the Drizzle-inferred types in infrastructure/db/schema.ts.
 * Because TypeScript uses structural typing, Drizzle rows are assignable
 * to these interfaces without explicit mapping.
 */

// ── Agent Context ───────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AgentContextParams {
  userId: string;
  orgId: string;
  conversationId: string;
  /** Hook: fires after the entire agent execution completes. */
  onFinish?: (event: any) => void | Promise<void>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type AgentContextKey = "userId" | "orgId" | "conversationId";

// ── User ────────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  surname: string | null;
  phone: string | null;
  orgId: string;
  role: "admin" | "user" | "super_admin";
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface NewUser {
  id?: string | undefined;
  email?: string | null | undefined;
  name?: string | null | undefined;
  surname?: string | null | undefined;
  phone?: string | null | undefined;
  orgId: string;
  role?: "admin" | "user" | "super_admin" | undefined;
  metadata?: Record<string, unknown> | null | undefined;
  createdAt?: Date | undefined;
}

// ── Conversation ────────────────────────────────────────────────────────────────

export interface ConversationConfig {
  memoryStrategy?: "single-turn" | "fixed-window" | "summary";
  windowSize?: number;
  systemPrompt?: string;
  /** Stable channel reference for lookup (e.g. "whatsapp:chatId"). Survives title changes. */
  channelRef?: string;
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

export interface ToolCallSummary {
  toolName: string;
  summary: string;
}

export interface MessageMetadata {
  tokens?: number;
  latencyMs?: number;
  costUsd?: number;
  retrievedChunks?: string[];
  model?: string;
  toolCalls?: ToolCallSummary[];
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

export type ContentType = "pdf" | "markdown" | "html" | "code" | "text" | "url" | "youtube" | "entity";
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

// ── Organization ─────────────────────────────────────────────────────────────

export interface OrgFeatures {
  quotes?: boolean;
}

/** Per-organization quote settings — transversal to all quote types. */
export interface QuoteSettings {
  paymentTerms?: string | undefined;
  quoteValidityDays?: number | undefined;
  companyRegistration?: string | undefined;
}

export interface Organization {
  id: string;
  orgId: string;
  slug: string | null;
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  nif: string | null;
  logo: string | null;
  web: string | null;
  vatRate: string | null;
  currency: string;
  features: OrgFeatures | null;
  quoteSettings: QuoteSettings | null;
  whatsappPhoneNumberId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOrganization {
  id?: string | undefined;
  orgId: string;
  slug?: string | null | undefined;
  name?: string | null | undefined;
  address?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  nif?: string | null | undefined;
  logo?: string | null | undefined;
  web?: string | null | undefined;
  vatRate?: string | null | undefined;
  currency?: string | undefined;
  features?: OrgFeatures | null | undefined;
  quoteSettings?: QuoteSettings | null | undefined;
  whatsappPhoneNumberId?: string | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

// ── WhatsApp Session ────────────────────────────────────────────────────────────

export interface WhatsappSession {
  id: string;
  orgId: string;
  userId: string;
  status: string;
  qrData: string | null;
  phone: string | null;
  linkingMethod: string;
  pairingCode: string | null;
  phoneNumber: string | null;
  updatedAt: Date;
}

export interface NewWhatsappSession {
  id?: string | undefined;
  orgId: string;
  userId: string;
  status?: string | undefined;
  qrData?: string | null | undefined;
  phone?: string | null | undefined;
  linkingMethod?: string | undefined;
  pairingCode?: string | null | undefined;
  phoneNumber?: string | null | undefined;
  updatedAt?: Date | undefined;
}

// ── OAuth Token ────────────────────────────────────────────────────────────────

export interface OAuthToken {
  id: string;
  userId: string;
  provider: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenExpiry: Date | null;
  scopes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOAuthToken {
  id?: string | undefined;
  userId: string;
  provider?: string | undefined;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenExpiry?: Date | null | undefined;
  scopes?: string | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

// ── Invitation ──────────────────────────────────────────────────────────────

export interface Invitation {
  id: string;
  orgId: string;
  role: string;
  email: string | null;
  tokenHash: string;
  createdBy: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  usedBy: string | null;
  createdAt: Date;
}

export interface NewInvitation {
  id?: string | undefined;
  orgId: string;
  role?: string | undefined;
  email?: string | null | undefined;
  tokenHash: string;
  createdBy?: string | null | undefined;
  expiresAt: Date;
}

// ── Quote ────────────────────────────────────────────────────────────────────

export interface QuoteLineItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface GrassComparisonRow {
  grassName: string;
  pricePerM2: number;
  totalGrassInstalled: number;
  aridosTotal: number;
  traviesasTotal: number;
  baseImponible: number;
  iva: number;
  totalConIva: number;
}

export interface GrassQuoteData {
  areaM2: number;
  surfaceType: "SOLADO" | "TIERRA";
  perimeterLm: number;
  sacasAridos: number;
  rows: GrassComparisonRow[];
  traviesasNote: string;
  aridosNote?: string;
}

export interface Quote {
  id: string;
  orgId: string;
  userId: string;
  quoteNumber: string;
  clientName: string;
  clientAddress: string | null;
  lineItems: QuoteLineItem[];
  subtotal: string;
  vatAmount: string;
  total: string;
  pdfBase64: string | null;
  filename: string;
  quoteData: Record<string, unknown> | null;
  surfaceType: string | null;
  areaM2: string | null;
  perimeterLm: string | null;
  province: string | null;
  createdAt: Date;
}

export interface NewQuote {
  id?: string | undefined;
  orgId: string;
  userId: string;
  quoteNumber: string;
  clientName: string;
  clientAddress?: string | null | undefined;
  lineItems: QuoteLineItem[];
  subtotal: string;
  vatAmount: string;
  total: string;
  pdfBase64?: string | null | undefined;
  filename: string;
  quoteData?: Record<string, unknown> | null | undefined;
  surfaceType?: string | null | undefined;
  areaM2?: string | null | undefined;
  perimeterLm?: string | null | undefined;
  province?: string | null | undefined;
  createdAt?: Date | undefined;
}

// ── Agent Memory ──────────────────────────────────────────────────────────────

export type AgentMemoryType = "client_pref" | "product_insight" | "workflow_pattern" | "user_pref";

export interface AgentMemory {
  id: string;
  orgId: string;
  userId: string | null;
  type: AgentMemoryType;
  key: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewAgentMemory {
  id?: string | undefined;
  orgId: string;
  userId?: string | null | undefined;
  type: AgentMemoryType;
  key: string;
  content: string;
  metadata?: Record<string, unknown> | null | undefined;
}

// ── Catalog ─────────────────────────────────────────────────────────────────

export interface Catalog {
  id: string;
  orgId: string;
  name: string;
  effectiveDate: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCatalog {
  id?: string | undefined;
  orgId: string;
  name: string;
  effectiveDate: Date;
  isActive?: boolean | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

// ── CatalogItem ─────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  catalogId: string;
  code: number;
  name: string;
  description: string | null;
  category: string | null;
  pricePerUnit: string;
  unit: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
}

export interface NewCatalogItem {
  id?: string | undefined;
  catalogId: string;
  code: number;
  name: string;
  description?: string | null | undefined;
  category?: string | null | undefined;
  pricePerUnit: string;
  unit: string;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
  createdAt?: Date | undefined;
}

// ── Expense ──────────────────────────────────────────────────────────────────

export interface Expense {
  id: string;
  orgId: string;
  userId: string;
  vendor: string;
  amount: number;          // total con IVA — number en dominio, string en DB (numeric)
  vatAmount: number | null;
  concept: string | null;
  date: string;            // YYYY-MM-DD
  receiptAttachmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewExpense {
  orgId: string;
  userId: string;
  vendor: string;
  amount: number;
  vatAmount?: number;
  concept?: string;
  date: string;            // YYYY-MM-DD
  receiptAttachmentId?: string;
}

export interface ExpenseSummary {
  totalAmount: number;
  totalVat: number;
  count: number;
  byVendor: { vendor: string; total: number; count: number }[];
}
