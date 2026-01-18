-- ============================================================================
-- AJOUT COLONNE active À hs_codes
-- ============================================================================

ALTER TABLE public.hs_codes 
ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- Index pour filtrer les codes actifs
CREATE INDEX IF NOT EXISTS idx_hs_codes_active ON public.hs_codes(active) WHERE active = true;

-- ============================================================================
-- FONCTION POUR GÉNÉRER LES EMBEDDINGS KB_CHUNKS
-- ============================================================================

-- Fonction pour obtenir les chunks sans embeddings
CREATE OR REPLACE FUNCTION public.get_chunks_without_embeddings(batch_size integer DEFAULT 100)
RETURNS TABLE(id uuid, text text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT kc.id, kc.text 
  FROM public.kb_chunks kc
  WHERE kc.embedding IS NULL
  LIMIT batch_size;
$$;

-- Fonction pour mettre à jour l'embedding d'un chunk
CREATE OR REPLACE FUNCTION public.update_chunk_embedding(
  chunk_id uuid,
  embedding_vector vector(3072)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE public.kb_chunks 
  SET embedding = embedding_vector
  WHERE id = chunk_id;
END;
$$;

-- ============================================================================
-- TABLE POUR LOGGER LES AMBIGUÏTÉS D'INGESTION
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ingestion_ambiguities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_id UUID REFERENCES public.ingestion_files(id) ON DELETE CASCADE,
  source_row TEXT NOT NULL,
  ambiguity_type TEXT NOT NULL CHECK (ambiguity_type IN ('multiple_codes', 'range', 'exclusion', 'note_explicative', 'format_error', 'other')),
  description TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolution_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index pour recherche par ingestion
CREATE INDEX IF NOT EXISTS idx_ingestion_ambiguities_ingestion 
ON public.ingestion_ambiguities(ingestion_id);

-- Index pour ambiguïtés non résolues
CREATE INDEX IF NOT EXISTS idx_ingestion_ambiguities_unresolved 
ON public.ingestion_ambiguities(resolved) WHERE resolved = false;

-- RLS pour ingestion_ambiguities
ALTER TABLE public.ingestion_ambiguities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view ingestion_ambiguities"
ON public.ingestion_ambiguities FOR SELECT
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert ingestion_ambiguities"
ON public.ingestion_ambiguities FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update ingestion_ambiguities"
ON public.ingestion_ambiguities FOR UPDATE
USING (has_role(auth.uid(), 'admin'));

-- ============================================================================
-- STATISTIQUES INGESTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ingestion_stats()
RETURNS TABLE(
  total_hs_codes bigint,
  active_hs_codes bigint,
  total_kb_chunks bigint,
  kb_chunks_with_embeddings bigint,
  total_dum_records bigint,
  total_ambiguities bigint,
  unresolved_ambiguities bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    (SELECT COUNT(*) FROM public.hs_codes),
    (SELECT COUNT(*) FROM public.hs_codes WHERE active = true),
    (SELECT COUNT(*) FROM public.kb_chunks),
    (SELECT COUNT(*) FROM public.kb_chunks WHERE embedding IS NOT NULL),
    (SELECT COUNT(*) FROM public.dum_records),
    (SELECT COUNT(*) FROM public.ingestion_ambiguities),
    (SELECT COUNT(*) FROM public.ingestion_ambiguities WHERE resolved = false);
$$;