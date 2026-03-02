# Plan: Arquitectura Multi-Tenant con WhatsApp Worker Separado

## Objetivo
Reorganizar en tres servicios limpios + un agente de integración:
1. **backbone** — API, RAG, auth, channel registry
2. **whatsapp-worker** — cliente WhatsApp puro (refactor de whatsapp-rag)
3. **agent-dashboard** — SPA React en proyecto independiente (`../agent-dashboard/`) con gestión de WhatsApp por org

---

## Estado actual
- `rag-agent-backbone/` — backbone API + RAG (ya tiene orgId en docs/conversations/users)
- `whatsapp-rag/` — worker + dashboard embebido + auth proxy mezclados
- `frontend/` — SPA básica de chat (dentro de rag-agent-backbone)

## Lo que NO toca ningún agente
- Pipeline RAG existente (retriever, embedder, chunker, reranker)
- Sistema de auth (users, JWT, login/register)
- Ingesta de documentos (/ingest)
- Frontend de chat existente

---

## Sub-agente 1: Backbone — Schema + Channel API

### Archivos a crear/modificar

**`src/db/schema.ts`** — añadir tabla `whatsappSessions`:
```typescript
export const whatsappSessions = pgTable('whatsapp_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: text('org_id').notNull().unique(),
  status: text('status').notNull().default('disconnected'),
  // 'waiting_qr' | 'connected' | 'disconnected'
  qrData: text('qr_data'),        // base64 QR cuando status = waiting_qr
  phone: text('phone'),           // número vinculado cuando status = connected
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
export type WhatsappSession = typeof whatsappSessions.$inferSelect
export type NewWhatsappSession = typeof whatsappSessions.$inferInsert
```

**`src/db/migrations/0003_add_whatsapp_sessions.sql`** — nueva migración:
```sql
CREATE TABLE IF NOT EXISTS "whatsapp_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "status" text DEFAULT 'disconnected' NOT NULL,
  "qr_data" text,
  "phone" text,
  "updated_at" timestamptz DEFAULT now()
);
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_org_id_unique" UNIQUE("org_id");
```

**`src/api/channels.ts`** — NUEVO router, endpoints para el frontend (requieren JWT de usuario):
```
GET  /channels/whatsapp/status  → { status, phone } de la org del JWT
GET  /channels/whatsapp/qr      → { qrData } o 404 si no hay QR
POST /channels/whatsapp/disconnect → { ok: true }
```
- Todos filtran por `c.get('user').orgId`
- `GET /qr` solo devuelve qrData si status === 'waiting_qr'
- `POST /disconnect` borra qrData, pone status = 'disconnected'

**`src/api/internal.ts`** — NUEVO router, endpoints solo para workers (requieren JWT con `role: "worker"`):
```
POST /internal/whatsapp/qr       body: { orgId, qrData }
POST /internal/whatsapp/status   body: { orgId, status, phone? }
POST /internal/whatsapp/message  body: { orgId, messageId, body, chatId }
  → executa ragAgent.generate(body, { orgId }) con filtro org
  → responde { answer: string }
```

**`src/api/middleware/auth.ts`** — actualizar para aceptar `role: "worker"`:
- JWT de worker tiene `{ orgId, role: "worker" }` (sin userId)
- Añadir guard `requireWorker` para rutas `/internal/*`
- Mantener guard `requireUser` para rutas de usuario normal

**`src/index.ts`** — montar los nuevos routers:
```typescript
app.route('/channels', channelsRouter)
app.route('/internal', internalRouter)
```

### Restricciones
- NO modificar el schema de users, documents, conversations
- NO tocar el pipeline RAG ni los tools del agente
- Usar `db.insert(whatsappSessions).onConflictDoUpdate(...)` para upsert atómico
- El endpoint `/internal/whatsapp/message` pasa `orgId` al ragAgent para filtrar docs

---

## Sub-agente 2: Worker — Refactor de whatsapp-rag

### Objetivo
Eliminar todo lo que no sea "cliente WhatsApp + llamadas al backbone". Resultado: servicio sin servidor HTTP público, sin dashboard, sin auth propia.

### Archivos a ELIMINAR
```
src/infrastructure/http/server.ts
src/infrastructure/http/views/          (directorio completo)
src/infrastructure/auth/               (directorio completo)
```

### Archivos a MODIFICAR

**`src/shared/config.ts`** — añadir `ORG_ID`:
```typescript
const ConfigSchema = z.object({
  ORG_ID: z.string().min(1),                    // NUEVO: qué org sirve este worker
  BACKBONE_URL: z.string().url(),               // RENOMBRAR desde RAG_HOST
  JWT_SECRET: z.string().min(16),
  SESSION_PATH: z.string().default('.wwebjs_auth'),
  DEDUP_TTL_MS: z.coerce.number().int().positive().default(300_000),
  DEDUP_MAX_SIZE: z.coerce.number().int().positive().default(1000),
  // ELIMINAR: PORT, RAG_INGEST_MOCK_ENABLED, RAG_INGEST_MOCK_DELAY_MS
})
```

