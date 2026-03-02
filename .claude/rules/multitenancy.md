# Multi-Tenancy Rules

## Tabla `whatsappSessions`

Schema con Drizzle en `src/infrastructure/db/schema.ts`:

```typescript
export const whatsappSessions = pgTable('whatsapp_sessions', {
  id:        uuid('id').defaultRandom().primaryKey(),
  orgId:     text('org_id').notNull(),
  userId:    uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  status:    text('status').notNull().default('disconnected'), // disconnected | pending | qr | connected
  qrData:    text('qr_data'),
  phone:     text('phone'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
```

- Migrated from per-org to per-user in `0002_whatsapp_per_user.sql`
- Upsert con `onConflictDoUpdate` sobre `userId` (one session per user)
- `orgId` is denormalized from the user record for query convenience (NOT unique)
- Cascade: deleting a user automatically deletes their WhatsApp session via FK
- Exportar tipos: `WhatsAppSession` / `NewWhatsAppSession`

## Router `channels.ts` (user-facing)

Archivo: `src/api/channels.ts`

- Endpoints bajo `/channels/whatsapp/*`
- Autenticacion: JWT de usuario (`authMiddleware`)
- **Siempre** filtrar por `c.get('user').userId` — sessions are per-user now
- Endpoints:
  - `GET /channels/whatsapp/status` — session status + phone for the authenticated user
  - `GET /channels/whatsapp/qr` — qrData actual (si status = 'qr')
  - `POST /channels/whatsapp/enable` — create a pending session for the user (409 if exists)
  - `POST /channels/whatsapp/disconnect` — mark session as disconnected

## Router `internal.ts` (worker-facing)

Archivo: `src/api/internal.ts`

- Endpoints bajo `/internal/whatsapp/*`
- Autenticacion: JWT de worker (`requireWorker` middleware)
- Body validado con Zod en cada endpoint
- All endpoints accept `userId` (UUID) instead of `orgId` — the orgId is resolved from the user record
- Endpoints:
  - `GET /internal/whatsapp/sessions` — list active (non-disconnected) sessions as `[{ userId, orgId }]`
  - `POST /internal/whatsapp/qr` — upsert session with qrData, keyed by userId
  - `POST /internal/whatsapp/status` — upsert session with status/phone, keyed by userId
  - `POST /internal/whatsapp/message` — inject message to ragAgent; orgId resolved from userId for RAG resourceId

## Guards de autenticacion

- `authMiddleware`: valida JWT with `role: "user" | "admin"`, extracts `userId` + `orgId`
- `requireWorker`: valida JWT with `role: "worker"` (no userId needed in token)
- Ambos middleware en `src/api/middleware/auth.ts`
- Montar en `src/index.ts`:
  ```typescript
  app.use('/channels/*', auth)
  app.route('/channels', channelsRouter)
  app.use('/internal/*', workerAuth)
  app.route('/internal', internalRouter)
  ```

## Restricciones

- **NO tocar** schema existente (users, documents, chunks, conversations, messages)
- **NO tocar** pipeline RAG (retriever, embedder, chunker, reranker)
- **NO tocar** auth existente (login, register, JWT de usuario)
- El endpoint `/internal/whatsapp/message` pasa `orgId` (resolved from userId) al ragAgent como `resourceId`
