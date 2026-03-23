/**
 * E2E Test App Factory — replicas EXACTAMENTE el flujo de producción.
 *
 * Monta la app Hono completa con:
 * - Auth middleware real (JWT)
 * - Coordinator agent REAL (Gemini)
 * - Sub-agentes REALES (Gemini)
 * - Tools con deps mockeadas (repos, catalog service)
 * - Plugin routes montadas (/chat, /chat/stream)
 * - Internal routes montadas (/internal/whatsapp/message)
 *
 * El único mock es la capa de DB (repos) y servicios externos (CatalogService).
 * El flujo HTTP → auth → controller → agent → tools → response es IDÉNTICO a producción.
 */
import { vi } from "vitest";
import jwt from "jsonwebtoken";
import { Hono } from "hono";

// ── Module mocks (hoisted by vitest before any imports) ─────────────────────
vi.mock("../../../infrastructure/db/client.js", () => ({
  db: {},
  checkDbConnection: vi.fn().mockResolvedValue(true),
  ensurePgVector: vi.fn(),
  runMigrations: vi.fn(),
}));

// ── Imports (resolved after mocks) ──────────────────────────────────────────
import { tool } from "ai";
import type { AgentTools } from "../../../agent/types.js";
import { AgentRunner } from "../../../agent/agent-runner.js";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";

import { createApp, type AppDependencies } from "../../../app.js";
import { UserManager } from "../../../application/managers/user.manager.js";
import { DocumentManager } from "../../../application/managers/document.manager.js";
import { ConversationManager } from "../../../application/managers/conversation.manager.js";
import { WhatsAppManager } from "../../../application/managers/whatsapp.manager.js";
import { TopicManager } from "../../../application/managers/topic.manager.js";
import { OrganizationManager } from "../../../application/managers/organization.manager.js";
import { PasswordStrategy } from "../../../infrastructure/auth/password.strategy.js";
import { PluginRegistry } from "../../../plugins/plugin-registry.js";
import type { Plugin } from "../../../plugins/plugin.interface.js";

// Quote plugin — real logic, mocked services
import { PdfService } from "../../../plugins/quote/services/pdf.service.js";
import { QuoteStrategyRegistry } from "../../../plugins/quote/strategies/index.js";
import { createCalculateBudgetTool } from "../../../plugins/quote/tools/calculate-budget.tool.js";
import { createListCatalogTool } from "../../../plugins/quote/tools/list-catalog.tool.js";
import { createListQuotesTool } from "../../../plugins/quote/tools/list-quotes.tool.js";
import { createQuoteAgent } from "../../../plugins/quote/quote.agent.js";

// Chat routes — production route factory
import { createChatRoutes } from "../../../plugins/rag/routes/chat.routes.js";

// Agent context
import { getAgentContextValue } from "../../../application/agent-context.js";
import { ragConfig } from "../../../plugins/rag/config/rag.config.js";

// Delegation tools
import { createDelegationTools } from "../../../agent/delegation.js";

import {
  createMockUserRepo,
  createMockDocumentRepo,
  createMockConversationRepo,
  createMockSessionRepo,
  createMockTopicRepo,
  createMockOrgRepo,
  createMockCatalogRepo,
  fakeUser,
  fakeConversation,
} from "../../helpers/mock-repos.js";
import type { AuthConfig } from "../../../config/auth.config.js";
import { InMemoryAttachmentStore } from "../../../infrastructure/stores/in-memory-attachment-store.js";

// ── Constants ───────────────────────────────────────────────────────────────

export const TEST_JWT_SECRET = "test-secret-for-jwt";
const PASSWORD_SALT = TEST_JWT_SECRET;

export const TEST_ORG_ID = "test-org";
export const TEST_USER_ID = "00000000-0000-4000-a000-000000000001";

// ── Auth helpers (idénticos a producción) ────────────────────────────────────

