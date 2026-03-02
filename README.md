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

## Por qué funciona bien

Este agente no es un wrapper básico sobre un LLM. Cada capa del pipeline está diseñada para maximizar la calidad de recuperación y la utilidad de las respuestas. Aquí están las decisiones clave.

---

### 1. El pipeline RAG — 7 pasos en orden estricto

```
Query del usuario
       ↓
[1] Decisión: ¿ingestar o responder?  ← rag-agent.ts (instrucciones INGEST vs ANSWER)
       ↓ (responder)
[2] Embedding de la query              ← gemini-embedding-001 (768 dims)
       ↓
[3] Retrieval vectorial                ← pgvector cosine similarity (<=>)
       ↓
[4] ¿Menos de 3 chunks?               ← search-documents.ts
       ↓ sí
[5] Multi-query expansion              ← query-transformer.ts (genera 3 variantes)
       ↓
[6] Reranking (opcional)              ← reranker.ts (Cohere o local)
       ↓
[7] Generación con contexto           ← Gemini 2.5 Flash
```

**Fichero relevante:** `src/agent/tools/search-documents.ts` — orquesta los pasos 2-6.

---

### 2. Vision AI con prompt de dominio — la diferencia entre "describe el thumbnail" y "extrae la receta"

Cuando un vídeo de YouTube no tiene transcript disponible, el agente analiza las imágenes del vídeo (thumbnail + 3 fotogramas automáticos) con Gemini Vision. El resultado varía drásticamente según el prompt:

**Prompt genérico (malo):**
```
"Describe lo que ves: tema principal, elementos visuales clave, personas, objetos..."
→ "El thumbnail muestra un plato sobre fondo oscuro con iluminación cálida y
   tonos dorados que comunican de manera efectiva que se trata de una receta..."
```

**Prompt de dominio (bueno):**
```
"Describe detalladamente: nombre del plato, ingredientes principales visibles,
técnica de preparación, si es saludable, tipo de comida (desayuno/cena/snack)..."
→ "Receta: Batata rellena de proteína. Ingredientes: batata grande, huevo,
   queso rallado, pavo en lonchas. Preparación en sartén, aprox. 10 min.
   Tipo: cena ligera y saludable, alta en proteína."
```

La diferencia es total: el primer texto no matchea con "¿qué puedo cenar?", el segundo sí.

**Cómo se configura:**
```env
# Railway / .env
VISION_AI_PROMPT=Este es el thumbnail de un video de recetas llamado "{title}". \
  Describe detalladamente: nombre del plato o receta, ingredientes principales \
  visibles, técnica de preparación, si es saludable o indulgente, tiempo estimado \
  de preparación si se indica, tipo de comida (desayuno/comida/cena/snack).
```

O por colección en el markdown de ingesta con `@vision:`:
```markdown
# comida
@vision: Este es el thumbnail de un video de recetas llamado "{title}". Describe...
https://youtu.be/...
```

**Ficheros relevantes:** `src/ingestion/loaders/youtube.ts` (función `generateVisualDescription`), `food-videos.md`.

---

### 3. Multi-query expansion — más recall cuando los chunks son pocos

Si la búsqueda inicial devuelve menos de 3 chunks, el agente genera automáticamente variantes semánticas de la query y busca con cada una:

```typescript
// src/agent/tools/search-documents.ts
if (ragConfig.queryEnhancement !== "none" && chunks.length < 3) {
  // Genera: "recetas fáciles para cenar", "ideas de cena rápida", "platos de noche"
  const expanded = await transformQuery(query, "multi-query", llm, 3);
  // Busca con threshold 20% más bajo (0.5 * 0.8 = 0.4) para mayor recall
  const expandedChunks = await retriever.retrieveMultiQuery(embeddings, {
    similarityThreshold: ragConfig.similarityThreshold * 0.8,
  });
  // Merge: si el mismo chunk aparece en varias queries, se queda con el score más alto
}
```

Esto resuelve el problema clásico de RAG donde una query específica no matchea exactamente con cómo está escrito el contenido.

**Ficheros relevantes:** `src/rag/query-transformer.ts`, `src/rag/retriever.ts` (`retrieveMultiQuery`).

---

### 4. Decisión de intención — el agente elige entre guardar o responder

El agente no es solo un buscador. Detecta automáticamente si el usuario quiere guardar información o hacer una pregunta:

```
"https://youtu.be/abc123"           → llama saveNote (URL detectada)
"guardar: receta del bocadillo..."  → llama saveNote (keyword de ingestión)
"¿qué puedo cenar hoy?"            → llama searchDocuments
"¿qué es la pasta carbonara?"      → llama searchDocuments (sin resultados → searchWeb)
```

Esto permite usar el mismo endpoint `/chat` tanto para ingestar como para consultar — el WhatsApp listener solo hace POST /chat con el texto del mensaje y el agente decide qué hacer.

**Fichero relevante:** `src/agent/rag-agent.ts` (sección `== INGEST vs ANSWER ==`).

---

### 5. Memoria conversacional en PostgreSQL

El agente recuerda las últimas 20 mensajes (10 pares usuario/asistente) de cada conversación, almacenados en el schema `mastra` de la misma PostgreSQL. Esto permite:

- Preguntas de seguimiento: "¿y esa receta es rápida?" (sin repetir el contexto)
- Conversaciones multi-turno coherentes desde WhatsApp

```typescript
// src/agent/rag-agent.ts
const memory = new Memory({
  storage: new PostgresStore({ connectionString, schemaName: "mastra" }),
  options: { lastMessages: 20, semanticRecall: false },
});

// Uso correcto (Mastra 1.5):
agent.generate(query, { memory: { thread: conversationId, resource: orgId } });
```

**Nota crítica:** `resource` no es `orgId` arbitrario — debe ser consistente por usuario/sesión para que la memoria funcione. El WhatsApp listener usa `whatsapp-${chatId}` como resource.

---

### 6. pgvector con cosine similarity — búsqueda semántica nativa en Postgres

No hay base de datos vectorial separada. La búsqueda semántica vive en la misma PostgreSQL con la extensión pgvector:

```sql
-- src/rag/retriever.ts
SELECT dc.id, dc.content, d.title,
  1 - (dc.embedding <=> '[0.1, 0.2, ...]'::vector) as similarity_score
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE dc.embedding IS NOT NULL
  AND d.status = 'indexed'
  AND 1 - (dc.embedding <=> '[...]'::vector) >= 0.3   -- threshold
ORDER BY dc.embedding <=> '[...]'::vector
LIMIT 5
```

El operador `<=>` calcula distancia coseno. `1 - distancia = similitud`. Soporta filtrado por `org_id` para multi-tenancy.

---

### 7. Parámetros críticos de configuración

| Variable | Valor prod | Por qué importa |
|----------|-----------|-----------------|
| `RAG_SIMILARITY_THRESHOLD` | `0.3` | Umbral bajo = más recall. Con Vision AI los scores son ~0.45-0.65, no 0.8+ |
| `RAG_TOP_K` | `5` | Chunks por query. Con multi-query esto se multiplica |
| `RAG_QUERY_ENHANCEMENT` | `multi-query` | Activa expansión cuando hay < 3 chunks |
| `VISION_AI_PROMPT` | prompt de dominio | **El más crítico.** Sin él, Vision AI describe estética en vez de contenido útil |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Balance calidad/velocidad/coste |

---

### Arquitectura

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
