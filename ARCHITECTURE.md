# Arquitectura Técnica — RAG Agent + YouTube Vision AI

## Qué es este sistema

Un agente RAG (Retrieval-Augmented Generation) de producción, especializado en responder preguntas sobre contenido de YouTube sin necesidad de que los vídeos tengan subtítulos ni transcripción. Parte de un backbone genérico pero con una capa de ingesta de YouTube completamente custom que usa Vision AI multimodal para extraer información de los vídeos.

---

## Stack

| Capa | Tecnología | Por qué |
|------|-----------|---------|
| Runtime | Node.js + TypeScript strict | Type safety end-to-end |
| API | Hono | Edge-first, SSE nativo, sin overhead de Express |
| Orquestación LLM | Mastra.ai 1.5 | Agentes con tools + Memory nativo en TypeScript |
| Vector DB | PostgreSQL + pgvector | Un solo DB para todo: docs, chunks, conversaciones |
| ORM | Drizzle | SQL-first, lightweight, sin magia negra |
| Embeddings | Gemini `gemini-embedding-001` | 768 dimensiones, misma API key que el LLM |
| LLM | Gemini `gemini-2.5-flash` | Multimodal (texto + imagen), rápido, barato |
| Frontend | React + Vite + TypeScript | SSE streaming nativo, sin dependencias de estado complejas |

---

## Arquitectura general

```
Usuario
  │
  ▼
Frontend (React, :5173)
  │  POST /chat  o  GET /chat/stream (SSE)
  ▼
API Hono (:3000)
  │
  ▼
Mastra Agent (rag-agent.ts)
  │  decide qué tool llamar según el sistema de reglas
  ├─▶ searchDocuments tool  ──▶  RAG Pipeline  ──▶  pgvector (PostgreSQL)
  └─▶ searchWeb tool        ──▶  Perplexity Sonar API  (fallback, desactivado por defecto)
  │
  ▼
Respuesta en streaming (SSE: sources → text → done)
```

---

## Pipeline RAG — paso a paso

Cuando el agente llama a `searchDocuments`, se ejecuta este pipeline (en `src/agent/tools/search-documents.ts` + `src/agent/workflow.ts`):

### Paso 1: Embedding de la query
```
query del usuario  →  Gemini gemini-embedding-001  →  vector de 768 dimensiones
```

### Paso 2: Retrieval con pgvector
SQL real que se ejecuta en PostgreSQL:
```sql
SELECT dc.content, d.title, d.source,
       1 - (dc.embedding <=> '[0.12, -0.34, ...]'::vector) AS similarity_score
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE dc.embedding IS NOT NULL
  AND d.status = 'indexed'
  AND d.org_id = 'comida'          -- filtra por colección (multi-tenancy)
  AND 1 - (dc.embedding <=> ...) >= 0.5   -- threshold de similitud
ORDER BY dc.embedding <=> ...
LIMIT 5                             -- topK = 5
```

El operador `<=>` es de pgvector: calcula distancia coseno. `1 - distancia = similitud`. El threshold está en 0.5 (bajado de 0.7 porque los embeddings de Gemini dan scores entre 0.57-0.67 para contenido relevante).

### Paso 3: Expansión automática (multi-query)
**Si se recuperan menos de 3 chunks**, el sistema activa la expansión de query automáticamente:
- Gemini genera 3 variaciones de la query original desde ángulos distintos
- Se hace retrieval independiente para cada variación (con threshold rebajado un 20%: 0.5 × 0.8 = 0.4)
- Los resultados se fusionan: deduplicación por `chunk.id`, se queda el score más alto
- Se ordena por score y se limita a topK=5

**Si se recuperan 3 o más chunks** → pasa directo al LLM sin expansión.

Este branching condicional está implementado como un workflow de Mastra con `.branch()`.

### Paso 4: Generación
Los chunks recuperados se formatean como contexto y se pasan al agente Gemini 2.5 Flash junto con el historial de conversación. El LLM responde en streaming (SSE).

---

## Sistema de reglas del agente

El agente sigue un sistema de prioridades estricto (en `src/agent/rag-agent.ts`):

```
1. Solo frases sociales puras ("hola", "gracias") → responde sin tools
2. TODO lo demás → SIEMPRE llama searchDocuments primero
3. searchDocuments devuelve chunks > 0 → responde INMEDIATAMENTE con esos chunks. NO llama searchWeb.
4. searchDocuments devuelve chunks > 0 pero necesita más contexto → responde + hace una pregunta de seguimiento
5. searchDocuments devuelve 0 chunks → llama searchWeb como fallback
6. searchWeb tampoco encuentra nada → pide más contexto al usuario
7. NUNCA responde desde conocimiento propio. Solo de los resultados de las tools.
```

