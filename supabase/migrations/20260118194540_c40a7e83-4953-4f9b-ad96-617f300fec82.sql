
-- Drop existing functions with different signatures
DROP FUNCTION IF EXISTS public.match_kb_chunks(extensions.vector, double precision, integer, text[]);
DROP FUNCTION IF EXISTS public.match_hs_codes(extensions.vector, double precision, integer);
DROP FUNCTION IF EXISTS public.get_ingestion_stats();

-- ============================================
-- FONCTION 1 : match_kb_chunks
-- ============================================
CREATE FUNCTION public.match_kb_chunks(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.4,
  match_count integer DEFAULT 15,
  filter_sources text[] DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  source text,
  doc_id text,
  ref text,
  text text,
  version_label text,
  metadata jsonb,
  similarity double precision
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.source::text,
    kc.doc_id,
    kc.ref,
    kc.text,
    kc.version_label,
    kc.metadata,
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

-- ============================================
-- FONCTION 2 : match_hs_codes
-- ============================================
CREATE FUNCTION public.match_hs_codes(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.4,
  match_count integer DEFAULT 30
)
RETURNS TABLE(
  code_10 varchar,
  code_6 varchar,
  chapter_2 varchar,
  label_fr text,
  label_ar text,
  unit text,
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
    h.chapter_2,
    h.label_fr,
    h.label_ar,
    h.unit,
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

-- ============================================
-- FONCTION 3 : get_dum_signal
-- ============================================
CREATE OR REPLACE FUNCTION public.get_dum_signal(
  p_company_id uuid,
  p_keywords text[],
  p_limit integer DEFAULT 30
)
RETURNS TABLE(
  hs_code_10 varchar,
  match_count bigint,
  avg_reliability numeric,
  latest_date date
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.hs_code_10,
    COUNT(*)::bigint AS match_count,
    ROUND(AVG(d.reliability_score)::numeric, 2) AS avg_reliability,
    MAX(d.dum_date) AS latest_date
  FROM public.dum_records d
  WHERE 
    d.company_id = p_company_id
    AND d.validated = true
    AND EXISTS (
      SELECT 1 
      FROM unnest(p_keywords) AS kw 
      WHERE d.product_description ILIKE '%' || kw || '%'
    )
  GROUP BY d.hs_code_10
  ORDER BY match_count DESC, avg_reliability DESC
  LIMIT p_limit;
END;
$$;

-- ============================================
-- FONCTION 4 : get_ingestion_stats
-- ============================================
CREATE FUNCTION public.get_ingestion_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  hs_total bigint;
  hs_with_embedding bigint;
  hs_with_enrichment bigint;
  kb_total bigint;
  kb_with_embedding bigint;
  kb_by_source jsonb;
  dum_total bigint;
  dum_validated bigint;
  ready_for_classification boolean;
BEGIN
  -- HS Codes stats
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE embedding IS NOT NULL),
    COUNT(*) FILTER (WHERE enrichment IS NOT NULL AND enrichment != '{}'::jsonb)
  INTO hs_total, hs_with_embedding, hs_with_enrichment
  FROM public.hs_codes
  WHERE active = true;

  -- KB Chunks stats
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE embedding IS NOT NULL)
  INTO kb_total, kb_with_embedding
  FROM public.kb_chunks;

  -- KB by source
  SELECT COALESCE(jsonb_object_agg(src, cnt), '{}'::jsonb)
  INTO kb_by_source
  FROM (
    SELECT source::text as src, COUNT(*) as cnt
    FROM public.kb_chunks
    GROUP BY source
  ) sub;

  -- DUM Records stats
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE validated = true)
  INTO dum_total, dum_validated
  FROM public.dum_records;

  -- Ready for classification check
  ready_for_classification := (hs_with_embedding >= 100 AND kb_with_embedding >= 100);

  -- Build result
  result := jsonb_build_object(
    'hs_codes', jsonb_build_object(
      'total', COALESCE(hs_total, 0),
      'with_embedding', COALESCE(hs_with_embedding, 0),
      'with_enrichment', COALESCE(hs_with_enrichment, 0)
    ),
    'kb_chunks', jsonb_build_object(
      'total', COALESCE(kb_total, 0),
      'with_embedding', COALESCE(kb_with_embedding, 0),
      'by_source', kb_by_source
    ),
    'dum_records', jsonb_build_object(
      'total', COALESCE(dum_total, 0),
      'validated', COALESCE(dum_validated, 0)
    ),
    'ready_for_classification', ready_for_classification
  );

  RETURN result;
END;
$$;

-- ============================================
-- Permissions
-- ============================================
GRANT EXECUTE ON FUNCTION public.match_kb_chunks(extensions.vector, double precision, integer, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_kb_chunks(extensions.vector, double precision, integer, text[]) TO service_role;

GRANT EXECUTE ON FUNCTION public.match_hs_codes(extensions.vector, double precision, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_hs_codes(extensions.vector, double precision, integer) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_dum_signal(uuid, text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dum_signal(uuid, text[], integer) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_ingestion_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ingestion_stats() TO service_role;