**`src/infrastructure/http/rag-auth.client.ts`** — actualizar JWT payload:
```typescript
// Ahora incluye orgId en el JWT de servicio
jwt.sign({ role: 'worker', orgId: config.ORG_ID }, jwtSecret, { expiresIn: '365d' })
```

**`src/infrastructure/http/backbone.client.ts`** — NUEVO (reemplaza rag-ingest.adapter.ts):
```typescript
// Tres métodos:
async reportQr(qrData: string): Promise<void>
  // POST /internal/whatsapp/qr { orgId, qrData }

async reportStatus(status: 'connected' | 'disconnected', phone?: string): Promise<void>
  // POST /internal/whatsapp/status { orgId, status, phone }

async sendMessage(messageId: string, body: string, chatId: string): Promise<string>
  // POST /internal/whatsapp/message { orgId, messageId, body, chatId }
  // returns answer
```

**`src/infrastructure/whatsapp/whatsapp-client.ts`** — reportar QR y status al backbone:
```typescript
// En ready event:
await backboneClient.reportStatus('connected', info.pushname)

// En qr event:
await backboneClient.reportQr(qr)

// En disconnected event:
await backboneClient.reportStatus('disconnected')

// En handleOutgoing — en lugar de processMessage.execute():
const answer = await backboneClient.sendMessage(rawId, msg.body, msg.from)
// El backbone ejecuta el RAG y devuelve la respuesta
```

**`src/index.ts`** — simplificar composition root:
```typescript
// ELIMINAR: createServer, incomingDedup via LruDedupCache para ingest
// MANTENER: WhatsAppListenerClient, backboneClient, graceful shutdown
// El dedup de mensajes entrantes sigue en ProcessMessageUseCase
```

**`.env.example`**:
```bash
ORG_ID=emilio                          # Qué org sirve este worker
BACKBONE_URL=http://localhost:3000     # URL del backbone
JWT_SECRET=<igual que backbone>
SESSION_PATH=.wwebjs_auth
```

### Restricciones
- NO añadir endpoints HTTP públicos
- Mantener la lógica de dedup de mensajes entrantes (LruDedupCache)
- Mantener la lógica de body-dedup para respuestas propias (sentBodies Map)
- El worker NO conoce nada de RAG, no llama a /chat directamente

---

## Sub-agente 3: Frontend — Tab de WhatsApp

### Archivos a crear/modificar en `frontend/`

**`src/api/channels.ts`** — NUEVO: cliente para la channels API:
```typescript
// Usa el JWT que ya tiene el usuario logueado
getWhatsappStatus(): Promise<{ status: string, phone?: string }>
getWhatsappQr(): Promise<{ qrData: string } | null>
disconnectWhatsapp(): Promise<void>
```

**`src/components/WhatsAppPanel.tsx`** — NUEVO componente:
- Si `status === 'connected'`: mostrar "✓ Conectado — +34600..." + botón Desconectar
- Si `status === 'waiting_qr'`: mostrar QR con polling cada 3s + instrucciones
- Si `status === 'disconnected'`: mostrar "Sin sesión activa" + (QR llegará automáticamente cuando el worker arranque)
- Auto-poll: `useEffect` con `setInterval(3000)` para `getWhatsappStatus`

**`src/App.tsx`** — añadir tab/sección "WhatsApp":
- Tabs: "Chat" | "WhatsApp" (o sidebar item)
- Renderizar `<WhatsAppPanel />` en la tab de WhatsApp

### Restricciones
- NO crear servidor propio ni proxy
- Usar el mismo JWT del login para todas las llamadas
- Mostrar QR como `<img src={qrDataUrl} />` (el backbone devuelve base64 o URL)
- Polling solo cuando la tab está activa (pause on blur)

---

## Sub-agente 4: Orquestación e Integración

### Verificaciones post-implementación

1. **Schema y migración**: confirmar que `0003_add_whatsapp_sessions.sql` aplica sin errores
2. **JWT worker**: verificar que el backbone acepta tokens con `{ role: "worker", orgId: "..." }` en rutas `/internal/*` y los rechaza en rutas de usuario
3. **Aislamiento de org**: confirmar que `/internal/whatsapp/message` con `orgId: "emilio"` solo devuelve docs de org "emilio"
4. **QR flow**: simular el flujo completo — worker arranca → POST /internal/whatsapp/qr → frontend GET /channels/whatsapp/qr devuelve QR
5. **Message flow**: mensaje entra → worker POST /internal/whatsapp/message → backbone ejecuta RAG → worker recibe answer → sendMessage
6. **Aislamiento negativo**: confirmar que usuario de org "acme" NO ve QR ni sesión de org "emilio"

