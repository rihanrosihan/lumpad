-- optional: extension vector
-- Embeddings for memory and knowledge chunks: written only when a content hash changes (Phase 4); model name and version stored per row.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE memory.item_embedding (
  item_id BIGINT PRIMARY KEY REFERENCES memory.item(id) ON DELETE CASCADE, model TEXT NOT NULL, content_hash TEXT NOT NULL, embedding vector NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
