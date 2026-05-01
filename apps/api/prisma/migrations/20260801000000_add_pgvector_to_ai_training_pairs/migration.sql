-- Enable pgvector extension for semantic similarity search on training pairs.
CREATE EXTENSION IF NOT EXISTS vector;

-- Google Vertex AI text-multilingual-embedding-002 outputs 768-dimension embeddings.
ALTER TABLE "ai_training_pairs"
  ADD COLUMN "embedding" vector(768),
  ADD COLUMN "embedding_model" TEXT,
  ADD COLUMN "embedded_at" TIMESTAMP(3);

-- HNSW index for cosine-similarity ANN search.
-- Skips rows with NULL embedding automatically.
CREATE INDEX "ai_training_pairs_embedding_hnsw_idx"
  ON "ai_training_pairs"
  USING hnsw ("embedding" vector_cosine_ops);
