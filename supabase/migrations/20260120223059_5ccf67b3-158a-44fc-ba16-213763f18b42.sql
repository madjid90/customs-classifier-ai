-- Table scrape_logs: historique des scrapes
CREATE TABLE public.scrape_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'error')),
  pages_scraped INTEGER NOT NULL DEFAULT 0,
  chunks_created INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour requêtes fréquentes
CREATE INDEX idx_scrape_logs_source_id ON public.scrape_logs(source_id);
CREATE INDEX idx_scrape_logs_started_at ON public.scrape_logs(started_at DESC);
CREATE INDEX idx_scrape_logs_status ON public.scrape_logs(status);

-- Enable RLS
ALTER TABLE public.scrape_logs ENABLE ROW LEVEL SECURITY;

-- RLS: Admins peuvent voir les logs
CREATE POLICY "Admins can view scrape logs"
  ON public.scrape_logs
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::user_role));

-- RLS: Admins peuvent insérer des logs
CREATE POLICY "Admins can insert scrape logs"
  ON public.scrape_logs
  FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::user_role));

-- RLS: Admins peuvent mettre à jour les logs
CREATE POLICY "Admins can update scrape logs"
  ON public.scrape_logs
  FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::user_role));