Esto evita que el LLM "alucine" o responda desde su conocimiento previo en lugar de los documentos indexados.

---

## Memoria de conversación

Implementada con `@mastra/memory` + `PostgresStore`:
- Se guarda en el mismo PostgreSQL, en el schema `mastra` (separado del schema principal para no colisionar)
- Estrategia: ventana fija de los últimos 20 mensajes (10 pares usuario/asistente)
- Cada conversación tiene un `threadId` (= `conversationId`) y un `resourceId` (= `orgId`)

**Error crítico que se detectó y corrigió**: la API correcta de Mastra 1.5 es:
```typescript
// CORRECTO:
agent.generate(query, { memory: { thread: conversationId, resource: orgId } })

// INCORRECTO (los campos se ignoran silenciosamente):
agent.generate(query, { threadId: conversationId, resourceId: orgId })
```
La API incorrecta hacía que Memory se inicializase a medias y el loop de tool-calls del LLM nunca recibía los resultados de las tools.

---

## Multi-tenancy (colecciones)

El campo `org_id` en la tabla `documents` permite aislar colecciones completamente:

- `orgId: "comida"` → solo recupera chunks de vídeos de recetas
- `orgId: "cs2"` → solo recupera chunks de vídeos de Counter-Strike
- Sin `orgId` → recupera de TODAS las colecciones (modo multi-dominio)

El frontend lo controla con la variable de entorno `VITE_ORG_ID`. Vacía = multi-dominio.

---

## Pipeline de ingesta de YouTube

Este es el bloque más custom del sistema. Para cada URL de YouTube:

### 1. Extracción del videoId
Soporta todos los formatos:
```
youtube.com/watch?v=ID
youtube.com/shorts/ID
youtu.be/ID
```

### 2. Metadata (en paralelo con la transcripción)
**Fuente primaria**: YouTube Data API v3 (`googleapis.com/youtube/v3/videos`)
- Requiere `YOUTUBE_API_KEY` o `GOOGLE_API_KEY`
- Devuelve: título, descripción completa, canal, duración ISO 8601, tags, URL del thumbnail
- La `snippet.description` es crítica: muchos creadores ponen la receta/instrucciones completas aquí

**Fallback** si no hay API key: scraping del HTML de YouTube con Cheerio
- Lee Open Graph tags (`og:title`, `og:description`, `og:image`)
- Extrae canal del JSON embebido `ytInitialData` con regex (`"author":"..."`)
- Desventaja: duración desconocida, descripción limitada a la que aparece en OG tags

### 3. Transcripción (en paralelo con metadata)
Librería `youtube-transcript`:
- Llama a la API pública de YouTube que sirve los subtítulos/captions
- Funciona si el vídeo tiene captions activadas (auto-generadas o manuales)
- Falla silenciosamente en Shorts y vídeos sin subtítulos → devuelve `null`

### 4. Vision AI con 4 imágenes (solo si no hay transcripción)

Si no hay transcripción, se activa el análisis visual con Gemini 2.5 Flash multimodal.

**Las 4 imágenes que se descargan:**
```
https://i.ytimg.com/vi/{videoId}/hqdefault.jpg   ← thumbnail oficial (alta calidad, ~10-36 KB)
https://img.youtube.com/vi/{videoId}/1.jpg        ← frame auto al ~25% del vídeo (~2-4 KB)
https://img.youtube.com/vi/{videoId}/2.jpg        ← frame auto al ~50% del vídeo (~2-4 KB)
https://img.youtube.com/vi/{videoId}/3.jpg        ← frame auto al ~75% del vídeo (~2-4 KB)
```

Las URLs `1.jpg`, `2.jpg`, `3.jpg` son un patrón estable del CDN de YouTube (existente desde ~2010, no documentado oficialmente pero ampliamente conocido). YouTube los genera automáticamente al procesar cada vídeo, capturando frames en distintos momentos de la línea de tiempo.

**Por qué 4 imágenes en lugar de 1:**
Con solo el thumbnail (imagen del 0%), Gemini solo ve el plato terminado o la portada. Con los 3 frames automáticos, ve el proceso completo del vídeo: preparación inicial, pasos intermedios, resultado final. Esto permite describir ingredientes que aparecen en el proceso, la técnica de cocción, pasos de preparación, etc.

