# Worker ↔ Backbone Communication Protocol

## JWT Worker Token

```typescript
// Payload del JWT que emite el worker
{
  role: "worker",    // discriminante — NO es "user"
  orgId?: string,    // optional — system workers (multi-org) may omit it
  // sin userId — los workers no representan usuarios
}
```

- El backbone valida con `requireWorker` middleware
- Secret compartido via env var `JWT_SECRET` (mismo en backbone y worker)
- El worker genera su JWT al arrancar y lo reutiliza en todas las requests

## Endpoints Internos — Body Schemas

### GET /internal/whatsapp/sessions
```typescript
// No request body

// Response 200
{ data: [{ userId: string, orgId: string }] }  // all non-disconnected sessions
```

### POST /internal/whatsapp/qr
```typescript
// Request body
{ userId: string, qrData: string }  // userId is UUID of the user

// Response 200
{ data: { status: "qr", userId: string, orgId: string } }

// Response 404
{ error: "User not found" }
```

### POST /internal/whatsapp/status
```typescript
// Request body
{
  userId: string,                          // UUID of the user
  status: "connected" | "disconnected",
  phone?: string                           // solo cuando status = "connected"
}

// Response 200
{ data: { status: string, userId: string, orgId: string, phone?: string } }

// Response 404
{ error: "User not found" }
```

### POST /internal/whatsapp/message
```typescript
// Request body
{
  userId: string,      // UUID of the user
  messageId: string,   // ID unico del mensaje WhatsApp
  body: string,        // texto del mensaje
  chatId: string,      // ID del chat de WhatsApp
}

// Response 200 (respuesta del RAG agent)
{ data: { reply: string } }

// Response 404
{ error: "User not found" }

// Response 503 (RAG no disponible)
{ error: "RAG agent unavailable" }
```

## Flow de autenticacion worker

```
1. Worker arranca con JWT_SECRET en env
2. Worker genera JWT: sign({ role: "worker" }, JWT_SECRET)
3. Worker calls GET /internal/whatsapp/sessions to discover active sessions
4. For each session, worker sends requests with userId in body
5. Worker envia requests con: Authorization: Bearer <worker-jwt>
6. Backbone middleware `requireWorker`:
   a. Verifica JWT
   b. Rechaza si role !== "worker"
   c. Opcionalmente extrae orgId from JWT (legacy single-org workers)
```

## Errores estandar

| Status | Significado |
|--------|------------|
| 401 | JWT invalido o expirado |
| 403 | role no es "worker" |
| 400 | Body no pasa validacion Zod |
| 404 | User not found (userId invalid) |
| 503 | Servicio interno no disponible |
