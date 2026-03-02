-- rag-agent-backbone: initial schema
-- Requires PostgreSQL with pgvector extension

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
DO $$ BEGIN
  CREATE TYPE conversation_role AS ENUM ('user', 'assistant', 'system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE document_status AS ENUM ('pending', 'processing', 'indexed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE content_type AS ENUM ('pdf', 'markdown', 'html', 'code', 'text', 'url', 'youtube');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text UNIQUE,
  "org_id" text,
  "metadata" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

-- Conversations
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text,
  "config" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "conversations_user_id_idx" ON "conversations"("user_id");

-- Messages
CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "role" conversation_role NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "messages_conversation_id_idx" ON "messages"("conversation_id");
CREATE INDEX IF NOT EXISTS "messages_created_at_idx" ON "messages"("created_at");

-- Topics
CREATE TABLE IF NOT EXISTS "topics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "topics_org_id_idx" ON "topics"("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS "topics_org_id_name_idx" ON "topics"("org_id", "name");

-- Documents
CREATE TABLE IF NOT EXISTS "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text,
  "topic_id" uuid REFERENCES "topics"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "source" text NOT NULL,
  "content_type" content_type NOT NULL,
  "status" document_status NOT NULL DEFAULT 'pending',
  "chunk_count" integer DEFAULT 0,
  "metadata" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "indexed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "documents_org_id_idx" ON "documents"("org_id");
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents"("status");
CREATE INDEX IF NOT EXISTS "documents_topic_id_idx" ON "documents"("org_id", "topic_id");

-- Document Chunks (with vector embedding)
CREATE TABLE IF NOT EXISTS "document_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "embedding" vector(768),
  "chunk_metadata" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "document_chunks_document_id_idx" ON "document_chunks"("document_id");
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_idx"
  ON "document_chunks"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);

-- WhatsApp Sessions
CREATE TABLE IF NOT EXISTS "whatsapp_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'disconnected',
  "qr_data" text,
  "phone" text,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- Auto-update updated_at on conversations
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
