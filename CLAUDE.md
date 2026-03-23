# agent-grass

## Propósito
Plataforma multi-tenant de agentes RAG con integración WhatsApp para generación de presupuestos de césped artificial. Basado en el template rag-agent-backbone, adaptado como MVP para cliente.

## Stack Técnico
- **Runtime**: Node.js + TypeScript strict
- **API**: Hono (edge-first, SSE nativo)
- **LLM Orchestration**: Vercel AI SDK (`ai` package — generateText/streamText/tool)
- **Vector DB**: PostgreSQL + pgvector (un solo DATABASE_URL)
- **ORM**: Drizzle (lightweight, SQL-first)
- **Embeddings**: Gemini `gemini-embedding-001` (768-dim, GOOGLE_API_KEY)
- **LLM**: Gemini `gemini-2.5-flash` (configurable via GEMINI_MODEL)
- **Auth**: Firebase ID tokens o password local (configurable via AUTH_STRATEGY)
- **Streaming**: SSE via Hono
- **Deploy**: Railway (API) + Supabase (DB)
- **Tests**: Vitest (unit + integration)

## Arquitectura (Clean / Hexagonal)

```
Domain (entities, errors, ports)       ← cero dependencias externas
  ↑
Application (managers / use cases)     ← solo importa de domain
  ↑
Infrastructure (db, repos, auth)       ← implementa los ports
  ↑
API (controllers, middleware)          ← orquesta application + infrastructure
  ↑
Plugins (rag, quote)                   ← extienden funcionalidad con agents, tools y routes
  ↑
Coordinator (AgentRunner principal)     ← orquesta plugins via delegation tools, punto de entrada del LLM
```

