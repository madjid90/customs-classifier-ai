-- Table pour l'historique des synchronisations HS depuis les lois de finance
CREATE TABLE IF NOT EXISTS public.hs_sync_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_label TEXT NOT NULL,
  laws_analyzed INTEGER NOT NULL DEFAULT 0,
  updates_found INTEGER NOT NULL DEFAULT 0,
  updates_applied INTEGER NOT NULL DEFAULT 0,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Index pour recherche par version
CREATE INDEX IF NOT EXISTS idx_hs_sync_history_version ON public.hs_sync_history(version_label);
CREATE INDEX IF NOT EXISTS idx_hs_sync_history_created ON public.hs_sync_history(created_at DESC);

-- RLS
ALTER TABLE public.hs_sync_history ENABLE ROW LEVEL SECURITY;

-- Seuls les admins peuvent voir l'historique
CREATE POLICY "Admins can view sync history"
ON public.hs_sync_history FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role IN ('admin', 'manager')
  )
);

-- Insertion via service role uniquement (pas de policy INSERT pour les users)
COMMENT ON TABLE public.hs_sync_history IS 'Historique des mises à jour automatiques des codes HS depuis les lois de finance';