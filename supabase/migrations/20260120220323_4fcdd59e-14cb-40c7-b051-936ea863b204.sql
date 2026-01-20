-- Create enum for data source types
CREATE TYPE public.data_source_type AS ENUM ('website', 'api', 'rss', 'pdf_url', 'sitemap');

-- Create enum for data source status
CREATE TYPE public.data_source_status AS ENUM ('active', 'paused', 'error', 'disabled');

-- Create data_sources table
CREATE TABLE public.data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  source_type public.data_source_type NOT NULL,
  url TEXT NOT NULL,
  base_url TEXT,
  kb_source public.ingestion_source NOT NULL,
  version_label TEXT NOT NULL DEFAULT 'auto',
  scrape_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  schedule_cron TEXT,
  last_scrape_at TIMESTAMPTZ,
  next_scrape_at TIMESTAMPTZ,
  status public.data_source_status NOT NULL DEFAULT 'active',
  error_message TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  stats JSONB NOT NULL DEFAULT '{"total_pages": 0, "total_chunks": 0}'::jsonb,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_data_sources_status ON public.data_sources(status);
CREATE INDEX idx_data_sources_kb_source ON public.data_sources(kb_source);
CREATE INDEX idx_data_sources_next_scrape ON public.data_sources(next_scrape_at) WHERE status = 'active';
CREATE INDEX idx_data_sources_source_type ON public.data_sources(source_type);

-- Enable RLS
ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Admins only
CREATE POLICY "Admins can view all data sources"
ON public.data_sources
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Admins can insert data sources"
ON public.data_sources
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Admins can update data sources"
ON public.data_sources
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Admins can delete data sources"
ON public.data_sources
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'::user_role));

-- Trigger for updated_at
CREATE TRIGGER update_data_sources_updated_at
BEFORE UPDATE ON public.data_sources
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE public.data_sources IS 'Configuration des sources de données à scraper automatiquement';
COMMENT ON COLUMN public.data_sources.scrape_config IS 'Configuration JSON: selectors, max_pages, delay_ms, headers, etc.';
COMMENT ON COLUMN public.data_sources.schedule_cron IS 'Expression cron pour le scheduling (ex: "0 2 * * *" = tous les jours à 2h)';
COMMENT ON COLUMN public.data_sources.stats IS 'Statistiques: total_pages, total_chunks, last_duration_ms, etc.';