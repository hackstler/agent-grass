/**
 * Seed script — carga datos de prueba para desarrollo.
 * Uso: npm run seed
 *
 * Crea:
 * - 1 usuario de prueba
 * - 1 conversación con mensajes de ejemplo
 * - 1 documento de muestra con chunks embedidos
 * - Catálogo de productos de césped artificial (si no existe)
 */
import "dotenv/config";
import { db, ensurePgVector } from "./client.js";
import { users, conversations, messages, documents, documentChunks, catalogs, catalogItems } from "./schema.js";
import { createEmbedding } from "../../plugins/rag/pipeline/embeddings.js";
import { eq, and } from "drizzle-orm";

const SAMPLE_DOCUMENT_CONTENT = `
# RAG Agent Backbone — Getting Started

## What is this?
This is a production-ready RAG (Retrieval-Augmented Generation) agent template.
It allows you to build AI assistants that answer questions based on your documents.

## Quick Start
1. Copy .env.example to .env and fill in your API keys
2. Run docker-compose up to start the local stack
3. Run npm run migrate to create the database tables
4. Run npm run seed to load sample data
5. Run npm run dev to start the development server

## Key Endpoints
- POST /chat — Ask a question (JSON response)
- GET /chat/stream — Ask a question (SSE streaming)
- POST /ingest — Upload a document
- GET /conversations — List conversation history
- GET /health — Check system status

## Configuration
All RAG parameters are in src/config/rag.config.ts.
Run the initial-setup.md wizard to customize them for your use case.

## Supported Document Types
The agent can ingest PDF files, Markdown documents, HTML pages, plain text files,
source code files, and web URLs. Documents are automatically chunked, embedded,
and stored in PostgreSQL with pgvector for semantic search.
`.trim();

async function seed() {
  console.log("[seed] Starting...");

  await ensurePgVector();

  // 1. Create test user
  const [user] = await db
    .insert(users)
    .values({
      email: "dev@example.com",
      orgId: "default",
      metadata: { name: "Dev User", role: "admin" },
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  const userId = user?.id;
  console.log(`[seed] User: ${userId ?? "already exists"}`);

  // 2. Create sample conversation
  const [conv] = await db
    .insert(conversations)
    .values({
      userId,
      title: "Sample conversation",
      config: { memoryStrategy: "fixed-window", windowSize: 10 },
    })
    .returning({ id: conversations.id });

  await db.insert(messages).values([
    {
      conversationId: conv!.id,
      role: "user",
      content: "What is this RAG agent template?",
    },
    {
      conversationId: conv!.id,
      role: "assistant",
      content:
        "This is a production-ready RAG agent backbone. It provides a complete setup for building AI assistants that answer questions based on your documents, with support for PDF, Markdown, HTML, and other formats.",
      metadata: { model: "seed", latencyMs: 0 },
    },
  ]);

  console.log(`[seed] Conversation: ${conv!.id}`);

  // 3. Create sample document + chunks
  const [doc] = await db
    .insert(documents)
    .values({
      orgId: "default",
      title: "RAG Agent Backbone — Getting Started",
      source: "seed/getting-started.md",
      contentType: "markdown",
      status: "processing",
      metadata: { size: SAMPLE_DOCUMENT_CONTENT.length },
    })
    .returning({ id: documents.id });

  // Create a few chunks with embeddings
  const chunkTexts = [
    "RAG Agent Backbone is a production-ready RAG template for building AI assistants that answer questions based on your documents.",
    "Quick Start: Copy .env.example, run docker-compose up, run npm run migrate, then npm run dev.",
    "Key endpoints: POST /chat for questions, POST /ingest for documents, GET /conversations for history, GET /health for status.",
    "Supported document types include PDF, Markdown, HTML, plain text, source code, and web URLs.",
    "All RAG parameters are configured in src/config/rag.config.ts via the initial-setup.md wizard.",
  ];

  console.log("[seed] Creating embeddings for sample chunks...");

  const chunkValues = await Promise.all(
    chunkTexts.map(async (content, i) => {
      const embedding = await createEmbedding(content);
      return {
        documentId: doc!.id,
        content,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        embedding: embedding as unknown as any, // pgvector: number[] at runtime; Drizzle vector column type mismatch
        chunkMetadata: { chunkIndex: i, tokenCount: Math.ceil(content.length / 4) },
      };
    })
  );

  await db.insert(documentChunks).values(chunkValues);

  await db
    .update(documents)
    .set({ status: "indexed", chunkCount: chunkTexts.length, indexedAt: new Date() })
    .where(
      (await import("drizzle-orm")).eq(documents.id, doc!.id)
    );

  console.log(`[seed] Document: ${doc!.id} (${chunkTexts.length} chunks)`);
  console.log(`
[seed] ✓ Done! Seed data loaded.

Test it:
  curl -X POST http://localhost:3000/chat \\
    -H "Content-Type: application/json" \\
    -d '{"query": "What are the key endpoints?"}'
`);
}

// ============================================================
// Catalog seed — callable from index.ts on startup
// ============================================================

const CATALOG_ITEMS = [
  { code: 1, name: "Cesped verde",              pricePerUnit: "12.00", unit: "m²", sortOrder: 1 },
  { code: 2, name: "Cesped amarillo",           pricePerUnit: "13.00", unit: "m²", sortOrder: 2 },
  { code: 3, name: "Cesped premium",            pricePerUnit: "16.00", unit: "m²", sortOrder: 3 },
  { code: 4, name: "Cesped premium ultimate",   pricePerUnit: "18.00", unit: "m²", sortOrder: 4 },
  { code: 5, name: "Cesped v4",                 pricePerUnit: "15.00", unit: "m²", sortOrder: 5 },
  { code: 6, name: "Cesped ecologico",          pricePerUnit: "16.00", unit: "m²", sortOrder: 6 },
  { code: 7, name: "Mano de obra",              pricePerUnit: "10.00", unit: "m²", sortOrder: 7 },
  { code: 8, name: "Desplazamiento",            pricePerUnit: "10.00", unit: "km", sortOrder: 8 },
];

/**
 * Seeds the product catalog for a given orgId.
 * Idempotent: skips if an active catalog already exists for the org.
 */
export async function seedCatalog(orgId: string): Promise<void> {
  const [existing] = await db
    .select({ id: catalogs.id })
    .from(catalogs)
    .where(and(eq(catalogs.orgId, orgId), eq(catalogs.isActive, true)))
    .limit(1);

  if (existing) {
    console.log(`[seed:catalog] Active catalog already exists for org "${orgId}", skipping`);
    return;
  }

  const [catalog] = await db
    .insert(catalogs)
    .values({
      orgId,
      name: "Catálogo Césped Artificial 2026",
      effectiveDate: new Date("2026-01-01"),
      isActive: true,
    })
    .returning({ id: catalogs.id });

  await db.insert(catalogItems).values(
    CATALOG_ITEMS.map((item) => ({ ...item, catalogId: catalog!.id }))
  );

  console.log(`[seed:catalog] Created catalog "${catalog!.id}" with ${CATALOG_ITEMS.length} items for org "${orgId}"`);
}

seed().catch((err) => {
  console.error("[seed] Error:", err.message);
  process.exit(1);
});
