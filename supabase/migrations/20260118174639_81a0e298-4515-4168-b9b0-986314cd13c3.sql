-- Fonction de recherche vectorielle pour kb_chunks
-- Utilise cosine similarity avec pgvector

CREATE OR REPLACE FUNCTION public.match_kb_chunks(
  query_embedding extensions.vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10,
  filter_sources text[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  source public.ingestion_source,
  doc_id text,
  ref text,
  text text,
  version_label text,
  similarity float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.source,
    kc.doc_id,
    kc.ref,
    kc.text,
    kc.version_label,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.kb_chunks kc
  WHERE 
    kc.embedding IS NOT NULL
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
    AND (filter_sources IS NULL OR kc.source::text = ANY(filter_sources))
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Index pour améliorer les performances de recherche vectorielle
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding 
ON public.kb_chunks 
USING ivfflat (embedding extensions.vector_cosine_ops)
WITH (lists = 100);

-- Fonction de recherche hybride (texte + vecteur)
CREATE OR REPLACE FUNCTION public.search_kb_hybrid(
  query_text text,
  query_embedding extensions.vector(1536) DEFAULT NULL,
  match_count int DEFAULT 15,
  filter_sources text[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  source public.ingestion_source,
  doc_id text,
  ref text,
  text text,
  version_label text,
  similarity float,
  match_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  keywords text[];
BEGIN
  -- Extract keywords from query
  keywords := regexp_split_to_array(lower(query_text), '\s+');
  keywords := array(SELECT k FROM unnest(keywords) k WHERE length(k) > 2);
  
  IF query_embedding IS NOT NULL THEN
    -- Vector search when embedding is provided
    RETURN QUERY
    SELECT
      kc.id,
      kc.source,
      kc.doc_id,
      kc.ref,
      kc.text,
      kc.version_label,
      CASE 
        WHEN kc.embedding IS NOT NULL THEN 1 - (kc.embedding <=> query_embedding)
        ELSE 0.0
      END AS similarity,
      'vector'::text AS match_type
    FROM public.kb_chunks kc
    WHERE 
      kc.embedding IS NOT NULL
      AND (filter_sources IS NULL OR kc.source::text = ANY(filter_sources))
    ORDER BY kc.embedding <=> query_embedding
    LIMIT match_count;
  ELSE
    -- Fallback to text search
    RETURN QUERY
    SELECT
      kc.id,
      kc.source,
      kc.doc_id,
      kc.ref,
      kc.text,
      kc.version_label,
      0.5::float AS similarity,
      'text'::text AS match_type
    FROM public.kb_chunks kc
    WHERE 
      (filter_sources IS NULL OR kc.source::text = ANY(filter_sources))
      AND EXISTS (
        SELECT 1 FROM unnest(keywords) k WHERE kc.text ILIKE '%' || k || '%'
      )
    LIMIT match_count;
  END IF;
END;
$$;

-- Accorder les permissions
GRANT EXECUTE ON FUNCTION public.match_kb_chunks TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_kb_chunks TO service_role;
GRANT EXECUTE ON FUNCTION public.search_kb_hybrid TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_kb_hybrid TO service_role;