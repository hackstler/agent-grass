# Data Model Rules

## Schema — Drizzle conventions
- Siempre usar `uuid` con `defaultRandom()` para PKs. No usar enteros autoincrementales.
- Timestamps: siempre `withTimezone: true`. Almacenar en UTC, formatear en frontend.
- Nombres de columnas: `snake_case` en DB, `camelCase` en TypeScript (Drizzle mapea automáticamente).
- Usar `jsonb` para metadata flexible. Tipar con `.$type<T>()` para type-safety.

## Migrations
- **Nunca** modificar migraciones existentes. Crear una nueva migración para cada cambio.
- Nombre descriptivo: `0001_add_document_tags.sql`, `0002_index_messages_created_at.sql`
- Ejecutar con `npm run migrate` (usa `drizzle-kit migrate`).
- En producción: las migraciones se ejecutan antes del deploy, no en el startup de la app.

## Vector column
- Dimensión fija en el schema (`vector(1536)`). Cambiar la dimensión requiere DROP y recrear el índice.
- El índice IVFFlat se debe crear **después** de cargar datos iniciales. Con 0 rows, el índice es ineficiente.
- Para producción con >100k chunks: considerar `pgvector.hnsw` sobre `ivfflat`.

## Relaciones
- Usar `ON DELETE CASCADE` en FKs de children (messages → conversations, chunks → documents).
- Usuarios son opcionales (`userId` puede ser null para acceso anónimo).
- `orgId` es un string libre (no FK) para multi-tenancy simple.

## Queries
- Usar siempre `db.query.*` para queries con relaciones (Drizzle relational API).
- Usar `db.select()` para queries simples sin joins.
- La query de similarity search en `retriever.ts` usa SQL raw por necesidad del operador `<=>` de pgvector — eso está permitido.

## Types
- Los tipos Drizzle inferidos (`$inferSelect`, `$inferInsert`) viven en `src/infrastructure/db/schema.ts`.
- Las interfaces de dominio equivalentes viven en `src/domain/entities/index.ts`.
- **Domain y Application** importan de `src/domain/entities/` — nunca de `infrastructure/db/schema.ts`.
- **Infrastructure** (repositories, ingestion, rag) puede importar de `infrastructure/db/schema.ts` directamente.
- Los tipos son estructuralmente compatibles — no hace falta mapping explícito.
