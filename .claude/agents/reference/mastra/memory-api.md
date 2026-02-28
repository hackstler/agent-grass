# Mastra Memory API Reference

## Setup

```typescript
import { Memory } from "@mastra/memory"
import { PostgresStore } from "@mastra/pg"

const memory = new Memory({
  storage: new PostgresStore({
    id: "rag-memory-store",
    connectionString: process.env["DATABASE_URL"]!,
    schemaName: "mastra",  // IMPORTANT: separate schema from app tables
  }),
  options: {
    lastMessages: 20,          // recency window (user + assistant pairs)
    semanticRecall: false,     // enable semantic search on past messages
  },
})
```

## Storage Providers

**PostgresStore** (this project):
```typescript
new PostgresStore({
  id: string,
  connectionString: string,
  schemaName: string,  // creates separate schema, e.g., "mastra"
})
```

**LibSQLStore** (alternative for lightweight/edge):
```typescript
import { LibSQLStore } from "@mastra/libsql"
new LibSQLStore({ url: "file:memory.db" })
```

## Thread / Resource Pattern

**Thread** = conversation isolation (each conversation is a separate thread)
**Resource** = tenant isolation (each org is a separate resource)

```typescript
// When calling generate() or stream()
await agent.generate(input, {
  memory: {
    thread: conversationId,   // UUID — identifies the conversation
    resource: orgId,          // string — identifies the tenant
  },
})
```

**Critical constraint**: Each thread has an immutable owner (resource). Once a thread is created with resource="orgA", it cannot be used with resource="orgB".

## Multi-Tenancy Pattern (This Project)

```typescript
// Worker API (internal.ts)
const result = await ragAgent.generate(messageBody, {
  memory: {
    thread: conversationId,  // from resolveConversationId(chatId, orgId)
    resource: orgId,         // from worker JWT
  },
})

// Chat API (chat.ts)
const result = await ragAgent.generate(query, {
  memory: {
    thread: conversationId,  // from resolveConversationId()
    resource: orgId ?? "anonymous",
  },
})
```

This ensures:
- Each WhatsApp chat has its own conversation thread
- Each org's conversations are isolated via resource
- Memory queries only return messages from the same thread+resource

## Memory Options

```typescript
options: {
  // Recency window — how many recent messages to include
  lastMessages: 20,  // default: 40

  // Semantic recall — search past messages by meaning
  semanticRecall: false,  // default: false
  // When true, also returns semantically similar past messages
  // Requires an embedding model configured

  // Working memory — persistent key-value store per thread
  // Survives across sessions, good for user preferences
}
```

## Observational Memory (Long Conversations)

For conversations that exceed the context window:
```typescript
memory: new Memory({
  storage: store,
  options: {
    lastMessages: 20,
    observationalMemory: {
      model: google("gemini-2.5-flash"),
      observation: {
        messageTokens: 20_000,  // compress after 20k tokens
      },
    },
  },
})
```

Background agents compress old messages into dense observations, keeping context small while preserving long-term memory.

## Schema

Mastra creates these tables in the configured schema:
- `{schemaName}.threads` — thread metadata
- `{schemaName}.messages` — conversation messages
- `{schemaName}.memory_kv` — working memory key-value pairs

These are separate from the app's `conversations` and `messages` tables in the public schema. This project maintains BOTH:
- Mastra memory (in "mastra" schema) — used by the agent for conversation context
- App messages (in public schema) — used by the API for conversation history display
