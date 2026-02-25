-- Tabla topics: agrupa documentos por dominio/tema
CREATE TABLE IF NOT EXISTS "topics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "topics_org_id_idx" ON "topics" ("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS "topics_org_id_name_idx" ON "topics" ("org_id", "name");

-- topicId en documents (nullable, ON DELETE SET NULL)
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "topic_id" uuid REFERENCES "topics"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "documents_topic_id_idx" ON "documents" ("org_id", "topic_id");
