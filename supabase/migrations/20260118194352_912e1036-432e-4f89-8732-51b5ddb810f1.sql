
-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ============================================
-- TABLE 1: hs_codes - Add missing columns and indexes
-- ============================================

-- Add missing columns
ALTER TABLE public.hs_codes 
ADD COLUMN IF NOT EXISTS code_4 VARCHAR(4) GENERATED ALWAYS AS (LEFT(code_10, 4)) STORED;

ALTER TABLE public.hs_codes 
ADD COLUMN IF NOT EXISTS enrichment JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.hs_codes 
ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);

-- Create indexes for hs_codes
CREATE INDEX IF NOT EXISTS idx_hs_codes_label_fr_gin 
ON public.hs_codes USING GIN (to_tsvector('french', label_fr));

CREATE INDEX IF NOT EXISTS idx_hs_codes_chapter_2 
ON public.hs_codes (chapter_2);

CREATE INDEX IF NOT EXISTS idx_hs_codes_code_4 
ON public.hs_codes (code_4);

-- ivfflat index for vector search (requires at least 100 rows to build properly)
-- Using HNSW instead which works better with fewer rows
CREATE INDEX IF NOT EXISTS idx_hs_codes_embedding 
ON public.hs_codes USING hnsw (embedding extensions.vector_cosine_ops);

-- ============================================
-- TABLE 2: kb_chunks - Add missing columns and indexes
-- ============================================

-- Add missing columns
ALTER TABLE public.kb_chunks 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Create indexes for kb_chunks
CREATE INDEX IF NOT EXISTS idx_kb_chunks_source 
ON public.kb_chunks (source);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_text_gin 
ON public.kb_chunks USING GIN (to_tsvector('french', text));

-- HNSW index for vector search on kb_chunks
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding 
ON public.kb_chunks USING hnsw (embedding extensions.vector_cosine_ops);

-- ============================================
-- TABLE 3: dum_records - Add missing columns and indexes
-- ============================================

-- Add missing columns
ALTER TABLE public.dum_records 
ADD COLUMN IF NOT EXISTS quantity NUMERIC DEFAULT 1;

ALTER TABLE public.dum_records 
ADD COLUMN IF NOT EXISTS unit VARCHAR(10) DEFAULT 'u';

ALTER TABLE public.dum_records 
ADD COLUMN IF NOT EXISTS value_mad NUMERIC;

ALTER TABLE public.dum_records 
ADD COLUMN IF NOT EXISTS validated BOOLEAN DEFAULT false;

-- Create indexes for dum_records
CREATE INDEX IF NOT EXISTS idx_dum_records_company_id 
ON public.dum_records (company_id);

CREATE INDEX IF NOT EXISTS idx_dum_records_hs_code_10 
ON public.dum_records (hs_code_10);

CREATE INDEX IF NOT EXISTS idx_dum_records_date 
ON public.dum_records (dum_date DESC);

-- ============================================
-- Create full-text search function for hs_codes
-- ============================================
CREATE OR REPLACE FUNCTION public.search_hs_codes(
  search_query text,
  match_limit integer DEFAULT 20
)
RETURNS TABLE(
  code_10 varchar,
  code_6 varchar,
  code_4 varchar,
  chapter_2 varchar,
  label_fr text,
  label_ar text,
  unit text,
  taxes jsonb,
  rank real
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    h.code_10,
    h.code_6,
    h.code_4,
    h.chapter_2,
    h.label_fr,
    h.label_ar,
    h.unit,
    h.taxes,
    ts_rank(to_tsvector('french', h.label_fr), plainto_tsquery('french', search_query)) AS rank
  FROM public.hs_codes h
  WHERE 
    h.active = true
    AND (
      h.code_10 ILIKE '%' || search_query || '%'
      OR h.code_6 ILIKE '%' || search_query || '%'
      OR to_tsvector('french', h.label_fr) @@ plainto_tsquery('french', search_query)
    )
  ORDER BY rank DESC, h.code_10
  LIMIT match_limit;
END;
$$;

-- ============================================
-- Create semantic search function for hs_codes
-- ============================================
CREATE OR REPLACE FUNCTION public.match_hs_codes(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 10
)
RETURNS TABLE(
  code_10 varchar,
  code_6 varchar,
  code_4 varchar,
  chapter_2 varchar,
  label_fr text,
  label_ar text,
  taxes jsonb,
  enrichment jsonb,
  similarity double precision
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    h.code_10,
    h.code_6,
    h.code_4,
    h.chapter_2,
    h.label_fr,
    h.label_ar,
    h.taxes,
    h.enrichment,
    1 - (h.embedding <=> query_embedding) AS similarity
  FROM public.hs_codes h
  WHERE 
    h.embedding IS NOT NULL
    AND h.active = true
    AND 1 - (h.embedding <=> query_embedding) > match_threshold
  ORDER BY h.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