## Estructura del proyecto
```
src/
├── index.ts                           → Composition root: repos, managers, plugins, server
├── app.ts                             → Hono app factory: middleware, rutas, error handler
├── config/
│   └── auth.config.ts                 → Estrategia de auth (firebase | password)
├── domain/
│   ├── entities/index.ts              → Interfaces puras (User, Document, Topic, Conversation, Message, Chunk, WhatsAppSession)
│   ├── errors/                        → DomainError + subclases (NotFound, Conflict, Unauthorized, Forbidden, Validation)
│   └── ports/
│       ├── auth-strategy.ts           → Interface AuthStrategy (verify, createUser)
│       └── repositories/              → Interfaces de repos (User, Document, Conversation, Topic, WhatsAppSession)
├── application/managers/
│   ├── user.manager.ts                → Auth, registro, CRUD usuarios, roles
│   ├── organization.manager.ts        → CRUD organizaciones, cascade delete
│   ├── document.manager.ts            → Listado/borrado docs (scoped por orgId)
│   ├── conversation.manager.ts        → CRUD conversaciones + resolveOrCreateByTitle
│   ├── topic.manager.ts               → CRUD topics (por org), agrupación de documentos
│   └── whatsapp.manager.ts            → Sesiones WhatsApp per-user, QR, status
├── infrastructure/
│   ├── db/
│   │   ├── client.ts                  → Pool Drizzle + pgvector + auto-migrations en startup
│   │   ├── schema.ts                  → Tablas: users, conversations, messages, topics, documents, document_chunks, whatsapp_sessions, catalogs, catalog_items
│   │   ├── migrations/                → SQL migrations (drizzle-kit)
│   │   ├── seed.ts                    → Seed de datos
│   │   └── catalog-seed.ts            → Seed de catálogo (plugin quote)
│   ├── repositories/                  → Implementaciones Drizzle de los ports
│   │   ├── drizzle-user.repository.ts
│   │   ├── drizzle-document.repository.ts
│   │   ├── drizzle-conversation.repository.ts
│   │   ├── drizzle-topic.repository.ts
│   │   └── drizzle-whatsapp-session.repository.ts
│   └── auth/
│       ├── firebase.strategy.ts       → Verificación Firebase ID tokens
│       └── strategy-factory.ts        → Factory: firebase | password
├── api/
│   ├── controllers/
│   │   ├── auth.controller.ts         → POST /auth/register, /auth/login, GET /auth/me
│   │   ├── admin.controller.ts        → /admin/users, /admin/organizations (admin-only)
│   │   ├── internal.controller.ts     → /internal/whatsapp/* (worker auth)
│   │   ├── channel.controller.ts      → /channels/whatsapp/* (user auth)
│   │   ├── document.controller.ts     → GET /documents, DELETE /documents/:id
│   │   ├── conversation.controller.ts → CRUD /conversations
│   │   └── topic.controller.ts        → CRUD /topics, GET /topics/:id/documents
│   ├── middleware/
│   │   ├── auth.ts                    → authMiddleware (JWT/API-Key), requireRole, requireWorker, optionalAuth
│   │   └── error-handler.middleware.ts → DomainError → HTTP status mapping
│   ├── helpers/
│   │   ├── extract-sources.ts         → Parse tool results para citas
│   │   ├── format-whatsapp.ts         → Formateo texto WhatsApp
│   │   └── persist-messages.ts        → Persistir conversaciones en DB
│   └── health.ts                      → GET /health
├── agent/
│   ├── agent-runner.ts                → AgentRunner: wrapper sobre Vercel AI SDK generateText/streamText
│   ├── coordinator.ts                 → Agente coordinador (Emilio): orquesta todos los plugins
│   ├── delegation.ts                  → Creates delegation tools for sub-agent routing (returns DelegationResult)
│   ├── load-history.ts                → Carga historial de conversación como ModelMessage[] (con contexto de tools)
│   ├── tool-summaries.ts             → Extrae resúmenes de tool calls para persistencia cross-turn
│   └── types.ts                       → AgentContext, AgentTools, AgentGenerateResult, DelegationResult, AgentStep
├── plugins/
│   ├── plugin.interface.ts            → Contrato Plugin: id, name, agent?, tools, routes?, initialize?, shutdown?
│   ├── plugin-registry.ts             → Registro y lifecycle de plugins
│   ├── rag/                           → Plugin RAG
│   │   ├── rag.plugin.ts             → Entry point del plugin
│   │   ├── rag.agent.ts              → Agente RAG + tool registry
│   │   ├── config/
│   │   │   ├── rag.config.ts         → Config RAG (topK, threshold, chunking, etc.)
│   │   │   └── tools.config.ts       → Flags enable/disable por tool
│   │   ├── pipeline/
│   │   │   ├── interfaces.ts         → Contratos del pipeline
│   │   │   ├── adapters.ts           → Factories: embedder, retriever, reranker
│   │   │   ├── embeddings.ts         → Wrapper Gemini/OpenAI
│   │   │   ├── retriever.ts          → pgvector similarity search
│   │   │   ├── reranker.ts           → Cohere reranking (opcional)
│   │   │   ├── chunker.ts            → Estrategias de chunking
│   │   │   ├── query-transformer.ts  → Multi-query, HyDE
│   │   │   └── retrieval-pipeline.ts → Orquestador del pipeline
│   │   ├── tools/
│   │   │   ├── base.ts               → Tool factory pattern
│   │   │   ├── search-documents.ts   → Búsqueda RAG en documentos
│   │   │   ├── save-note.ts          → Persistir documentos
│   │   │   ├── search-web.ts         → Fallback web (Perplexity)
│   │   │   └── index.ts              → Tool registry
│   │   ├── routes/
│   │   │   ├── chat.routes.ts        → POST /chat (SSE streaming)
│   │   │   └── ingest.routes.ts      → POST /ingest
│   │   └── ingestion/
│   │       ├── loader.ts             → Carga archivos/URLs
│   │       ├── processor.ts          → Chunking + embedding
│   │       ├── enricher.ts           → Enriquecimiento de metadata
│   │       ├── contextualizer.ts     → Prefijos de contexto
│   │       ├── watcher.ts            → File system monitoring
│   │       ├── cli.ts                → Ingesta por CLI
│   │       └── loaders/youtube.ts    → YouTube loader
│   └── quote/                         → Plugin de presupuestos
│       ├── quote.plugin.ts           → Entry point
│       ├── quote.agent.ts            → Agente de presupuestos
│       ├── config/quote.config.ts    → Config del plugin
│       ├── tools/calculate-budget.tool.ts → Cálculo + generación PDF
│       └── services/
│           ├── catalog.service.ts    → Lookup de catálogo
│           └── pdf.service.ts        → Generación PDF (pdf-lib)
└── __tests__/
    ├── unit/                          → Tests de managers
    ├── integration/                   → Tests de controllers
    └── helpers/
        ├── mock-repos.ts             → Mock repositories
        └── test-app.ts               → App factory para tests
```

## Convenciones

### Arquitectura
- **Domain**: cero imports de infrastructure. Interfaces puras en `entities/`, ports en `ports/`
- **Application**: managers solo importan de domain. Lógica de negocio aquí
- **Infrastructure**: implementa ports. Drizzle, Firebase, repos concretos
- **API**: controllers delgados — validan con Zod, delegan en managers, devuelven respuesta
- **Plugins**: encapsulan agent + tools + routes. Se registran en `plugin-registry.ts`