**Cómo se llama a Gemini:**
```typescript
const result = await model.generateContent([
  { inlineData: { mimeType: "image/jpeg", data: base64_hqdefault } },
  { inlineData: { mimeType: "image/jpeg", data: base64_frame1 } },
  { inlineData: { mimeType: "image/jpeg", data: base64_frame2 } },
  { inlineData: { mimeType: "image/jpeg", data: base64_frame3 } },
  "prompt de análisis...",
]);
```
Gemini 2.5 Flash es multimodal: acepta múltiples imágenes + texto en un solo request. Analiza las 4 imágenes conjuntamente y genera una descripción cohesionada.

**Prompt**: viene del `@vision:` del archivo markdown de ingesta. Si no hay directiva `@vision:`, usa un prompt genérico. El placeholder `{title}` se reemplaza por el título real del vídeo en runtime.

### 5. Cadena de prioridad de contenido
```
1. Transcripción real (captions)    → label "Transcripción:" en el documento
2. Vision AI (4 imágenes)           → label "Análisis visual:" en el documento
3. Anotación manual (línea ">")     → label "Notas del curador:" (solo si 1 y 2 fallaron)
4. Solo metadata                    → título + canal + duración + descripción de YouTube
```

La descripción de YouTube (`snippet.description`) siempre se incluye, independientemente de si hay transcripción o Vision AI. En muchos casos es la fuente más rica de información.

### 6. Documento final que se embebe
```
{título del vídeo}
Canal: {nombre del canal}
Duración: {MM:SS o H:MM:SS}
Tags: {tag1, tag2, ...}

{descripción completa de YouTube}

Transcripción: / Análisis visual: / Notas del curador:
{texto}
```

Todo esto se convierte en el contenido que Gemini embeddings convierte en un vector de 768 dimensiones.

### 7. Chunking
Estrategia `fixed` con chunkSize=512 tokens (~2048 chars) y overlap=50 tokens (~200 chars).
Un vídeo de receta típico produce 2-4 chunks.

### 8. Storage en PostgreSQL
```
documents table:    título, fuente (URL canónica), orgId, status, metadata (jsonb)
document_chunks:    content, embedding (vector 768), chunk_metadata (jsonb)
```

La columna `embedding` usa el tipo `vector(768)` de pgvector con índice `ivfflat` para búsqueda aproximada de vecinos más cercanos.

---

## Formato del archivo de ingesta markdown

```markdown
# nombre-coleccion                 ← se convierte en orgId
@vision: Prompt personalizado para Vision AI. Usa {title} para el título del vídeo.
https://youtube.com/shorts/ID1
https://youtu.be/ID2
> Anotación manual para el vídeo anterior (si no hay transcript ni visual)
https://youtube.com/watch?v=ID3

# otra-coleccion
@vision: Otro prompt distinto...
https://youtube.com/shorts/ID4
```

**Directivas:**
- `# nombre` → nueva colección (orgId). Resetea el `@vision:` actual.
- `@vision: texto` → prompt de Vision AI para todos los vídeos de esta sección. Acepta `{title}`.
- `> texto` → anotación manual para el último vídeo parseado.

---

## Variables de entorno clave

| Variable | Uso |
|----------|-----|
| `GOOGLE_API_KEY` | Embeddings (Gemini), Vision AI (Gemini), metadata de YouTube (Data API v3) |
| `YOUTUBE_API_KEY` | Metadata de YouTube (alternativa, prioridad sobre GOOGLE_API_KEY para metadata) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Alternativa a GOOGLE_API_KEY para Gemini |
| `DATABASE_URL` | PostgreSQL con pgvector |
| `GEMINI_MODEL` | Modelo LLM (default: `gemini-2.5-flash`) |
| `RAG_TOP_K` | Chunks a recuperar (default: 5) |
| `RAG_SIMILARITY_THRESHOLD` | Threshold de similitud coseno (default: 0.7, nosotros usamos 0.5) |
| `RAG_CHUNK_SIZE` | Tamaño de chunk en tokens (default: 512) |
| `ENABLE_SEARCH_WEB` | `false` para desactivar searchWeb aunque haya PERPLEXITY_API_KEY |
| `VISION_AI_PROMPT` | Override global del prompt de Vision AI (lo sobreescribe el `@vision:` del markdown) |
| `VITE_ORG_ID` | (Frontend) Colección a consultar. Vacío = todas las colecciones. |

---

## Estructura de ficheros relevantes

