# rag-agent-backbone

Template production-ready para desplegar un agente RAG conversacional en TypeScript.
Clona, configura dos variables de entorno, ejecuta `/setup` en Claude Code — y tienes un agente RAG funcionando.

**Stack fijo y determinista:** Hono · Mastra 1.5 · PostgreSQL + pgvector · Gemini · Drizzle ORM

---

## Requisitos previos

| Herramienta | Versión mínima | Para qué |
|------------|---------------|---------|
| Node.js | 20+ | Runtime |
| Docker + Docker Compose | Cualquiera reciente | PostgreSQL + pgvector local |
| Claude Code | Última | Wizard de setup y comandos |
| Google API Key | — | Embeddings + LLM (Gemini) |

> **Producción:** Railway (API) + Supabase (DB). El mismo código, solo cambian las env vars.

---

## Quick start

### 1. Clonar e instalar

```bash
git clone https://github.com/tu-usuario/rag-agent-backbone.git
cd rag-agent-backbone
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env
```

Abre `.env` y rellena **solo estas dos** para empezar:

```env
DATABASE_URL=postgresql://dev:dev@localhost:5432/ragdb   # ya configurada para Docker local
GOOGLE_API_KEY=AIzaSy...                                 # consola.cloud.google.com
```

### 3. Levantar la base de datos

```bash
docker-compose up -d postgres
```

Esto arranca PostgreSQL 16 con la extensión pgvector ya instalada.

### 4. Aplicar el schema

```bash
npm run migrate
```

### 5. Configurar el agente

```bash
claude       # abre Claude Code en el directorio
/setup       # wizard conversacional: caso de uso, idioma, tipos de documento
```

El wizard actualiza `src/config/rag.config.ts` con los parámetros óptimos para tu caso de uso. Tarda ~2 minutos.

### 6. Arrancar el servidor

```bash
npm run dev
```

```
[startup] pgvector extension ready
[startup] rag-agent-backbone running on http://localhost:3000
```

### 7. Verificar que todo funciona

```bash
curl http://localhost:3000/health
# → { "status": "ok", "database": "connected" }
```

### 8. Ingestar tu primer documento y preguntar

```bash
# Ingestar una URL
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -d '{"url": "https://tu-url.com/documento"}'

# Preguntar al agente
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "¿qué dice el documento sobre X?"}'
```

---

## Comandos disponibles

### Servidor

```bash
npm run dev          # desarrollo con hot reload
npm run build        # build de producción
npm run start        # arranca el build
npm run migrate      # aplica migraciones de DB
npm run seed         # datos de prueba
npm run typecheck    # verifica TypeScript sin compilar
```

### Ingestión desde CLI

```bash
npm run ingest -- --file ./mis-documentos/manual.pdf
npm run ingest -- --url https://mi-sitio.com/pagina
```

### Claude Code

Ejecuta estos comandos dentro de Claude Code (`claude`):

| Comando | Descripción |
|---------|-------------|
| `/setup` | Configura el agente para tu caso de uso (primera vez o para cambiar config) |
| `/status` | Estado actual: config RAG activa, tools habilitadas, servidor |
| `/add-tool` | Genera scaffold completo para una tool nueva |
| `/benchmark` | Tests de calidad de retrieval |
| `/explain-retrieval [query]` | Explica por qué el agente recuperó lo que recuperó |

---

## API — endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/chat` | Chat completo. Body: `{ query, conversationId?, orgId? }` |
| `GET` | `/chat/stream` | Chat streaming SSE. Query params: `query`, `conversationId?`, `orgId?` |
| `POST` | `/ingest` | Ingestar documento (multipart `file` o JSON `{ url }`) |
| `GET` | `/ingest/status/:id` | Estado de indexación |
| `GET` | `/conversations` | Listar conversaciones |
| `GET` | `/conversations/:id` | Conversación con mensajes |
| `DELETE` | `/conversations/:id` | Eliminar conversación |
| `GET` | `/health` | Health check app + DB |

### Formato de respuesta `/chat`

```json
{
  "conversationId": "uuid",
  "answer": "El tratamiento dura 45 minutos...",
  "sources": [
    {
      "id": "chunk-uuid",
      "documentTitle": "Manual de tratamientos",
      "documentSource": "https://...",
      "score": 0.87,
      "excerpt": "El tratamiento facial profundo incluye..."
    }
  ],
  "metadata": { "model": "gemini-2.5-flash", "chunksRetrieved": 3 }
}
```