### Código
- Secrets siempre en `.env`, nunca hardcoded — usar `process.env["VAR"]` (con corchetes)
- Error responses: `{ error: "Category", message: "detail" }`
- Validar siempre con Zod antes de procesar cualquier input
- UUIDs con `defaultRandom()` para PKs. No auto-increment
- Timestamps siempre `withTimezone: true`, almacenar UTC

### Plugins
- Cada plugin implementa `Plugin` interface de `plugin.interface.ts`
- Añadir plugin = crear carpeta en `src/plugins/`, registrar en `index.ts`
- Plugin owning: agent, tools, routes, config — todo encapsulado
- El coordinator agrega tools de todos los plugins registrados

### Multi-tenancy
- `orgId` es string libre (no FK) para aislamiento de datos
- WhatsApp sessions son per-user (no per-org), orgId denormalizado
- Documentos, topics, conversaciones: scoped por orgId
- Cascade delete: borrar org → borra users → cascade a sessions, conversations

### Testing
- Unit tests: mockear repos con `mock-repos.ts`, testear managers
- Integration tests: usar `test-app.ts` para crear app con mocks, testear controllers
- **E2E tests** (`src/__tests__/agent/`): agentes Gemini REALES, tools reales, PDFs reales. Requieren `GOOGLE_API_KEY`.
- **OBLIGATORIO**: Tras cualquier cambio en tools, plugins, controllers, coordinator o delegation, ejecutar `npm run test:e2e`. Son los tests más importantes del proyecto.
- Nombrar: `*.test.ts` en `__tests__/unit/`, `__tests__/integration/` o `__tests__/agent/`

## Comandos npm
```bash
npm run dev               # Development con hot reload (tsx watch)
npm run build             # tsc --noEmit + esbuild → dist/index.js
npm run start             # Ejecutar build compilado
npm run migrate           # Aplicar migraciones Drizzle
npm run migrate:generate  # Generar migración desde cambios en schema
npm run seed              # Datos de prueba
npm run ingest            # Ingestar documentos (CLI)
npm run ingest:youtube    # Ingestar desde YouTube
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
npm run test              # Vitest (todos)
npm run test:unit         # Solo unit tests
npm run test:integration  # Solo integration tests
npm run test:e2e          # E2E con agentes Gemini reales (OBLIGATORIO tras cambios en agents/tools)
npm run test:all          # Unit + integration + E2E
docker-compose up         # Stack local (postgres + app)
```

## Variables de entorno
Ver `.env.example` para la lista completa.

**Requeridas:**
- `DATABASE_URL` — PostgreSQL con pgvector
- `GOOGLE_API_KEY` — Gemini embeddings + LLM

**Auth:**
- `JWT_SECRET` — Firma de tokens
- `AUTH_STRATEGY` — `password` (default) o `firebase`
- `FIREBASE_PROJECT_ID` — Requerido si AUTH_STRATEGY=firebase
- `API_KEY` — Auth por API-Key (machine-to-machine)

**Opcionales:**
- `GEMINI_MODEL` — default: gemini-2.5-flash
- `PERPLEXITY_API_KEY` — Web search fallback
- `COHERE_API_KEY` — Reranking
- `YOUTUBE_API_KEY` — Ingesta YouTube
- `ALLOWED_ORIGINS` — CORS (comma-separated)

## Endpoints principales

| Grupo | Ruta | Auth | Propósito |
|-------|------|------|-----------|
| Auth | `POST /auth/register` | opcional | Registro (primer user = admin) |
| Auth | `POST /auth/login` | - | Login → JWT |
| Auth | `GET /auth/me` | user | Info usuario actual |
| Admin | `/admin/users/*` | admin | CRUD usuarios |
| Admin | `/admin/organizations/*` | admin | CRUD organizaciones |
| Chat | `POST /chat` | user | Query al agente (SSE streaming) |
| Ingest | `POST /ingest` | user | Ingestar documentos |
| Docs | `GET/DELETE /documents` | user | Gestión documentos |
| Topics | `CRUD /topics` | user | Gestión topics |
| Conversations | `CRUD /conversations` | user | Gestión conversaciones |
| WhatsApp | `/channels/whatsapp/*` | user | Estado/QR sesión WhatsApp |
| Internal | `/internal/whatsapp/*` | worker | Worker ↔ backbone protocol |
| Health | `GET /health` | - | Health check |

## Deploy
- **Railway**: detecta Dockerfile automáticamente, deploy on push a `main`
- **DB**: Supabase PostgreSQL con pgvector habilitado
- Las migraciones se ejecutan automáticamente en startup (`client.ts`)
- Remotes: `origin` = agent-grass, `backbone` = template (para sync futuro)