```
src/
├── agent/
│   ├── rag-agent.ts          ← Mastra Agent: LLM + tools + Memory. Sistema de reglas.
│   ├── workflow.ts            ← Pipeline con branching condicional (< 3 chunks → expand)
│   └── tools/
│       ├── index.ts           ← Tool registry: filtra por toolsConfig
│       ├── search-documents.ts ← Tool que ejecuta el RAG pipeline
│       └── search-web.ts      ← Tool Perplexity (fallback, desactivado por defecto)
├── rag/
│   ├── adapters.ts            ← Singletons: defaultEmbedder, pgvectorRetriever, defaultReranker
│   ├── embeddings.ts          ← Gemini gemini-embedding-001
│   ├── retriever.ts           ← SQL pgvector: retrieve() + retrieveMultiQuery()
│   ├── chunker.ts             ← fixed / semantic / hierarchical
│   └── query-transformer.ts  ← multi-query expansion con Gemini
├── ingestion/
│   ├── loader.ts              ← Dispatcher: detecta tipo (YouTube, web, PDF, local)
│   ├── processor.ts           ← chunk → embed → store en DB
│   └── loaders/
│       └── youtube.ts         ← Pipeline completo de YouTube (metadata + transcript + Vision AI)
├── config/
│   ├── rag.config.ts          ← Toda la configuración RAG centralizada
│   └── tools.config.ts        ← Enable/disable tools por variable de entorno
├── api/
│   └── chat.ts                ← Endpoints POST /chat y GET /chat/stream (SSE)
└── db/
    ├── schema.ts              ← Drizzle: documents, document_chunks, conversations, messages
    └── client.ts              ← Pool de conexiones PostgreSQL

scripts/
└── ingest-youtube.ts          ← CLI: parsea markdown → llama loadDocument() → processDocument()

frontend/
└── src/
    ├── api/client.ts          ← streamChat(): SSE consumer, envía orgId si VITE_ORG_ID está set
    └── components/
        └── MessageBubble.tsx  ← Renderiza fuentes como links clicables a YouTube
```

---

## Preguntas frecuentes técnicas

**¿Por qué PostgreSQL y no Pinecone o Weaviate?**
Un solo servicio para datos relacionales (conversaciones, documentos) y búsqueda vectorial. Menos infraestructura, costes menores, transacciones ACID entre tablas. pgvector es suficientemente rápido para colecciones de cientos de miles de chunks.

**¿Por qué Gemini y no OpenAI?**
Una sola API key para LLM + embeddings + Vision AI. Los embeddings de `gemini-embedding-001` son de 768 dimensiones (vs 1536 de OpenAI `text-embedding-3-small`), lo que reduce el tamaño de los vectores a la mitad sin pérdida notable de calidad en dominios específicos.

**¿Por qué el threshold está en 0.5 y no en 0.7?**
Los embeddings de Gemini tienen una distribución de scores diferente a OpenAI. Contenido claramente relevante aparece con scores de 0.57-0.67. Con 0.7, el retrieval devuelve 0 chunks y el agente no puede responder.

**¿Qué pasa si un vídeo no tiene transcripción?**
Cascada: (1) se intenta youtube-transcript → null. (2) Se descargan 4 imágenes (thumbnail + 3 frames automáticos) y se pasan a Gemini Vision en un solo request. (3) Si hay anotación manual (`>`) y tampoco hay visual, se inyecta esa anotación. (4) Si nada funciona, se indexa solo con metadata (título + canal + duración + descripción de YouTube).

**¿Gemini Vision ve el vídeo completo?**
No. Ve 4 imágenes estáticas: el thumbnail oficial (la imagen de portada del vídeo) más 3 frames capturados automáticamente por YouTube al procesar el vídeo (~25%, ~50%, ~75% de duración). No tiene acceso al audio ni puede analizar movimiento. Sin embargo, esto es suficiente para vídeos de recetas (donde los frames muestran los pasos de preparación) y tutoriales visuales.

**¿Qué es el multi-query expansion?**
Si la búsqueda inicial devuelve menos de 3 chunks, se asume que la query original puede ser ambigua o estar formulada de una manera que no casa bien con el texto indexado. Gemini genera 3 reformulaciones de la misma pregunta desde ángulos distintos, se hace retrieval para cada una, y se fusionan los resultados eliminando duplicados. Mejora el recall sin sacrificar precisión.

**¿Cómo funciona la memoria de conversación?**
Mastra mantiene un historial por `threadId` (ID de conversación) guardado en PostgreSQL. En cada llamada al agente se cargan los últimos 20 mensajes del hilo. El agente los recibe como contexto adicional, lo que permite referencias a mensajes anteriores ("el que me dijiste antes", "la receta de ayer").

**¿Cómo se añade una nueva colección?**
Crear un archivo markdown con el formato documentado, ejecutar:
```bash
npm run ingest:youtube -- --file ./mi-coleccion.md
```
El sistema crea la colección automáticamente (el `org_id` no requiere setup previo en DB).
