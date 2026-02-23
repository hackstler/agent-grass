-- Add 'youtube' to the content_type enum
-- PostgreSQL allows adding new values to enums with IF NOT EXISTS (safe to re-run)
ALTER TYPE "content_type" ADD VALUE IF NOT EXISTS 'youtube';