### Archivos de configuración a actualizar
- `rag-agent-backbone/.env.example` → añadir comentario sobre endpoints `/channels/` e `/internal/`
- `whatsapp-rag/.env.example` → reemplazar RAG_HOST por BACKBONE_URL, añadir ORG_ID
- `whatsapp-rag/package.json` → actualizar scripts si cambian entry points

### Railway deployment
- `whatsapp-rag` (Railway) — añadir env var `ORG_ID`
- Renombrar `RAG_HOST` → `BACKBONE_URL` en Railway service vars
- No se necesitan nuevos servicios de Railway para el backbone (ya existe)

---

## Orden de ejecución (dependencias)

```
Sub-agente 1 (backbone)  ←── debe terminar primero
       ↓
Sub-agente 2 (worker)    ←── necesita saber los endpoints del backbone
Sub-agente 3 (frontend)  ←── puede correr en paralelo con Sub-agente 2
       ↓
Sub-agente 4 (integración) ←── verifica que todo funciona junto
```

Sub-agentes 2 y 3 pueden ejecutarse en paralelo una vez el Sub-agente 1 termine.

---

## Traza de Ejecución

```
Fase 0: Setup (pre-requisitos)                            ✅ COMPLETADO
  └─ Instalar Tailwind CSS v4 en agent-dashboard/

Fase 1: Backbone — Schema + Channel API + Internal API    ✅ COMPLETADO
  ├─ ✅ Migración 0003 aplicada, tabla whatsappSessions existe
  ├─ ✅ Endpoints /channels/* autentican con JWT user
  ├─ ✅ Endpoints /internal/* autentican con JWT worker
  └─ ✅ Worker tokens rechazados en rutas de usuario (bug encontrado y corregido)

Fase 2a: Worker — Refactor (en paralelo con 2b)           ✅ COMPLETADO
  ├─ ✅ Eliminados server.ts, views/, auth/, rag-auth.client.ts, rag-ingest.adapter.ts
  ├─ ✅ BackboneClient con reportQr(), reportStatus(), sendMessage()
  ├─ ✅ WhatsAppClient reporta QR/status/disconnect al backbone
  └─ ✅ Typecheck limpio

Fase 2b: Frontend — WhatsApp Panel (en paralelo con 2a)   ✅ COMPLETADO
  ├─ ✅ Proyecto independiente en ../agent-dashboard/
  ├─ ✅ src/api/channels.ts + src/api/auth.ts
  ├─ ✅ src/hooks/usePolling.ts (con pause on blur)
  ├─ ✅ src/components/WhatsAppPanel.tsx + Login.tsx
  ├─ ✅ App.tsx con sidebar + tabs + auth
  └─ ✅ Build limpio con Tailwind v4

Fase 3: Integración                                        ✅ COMPLETADO
  ├─ ✅ Auth: 6/6 tests passed (user JWT, worker JWT, API key, unauthorized)
  ├─ ✅ QR flow: 10/10 tests passed (report → read → org isolation)
  ├─ ✅ Message flow: worker→backbone→RAG→reply verified
  ├─ ✅ Aislamiento negativo: user org=emilio NO ve datos de org=test-org
  ├─ ✅ .env.example actualizados en backbone y worker
  └─ ✅ Dockerfiles actualizados (worker sin EXPOSE, dashboard con nginx)
```

## Deployment — Railway Checklist

### Servicio: rag-agent-backbone (ya existe)
Añadir variables en Railway dashboard:
```
JWT_SECRET=<openssl rand -hex 32>     # compartido con worker
ADMIN_USERNAME=<admin>                # auto-create admin on first boot
ADMIN_PASSWORD=<password>
```
Ejecutar migración antes del deploy: `npm run migrate`

### Servicio: whatsapp-worker (renombrar desde whatsapp-rag)
Variables a **añadir**:
```
ORG_ID=<id-de-la-org>                # ej: "emilio"
JWT_SECRET=<mismo que backbone>
```
Variables a **renombrar**:
```
RAG_HOST → BACKBONE_URL              # apuntar a URL interna de Railway del backbone
```
Variables a **eliminar**:
```
PORT                                  # ya no hay servidor HTTP
```
Nota: mantener volumen persistente para `.wwebjs_auth/`

### Servicio: agent-dashboard (NUEVO)
Crear nuevo servicio Railway (static site o Docker):
```
VITE_API_URL=https://<backbone-url>   # build-time variable
```
Si Railway static hosting: apuntar al repo + build command `npm run build` + output `dist/`
Si Docker: usa el Dockerfile incluido (nginx + SPA routing)

---

## Archivos que NO se tocan en ningún caso
- `src/rag/` (todo el pipeline RAG)
- `src/ingestion/` (todo el ingestion pipeline)
- `src/agent/tools/` (herramientas del agente)
- `src/config/rag.config.ts`
- `src/config/tools.config.ts`
- `src/db/migrations/0000_*.sql`, `0001_*.sql`, `0002_*.sql`
- `frontend/src/components/ChatView.tsx`, `MessageBubble.tsx`, `Sidebar.tsx`
