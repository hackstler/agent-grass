# API Design Rules

## Stack
- **Hono** para todas las rutas. No usar Express, Fastify ni otros.
- Cada router es un archivo separado en `src/api/`. Montados en `src/index.ts`.
- Usar `hono/cors`, `hono/logger`, `hono/secure-headers` como middleware global.

## Endpoints REST
- Seguir este esquema de rutas:
  - `POST /ingest` — crear recurso (ingestión)
  - `GET /ingest/status/:id` — leer estado
  - `POST /chat` — acción (no es CRUD puro)
  - `GET /chat/stream` — SSE streaming
  - `GET /conversations` — listar
  - `GET /conversations/:id` — detalle
  - `DELETE /conversations/:id` — eliminar
  - `GET /health` — health check

## Response format
```typescript
// Success
{ data: T }  // o directamente T si es obvio

// Error — SIEMPRE con ambos campos
{ error: "Category", message: "detail" }
// Ejemplo: { error: "NotFound", message: "User 'abc' not found" }
// Categorías: NotFound, Conflict, Validation, Unauthorized, Forbidden, InternalError

// Paginado
{ items: T[], total: number, cursor?: string }
```

## HTTP status codes
- `200` — OK (GET, acción completada)
- `201` — Created (POST que crea recurso)
- `400` — Bad Request (validación fallida)
- `404` — Not Found
- `500` — Internal Server Error
- `503` — Service Unavailable (DB down, en health check)

## Validación
- Validar **siempre** con Zod antes de procesar.
- Limitar tamaño de archivos (50MB máx en `/ingest`).
- Sanitizar queries: `z.string().min(1).max(10_000)` para queries de chat.

## SSE Streaming
- Content-Type: `text/event-stream`
- Formato de eventos: `data: ${JSON.stringify(event)}\n\n`
- Tipos de evento: `sources`, `text`, `done`, `error`
- Emitir `sources` primero (antes del primer token de texto).
- Emitir `done` al final siempre, incluso si hay error.

## Error handling
- Usar `app.onError()` como fallback global.
- Loggear errores con contexto (route, params).
- No exponer stack traces en producción.
- En streaming: emitir `{ type: "error", message: "..." }` y cerrar el stream.

## Autenticación (cuando se active)
- Header `X-API-Key` para autenticación simple por API key.
- Header `Authorization: Bearer <jwt>` para JWT.
- Implementar como middleware, no en cada route handler.