export function createAuthHeaders(payload: {
  userId: string;
  email: string;
  orgId: string;
  role: "admin" | "user" | "super_admin";
}): Record<string, string> {
  const token = jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: "1h" });
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function createWorkerHeaders(): Record<string, string> {
  const token = jwt.sign({ role: "worker" }, TEST_JWT_SECRET, { expiresIn: "1h" });
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// Default user auth for most tests
export const USER_AUTH = () => createAuthHeaders({
  userId: TEST_USER_ID,
  email: "vendedor@test.com",
  orgId: TEST_ORG_ID,
  role: "user",
});

export const WORKER_AUTH = () => createWorkerHeaders();

// ── Test data ──────────────────────────────────────────────────────────────

export const TEST_ORG = {
  id: "org-uuid-001",
  orgId: TEST_ORG_ID,
  slug: "test-cesped",
  name: "Madrid Césped S.L.",
  address: "Calle Ejemplo 1, 28001 Madrid",
  phone: "+34 912 345 678",
  email: "info@madridcesped.com",
  nif: "B12345678",
  logo: null,
  web: "https://madridcesped.com",
  vatRate: "0.21",
  currency: "€",
  features: { quotes: true },
  quoteSettings: {
    paymentTerms: "50% a la aprobación, 50% a la finalización.",
    quoteValidityDays: 60,
    companyRegistration: "Registro Mercantil de Madrid.",
  },
  metadata: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-03-01"),
};

export const TEST_CATALOG_ID = "cat-test-001";

export const TEST_GRASS_PRICES = [
  { grassName: "Monaco Premium 45mm", pricePerM2: 24.50 },
  { grassName: "Sena 40mm", pricePerM2: 21.00 },
  { grassName: "Oasis 35mm", pricePerM2: 18.50 },
  { grassName: "Trevi 30mm", pricePerM2: 16.00 },
  { grassName: "Roma 25mm", pricePerM2: 14.50 },
  { grassName: "Nápoles 40mm", pricePerM2: 22.00 },
  { grassName: "Florencia 35mm", pricePerM2: 19.50 },
  { grassName: "Milán 30mm", pricePerM2: 17.00 },
];

export const TEST_RAG_CHUNKS = [
  {
    id: "chunk-001",
    content: "Para instalar césped artificial sobre tierra, primero se debe nivelar el terreno, compactar la base con zahorra y luego extender una malla antihierbas.",
    score: 0.92,
    documentTitle: "Guía de instalación césped artificial",
    documentSource: "https://madridcesped.com/guia-instalacion",
  },
  {
    id: "chunk-002",
    content: "El mantenimiento del césped artificial es mínimo: cepillado periódico, limpieza con agua y eliminación de hojas caídas.",
    score: 0.85,
    documentTitle: "Manual de mantenimiento",
    documentSource: "https://madridcesped.com/mantenimiento",
  },
];

// ── Mock service factories ─────────────────────────────────────────────────

function createMockCatalogService() {
  return {
    getActiveCatalog: vi.fn().mockResolvedValue({
      id: TEST_CATALOG_ID,
      businessType: "grass",
      settings: null,
    }),
    getActiveCatalogId: vi.fn().mockResolvedValue(TEST_CATALOG_ID),
    findItem: vi.fn().mockResolvedValue(null),
    getAllItems: vi.fn().mockResolvedValue(
      TEST_GRASS_PRICES.map((gp, i) => ({
        id: `item-${i + 1}`, code: i + 1, name: gp.grassName,
        description: `Césped artificial ${gp.grassName}`, pricePerUnit: 0, unit: "m²",
      })),
    ),
    getAllGrassPrices: vi.fn().mockResolvedValue(TEST_GRASS_PRICES),
  };
}

function createMockQuoteRepo() {
  return {
    findByOrg: vi.fn().mockResolvedValue([]),
    findByUser: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(async (data: Record<string, unknown>) => ({
      id: "quote-test-001", ...data, createdAt: new Date(),
    })),
    deleteByOrg: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Test plugin factories (Gemini REAL, deps mockeadas) ────────────────────

function createTestQuotePlugin(mocks: {
  catalogService: ReturnType<typeof createMockCatalogService>;
  orgRepo: ReturnType<typeof createMockOrgRepo>;
  quoteRepo: ReturnType<typeof createMockQuoteRepo>;
  attachmentStore: InMemoryAttachmentStore;
}): Plugin {
  const pdfService = new PdfService();
  const strategyRegistry = new QuoteStrategyRegistry();
  const defaultStrategy = strategyRegistry.getDefault();

  const calculateBudget = createCalculateBudgetTool({
    catalogService: mocks.catalogService as any,
    pdfService,
    attachmentStore: mocks.attachmentStore,
    organizationRepo: mocks.orgRepo as any,
    quoteRepo: mocks.quoteRepo as any,
    strategyRegistry,
  });
  const listCatalog = createListCatalogTool({
    catalogService: mocks.catalogService as any,
    strategy: defaultStrategy,
  });
  const listQuotes = createListQuotesTool({ quoteRepo: mocks.quoteRepo as any });

  const tools: AgentTools = { calculateBudget, listCatalog, listQuotes };
  const agent = createQuoteAgent(tools, defaultStrategy);

  return {
    id: "quote",
    name: "Quote Plugin",
    description: `Generates price quotes and PDF invoices for ${defaultStrategy.displayName}. Can also list previously generated quotes.`,
    agent,
    tools,
  };
}

function createTestRagPlugin(coordinatorAgent: AgentRunner, convManager: ConversationManager, attachmentStore: InMemoryAttachmentStore): Plugin {
  const searchDocuments = tool({
    description: "Search the knowledge base for relevant document chunks using semantic similarity.",
    inputSchema: z.object({
      query: z.string(), topK: z.number().optional(),
      documentIds: z.array(z.string()).optional(), topicId: z.string().optional(),
    }),
    execute: async ({ query }) => {
      const lower = query.toLowerCase();
      const relevant = lower.includes("césped") || lower.includes("cesped") ||
        lower.includes("instalación") || lower.includes("instalacion") ||
        lower.includes("mantenimiento") || lower.includes("artificial");
      return {
        chunks: relevant ? TEST_RAG_CHUNKS : [],
        chunkCount: relevant ? TEST_RAG_CHUNKS.length : 0,
      };
    },
  });

  const saveNote = tool({
    description: "Save a note or document to the knowledge base.",
    inputSchema: z.object({ title: z.string(), content: z.string() }),
    execute: async () => ({ success: true, documentId: "doc-saved-001" }),
  });

  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  const google = createGoogleGenerativeAI({ apiKey: apiKey! });

  const tools: AgentTools = { searchDocuments, saveNote };
  const ragAgent = new AgentRunner({
    system: `You are ${ragConfig.agentName}. ${ragConfig.agentDescription}
You assist SELLERS, NOT end customers.
1. For questions about products/installation/maintenance, call searchDocuments first.
2. Base ALL responses on tool results. Never hallucinate.
3. Cite sources with title and URL.
4. Always respond in Spanish.`,
    model: google("gemini-2.5-flash"),
    tools,
  });

  return {
    id: "rag",
    name: "RAG Plugin",
    description: "Retrieval-Augmented Generation with hybrid search, ingestion, and chat",
    agent: ragAgent,
    tools,
    // PRODUCTION ROUTES — createChatRoutes es la misma función que usa producción
    routes: () => {
      const app = new Hono();
      app.route("/chat", createChatRoutes(coordinatorAgent, convManager, attachmentStore));
      return app;
    },
  };
}

function createTestCatalogManagerPlugin(): Plugin {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  const google = createGoogleGenerativeAI({ apiKey: apiKey! });

  const listCatalogs = tool({
    description: "List all catalogs for the current organization.",
    inputSchema: z.object({}),
    execute: async (_input, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      return { catalogs: [{ id: TEST_CATALOG_ID, name: `Catálogo ${orgId}`, isActive: true, itemCount: 8 }] };
    },
  });

  const listCatalogItems = tool({
    description: "List all items/products in a specific catalog with their prices.",
    inputSchema: z.object({ catalogId: z.string() }),
    execute: async () => ({
      items: TEST_GRASS_PRICES.map((gp, i) => ({
        code: i + 1, name: gp.grassName, description: `Césped artificial ${gp.grassName}`,
        pricePerUnit: gp.pricePerM2, unit: "m²",
      })),
    }),
  });

  const tools: AgentTools = { listCatalogs, listCatalogItems };
  const agent = new AgentRunner({
    system: `Eres un especialista en gestión de catálogos de césped artificial.
1. SIEMPRE llama a listCatalogs PRIMERO.
2. Para consultas de productos/precios, llama a listCatalogItems.
3. Muestra precios con símbolo de moneda.
Responde SIEMPRE en español.`,
    model: google("gemini-2.5-flash"),
    tools,
  });

  return {
    id: "catalog-manager",
    name: "Catalog Manager Plugin",
    description: "Catalog/product management: list products and prices.",
    agent,
    tools,
  };
}

// ── Coordinator (uses delegation tools — same pattern as production) ──

function createTestCoordinator(registry: PluginRegistry): AgentRunner {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  const google = createGoogleGenerativeAI({ apiKey: apiKey! });

  const tools = createDelegationTools(registry.getAll());
  const isSpanish = ragConfig.responseLanguage === "es";
  const pluginList = registry.getAll()
    .map((p) => `- delegateTo_${p.id}: ${p.name} — ${p.description}`)
    .join("\n");

  return new AgentRunner({
    system: `You are ${ragConfig.agentName}, a personal assistant for salespeople.

== IDENTITY ==
Your name is ${ragConfig.agentName}. ${ragConfig.agentDescription}
You assist SELLERS (vendedores), NOT end customers.

== ROUTING ==
${pluginList}

== INTENT DISAMBIGUATION ==
- Price lookups ("¿cuánto cuesta X?", "precio de X") → delegateTo_catalog-manager
- Quote generation ("hazme un presupuesto", "presupuesto para cliente X") → delegateTo_quote
- Catalog browsing ("¿qué productos tenemos?") → delegateTo_catalog-manager
- Knowledge questions → delegateTo_rag

Rules:
1. For pure greetings → respond directly WITHOUT delegating.
2. For price/catalog queries → delegate to delegateTo_catalog-manager.
3. For quote generation → delegate to delegateTo_quote.
4. For knowledge questions → delegate to delegateTo_rag.
5. Pass the user's EXACT message. Return agent's response as-is.

== RESPONSE RULES ==
1. Always respond in ${isSpanish ? "Spanish" : ragConfig.responseLanguage}.
2. Base ALL responses on tool results.`,
    model: google("gemini-2.5-flash"),
    tools,
  });
}

// ── Public: E2E Test App Factory ───────────────────────────────────────────

export interface E2ETestContext {
  /** Hono app completa — idéntica a producción */
  app: ReturnType<typeof createApp>;
  /** Mocks para verificar llamadas a repos y servicios */
  mocks: {
    orgRepo: ReturnType<typeof createMockOrgRepo>;
    quoteRepo: ReturnType<typeof createMockQuoteRepo>;
    catalogService: ReturnType<typeof createMockCatalogService>;
    convRepo: ReturnType<typeof createMockConversationRepo>;
    userRepo: ReturnType<typeof createMockUserRepo>;
    sessionRepo: ReturnType<typeof createMockSessionRepo>;
  };
  /** AttachmentStore real (in-memory) para verificar PDFs */
  attachmentStore: InMemoryAttachmentStore;
}

export function createE2ETestApp(): E2ETestContext {
  process.env["JWT_SECRET"] = TEST_JWT_SECRET;

  // 1. Repos mockeados (como producción, pero sin DB)
  const userRepo = createMockUserRepo();
  const docRepo = createMockDocumentRepo();
  const convRepo = createMockConversationRepo();
  const sessionRepo = createMockSessionRepo();
  const topicRepo = createMockTopicRepo();
  const orgRepo = createMockOrgRepo();
  const catalogRepo = createMockCatalogRepo();

  // Configurar repos con datos por defecto
  orgRepo.findByOrgId.mockResolvedValue(TEST_ORG);
  userRepo.findById.mockImplementation(async (id: string) =>
    fakeUser({ id, orgId: TEST_ORG_ID, email: "vendedor@test.com" }),
  );
  convRepo.create.mockImplementation(async (data: Record<string, unknown>) =>
    fakeConversation({ id: `conv-${Date.now()}`, ...data } as any),
  );
  convRepo.findById.mockResolvedValue(null); // Force new conversation creation
  convRepo.findByTitle.mockResolvedValue(null);
  convRepo.findByChannelRef.mockResolvedValue(null); // Force new conversation for WhatsApp

  // 2. Auth strategy
  const authStrategy = new PasswordStrategy(PASSWORD_SALT, userRepo as any);

  // 3. Managers reales con repos mockeados
  const userManager = new UserManager(userRepo as any, authStrategy);
  const docManager = new DocumentManager(docRepo as any);
  const convManager = new ConversationManager(convRepo as any);
  const waManager = new WhatsAppManager(sessionRepo as any, userRepo as any);
  const topicManager = new TopicManager(topicRepo as any);
  const orgManager = new OrganizationManager(
    userRepo as any, docRepo as any, topicRepo as any,
    sessionRepo as any, orgRepo as any, catalogRepo as any, authStrategy,
  );

  // 4. Mock services para quote plugin
  const catalogService = createMockCatalogService();
  const quoteRepo = createMockQuoteRepo();
  const attachmentStore = new InMemoryAttachmentStore();

  // 5. Plugin registry — MISMO flujo que index.ts en producción
  const registry = new PluginRegistry();

  // Quote plugin: real Gemini + real PDF generation + mocked catalog/DB
  const quotePlugin = createTestQuotePlugin({
    catalogService, orgRepo: orgRepo as any, quoteRepo: quoteRepo as any, attachmentStore,
  });
  registry.register(quotePlugin);
  registry.register(createTestCatalogManagerPlugin());

  // 6. Coordinator: real Gemini, orquesta todos los plugins via delegation tools
  const coordinatorAgent = createTestCoordinator(registry);

  // 7. RAG plugin: tiene las routes /chat y /chat/stream — PRODUCCIÓN
  // Se registra DESPUÉS del coordinator porque necesita pasarlo para las rutas
  const ragPlugin = createTestRagPlugin(coordinatorAgent, convManager, attachmentStore);
  registry.register(ragPlugin);

  // 8. Crear app Hono COMPLETA — misma función que producción
  const testAuthConfig: AuthConfig = {
    strategy: "password",
    jwtTtl: "1h",
    firebase: { projectId: "" },
  };

  const app = createApp({
    userManager,
    docManager,
    convManager,
    waManager,
    topicManager,
    orgManager,
    coordinatorAgent,
    pluginRegistry: registry,
    authConfig: testAuthConfig,
    authStrategy,
    quoteRepo: quoteRepo as any,
    organizationRepo: orgRepo as any,
    attachmentStore,
  });

  return {
    app,
    mocks: { orgRepo, quoteRepo, catalogService, convRepo, userRepo, sessionRepo },
    attachmentStore,
  };
}

// ── Helpers para parsear SSE ────────────────────────────────────────────────

export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

export async function parseSSEResponse(res: Response): Promise<{ events: SSEEvent[]; fullText: string }> {
  const body = await res.text();
  const events: SSEEvent[] = [];
  let fullText = "";

  for (const line of body.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        const event = JSON.parse(line.slice(6)) as SSEEvent;
        events.push(event);
        if (event.type === "text" && typeof event["text"] === "string") {
          fullText += event["text"];
        }
      } catch {
        // Skip malformed events
      }
    }
  }

  return { events, fullText };
}