### Streaming SSE (`/chat/stream`)

Los eventos llegan en este orden:

```
data: {"type":"sources","chunks":[...]}    ← fuentes, antes del primer token
data: {"type":"text","text":"El trat"}     ← tokens del LLM
data: {"type":"text","text":"amiento..."}
data: {"type":"done"}                      ← siempre al final
```

---

## Variables de entorno

Ver `.env.example` para la lista completa y comentada.

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `DATABASE_URL` | Sí | Connection string de PostgreSQL |
| `GOOGLE_API_KEY` | Sí | Gemini (embeddings + LLM) |
| `GEMINI_MODEL` | No | Modelo LLM. Default: `gemini-2.5-flash` |
| `RAG_TOP_K` | No | Chunks a recuperar. Default: `5` |
| `RAG_SIMILARITY_THRESHOLD` | No | Score mínimo de similitud. Default: `0.5` |
| `PERPLEXITY_API_KEY` | No | Habilita búsqueda web como fallback |
| `COHERE_API_KEY` | No | Habilita reranking con Cohere |
| `LANGFUSE_SECRET_KEY` | No | Habilita trazas de observabilidad |

---

## Arquitectura

```
src/
├── api/            → Hono routes (chat, ingest, conversations, health)
├── agent/
│   ├── rag-agent.ts        → Agente Mastra + memoria en Postgres
│   └── tools/              → Tools con DI (searchDocuments, searchWeb)
├── rag/
│   ├── interfaces.ts       → IEmbedder, IRetriever, IReranker
│   ├── adapters.ts         → Implementaciones concretas (wiring)
│   ├── retriever.ts        → Búsqueda vectorial pgvector (SQL <=>)
│   └── query-transformer.ts → multi-query, HyDE, step-back
├── ingestion/      → Loaders (PDF, MD, HTML, TXT, URL) + processor
├── db/             → Schema Drizzle + migraciones + client
└── config/
    └── rag.config.ts       → Configuración centralizada del agente
```

**Para añadir una tool:** `claude` → `/add-tool`
**Para cambiar el modelo de embeddings/LLM:** editar `src/config/rag.config.ts`
**Para escalar a multi-agente:** ver `docs/multi-agent-architecture.md`

---

## Deploy a producción

### Railway + Supabase (recomendado)

1. **Supabase:** nuevo proyecto → Settings → Extensions → habilitar `pgvector`
2. **Supabase:** copiar `DATABASE_URL` (Transaction pooler, port 6543)
3. **Railway:** nuevo proyecto → Deploy from GitHub
4. **Railway:** Variables → añadir `DATABASE_URL`, `GOOGLE_API_KEY`
5. El build (`npm run build`) y las migraciones se ejecutan en el deploy

### Con Docker Compose completo (VPS)

```bash
cp .env.example .env   # rellenar con keys de producción
docker-compose -f docker-compose.prod.yml up -d
```

---

## Documentación adicional

| Documento | Contenido |
|-----------|-----------|
| `specs/01-arquitectura-repo.md` | Arquitectura completa, estructura de archivos, dependencias |
| `specs/03-flujo-agentes.md` | Flujo de ejecución del agente, tools, memoria, streaming |
| `specs/04-conceptos-rag-y-config.md` | Qué es topK, embeddings, multi-query, HyDE — en lenguaje natural |
| `docs/multi-agent-architecture.md` | Cuándo y cómo escalar a múltiples agentes |
| `RAG-REFERENCE.md` | Cheatsheet de parámetros, trade-offs, debugging |

---

## Troubleshooting rápido

**El servidor no arranca:**
```
Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY
```
→ Añadir `GOOGLE_API_KEY` en `.env`

**El agente responde "I don't have information":**
→ Verificar que los documentos están ingestados: `GET /ingest/status/:id` debe devolver `status: "indexed"`
→ Bajar `RAG_SIMILARITY_THRESHOLD` a `0.4` en `.env` si los scores son bajos

**Los chunks se cortan en medio de una frase:**
→ Subir `RAG_CHUNK_OVERLAP` en `.env` o cambiar a `chunkingStrategy: "semantic"` en `rag.config.ts`

**pgvector no está disponible:**
```bash
docker-compose up -d postgres   # asegurarse de que el contenedor está corriendo
npm run migrate                 # aplicar el schema
```
