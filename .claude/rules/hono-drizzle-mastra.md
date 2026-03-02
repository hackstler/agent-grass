# Hono + Drizzle + Mastra — Deep Stack Rules

Complementa las reglas existentes en `api-design.md`, `data-model.md` y `rag-pipeline.md`.

---

## Hono

### Middleware chain (orden estricto)
```
logger → secureHeaders → cors → auth → route handler
```
No alterar el orden. Auth siempre después de CORS.

### Context variables
```typescript
// Declarar tipos en ContextVariableMap (global)
declare module 'hono' {
  interface ContextVariableMap {
    user: { userId: string; orgId: string; role: "user" }
    orgId: string  // set by requireWorker
  }
}

// Usar en handlers
const user = c.get("user")
const orgId = c.get("orgId")
```

### SSE Streaming
```typescript
return stream(c, async (writer) => {
  try {
    // emitir eventos con writer.write()
  } finally {
    // cleanup: siempre emitir "done" event
  }
})
```

### Validación
- Validar con Zod **antes** de procesar cualquier input
- Parsear body: `const body = schema.parse(await c.req.json())`
- Parsear query: `const query = schema.parse(c.req.query())`

### Response format
```typescript
// Success
return c.json({ data: result })

// Error — always { error: "Category", message: "detail" }
return c.json({ error: "Validation", message: "Invalid input" }, 400)
```

---

## Drizzle

### UUIDs
```typescript
id: uuid('id').defaultRandom().primaryKey()
```
Siempre `defaultRandom()` para PKs. No usar auto-increment.

### Timestamps
```typescript
createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
```
Siempre `withTimezone: true`. Almacenar UTC.

### Upserts atómicos
```typescript
await db.insert(table)
  .values(data)
  .onConflictDoUpdate({
    target: table.uniqueColumn,
    set: { ...updates, updatedAt: new Date() }
  })
```

### Relations
```typescript
export const tableRelations = relations(table, ({ one, many }) => ({
  parent: one(parentTable, { fields: [table.parentId], references: [parentTable.id] }),
  children: many(childTable),
}))
```

### Type inference
```typescript
// Infrastructure types (in src/infrastructure/db/schema.ts)
export type Session = typeof whatsappSessions.$inferSelect
export type NewSession = typeof whatsappSessions.$inferInsert

// Domain entities (in src/domain/entities/index.ts) — pure interfaces
// Domain/Application layers import from domain entities, NOT schema
```

### Pool singleton
```typescript
const pool = new Pool({
  connectionString: process.env["DATABASE_URL"],
  max: 10,
  idleTimeoutMillis: 30_000,
})
```
Un solo pool por proceso. No crear pools por request.

---

## Mastra

### Agent
```typescript
const agent = new Agent({
  id: "rag-agent",
  name: "RAG Agent",
  instructions: systemPrompt,
  model: geminiModel,
  tools: toolRegistry,
  memory: postgresMemory,
})
```

### Memory (multi-tenant)
```typescript
const memory = new PostgresStore({
  connectionString: process.env["DATABASE_URL"],
  schemaName: "mastra",  // schema separado del app schema
})
```
- **Thread** = conversationId (cada conversación es un thread)
- **Resource** = orgId (para aislamiento multi-tenant)

### Tools — Factory Pattern
```typescript
// Cada tool exporta un ToolEntry
export interface ToolEntry {
  key: string
  create(deps: ToolDeps): MastraTool
}

// Registry filtra por config
export function createToolRegistry(deps: ToolDeps): Record<string, MastraTool> {
  return enabledEntries
    .filter(entry => toolsConfig[entry.key]?.enabled)
    .reduce((acc, entry) => ({ ...acc, [entry.key]: entry.create(deps) }), {})
}
```

### Payload unwrapping (Mastra 1.5+)
Mastra wraps tool results en `.payload`. Necesita type assertions:
```typescript
const result = await tool.execute(input) as { payload: T }
const data = result.payload
```

### System prompt
Usar secciones con `== TÍTULO ==` y template literals para condicionales:
```typescript
const systemPrompt = `
== ROL ==
Eres un asistente especializado...

== CONTEXTO ==
${context ? `Documentos relevantes:\n${context}` : 'No hay documentos disponibles.'}

== HERRAMIENTAS ==
${tools.length > 0 ? `Tienes acceso a: ${tools.join(', ')}` : ''}
`
```
