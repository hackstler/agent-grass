# rag-agent-backbone

## Propósito
Template production-ready para desplegar agentes RAG especializados por cliente.
Clona el repo, ejecuta `/setup` en Claude Code, y tienes el agente configurado y listo para ingestar documentos.

## Stack Técnico (fijo — no configurable)
- **Runtime**: Node.js + TypeScript strict
- **API**: Hono (edge-first, SSE nativo)
- **LLM Orchestration**: Mastra.ai (TypeScript nativo, RAG module nativo)
- **Vector DB**: PostgreSQL + pgvector (un solo DATABASE_URL)
- **ORM**: Drizzle (lightweight, SQL-first)
- **Embeddings**: Gemini `gemini-embedding-001` (768-dim, GOOGLE_API_KEY)
- **LLM**: Gemini `gemini-2.5-flash` (configurable via GEMINI_MODEL)
- **Streaming**: SSE via Hono
- **Deploy local**: Docker Compose (postgres+pgvector + app)
- **Deploy prod**: Railway (API) + Supabase (DB)

## Comandos Claude Code

| Comando | Cuándo usarlo |
|---------|---------------|
| `/setup` | Primera vez con un cliente. Configura nombre, caso de uso, idioma, web search. |
| `/add-tool` | Añadir una integración nueva (REST API, DB, script, lógica interna). |
| `/status` | Ver configuración activa, tools registradas y estado del servidor. |
| `/ingest [path\|url]` | Ingestar un documento o URL en el vector store. |
| `/test-rag [query]` | Probar el retrieval y ver los chunks recuperados con sus scores. |
| `/tune-retrieval` | Diagnosticar problemas de calidad de retrieval y proponer ajustes. |
| `/benchmark` | Ejecutar suite de benchmarks de retrieval. |

## Flujo para un cliente nuevo

```
1. git clone rag-agent-backbone <nombre-proyecto>  &&  cd <nombre-proyecto>
2. npm install
3. /setup                    →  4 preguntas  →  archivos configurados
4. cp .env.example .env      →  añade GOOGLE_API_KEY y las keys que /setup indique
5. docker-compose up         →  PostgreSQL + pgvector
6. npm run migrate           →  aplica schema
7. npm run dev               →  servidor en :3000
8. /ingest ./docs/           →  indexa los documentos del cliente
9. POST /chat {"query":"..."}  →  prueba el agente
```

## Añadir una integración

```
/add-tool
→ elige tipo: REST API / Base de datos / Script externo / Lógica interna
→ responde las preguntas del tipo
→ código generado + tsc validado
```

## Arquitectura (Clean / Hexagonal)

```
Domain (entities, errors, ports)    ← cero dependencias externas
  ↑
Application (managers / use cases)  ← solo importa de domain
  ↑
Infrastructure (db, repositories)   ← implementa los ports
  ↑
API (controllers, middleware)       ← orquesta application + infrastructure
```

## Estructura clave
```
src/domain/entities/   → Interfaces puras de entidades (User, Document, Topic, etc.)
src/domain/errors/     → DomainError + subclases (NotFoundError, ConflictError, etc.)
src/domain/ports/      → Interfaces de repositorios (UserRepository, etc.)
src/application/       → Managers / use cases (UserManager, DocumentManager, etc.)
src/infrastructure/db/ → Drizzle schema, client, migrations, seed
src/infrastructure/repositories/ → Implementaciones Drizzle de los ports
src/api/               → Hono controllers, middleware, routes (chat, ingest, health)
src/rag/               → interfaces.ts + adapters.ts + retriever + reranker + chunker
src/agent/             → rag-agent.ts + workflow.ts
src/agent/tools/       → tool factory pattern (ToolEntry)
src/ingestion/         → Document ingestion (loader, processor)
src/config/            → rag.config.ts + tools.config.ts
```

## Convenciones
- Toda la config vive en `src/config/` — generada y modificada por los comandos Claude Code
- Añadir una tool = crear `src/agent/tools/my-tool.ts` + una línea en `tools/index.ts` + una línea en `tools.config.ts`
- Cambiar embedder/retriever/reranker = solo modificar `src/rag/adapters.ts`
- Secrets siempre en `.env`, nunca hardcoded — usar `process.env["VAR"]` (con corchetes)
- Local ↔ Producción: mismo código, solo variables de entorno cambian
- **Error responses**: `{ error: "Category", message: "detail" }` (e.g. `{ error: "NotFound", message: "User 'abc' not found" }`)
- **Domain entities**: definir en `src/domain/entities/` — domain y application NUNCA importan de infrastructure
- **Repository pattern**: interfaces en `src/domain/ports/repositories/`, implementaciones en `src/infrastructure/repositories/`

## Comandos npm
```bash
npm run dev          # Development con hot reload
npm run build        # Build producción
npm run migrate      # Aplicar migraciones Drizzle
npm run seed         # Datos de prueba
npm run ingest       # Ingestar documentos desde CLI
docker-compose up    # Stack local completo
```

## Variables de entorno requeridas
Ver `.env.example` para la lista completa.
Mínimo para local: `DATABASE_URL` + `GOOGLE_API_KEY`
Mínimo para prod: `DATABASE_URL` + `GOOGLE_API_KEY` (+ `PERPLEXITY_API_KEY` si web search activo)

## Setup inicial
Ejecuta `/setup` en Claude Code. Te hará 4 preguntas y actualizará directamente:
- `src/config/rag.config.ts`
- `src/config/tools.config.ts`
- `.env.example`
- `CLAUDE.md` (sección Propósito)
- `setup-responses.md` (memoria del wizard para futuras sesiones)
