-- Create storage bucket for scraped files
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('scraped-files', 'scraped-files', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for scraped-files bucket
CREATE POLICY "Admins can upload scraped files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'scraped-files' 
  AND has_role(auth.uid(), 'admin'::user_role)
);

CREATE POLICY "Admins can view scraped files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'scraped-files' 
  AND has_role(auth.uid(), 'admin'::user_role)
);

CREATE POLICY "Admins can delete scraped files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'scraped-files' 
  AND has_role(auth.uid(), 'admin'::user_role)
);

-- Add new ingestion sources for broader content
ALTER TYPE ingestion_source ADD VALUE IF NOT EXISTS 'conseil';
ALTER TYPE ingestion_source ADD VALUE IF NOT EXISTS 'reglementation';
ALTER TYPE ingestion_source ADD VALUE IF NOT EXISTS 'guides';
ALTER TYPE ingestion_source ADD VALUE IF NOT EXISTS 'external';

-- Create table to track scraped files
CREATE TABLE IF NOT EXISTS public.scraped_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES public.data_sources(id) ON DELETE CASCADE,
  original_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size_bytes INTEGER,
  content_extracted BOOLEAN DEFAULT false,
  chunks_created INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.scraped_files ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins can manage scraped_files"
ON public.scraped_files FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::user_role))
WITH CHECK (has_role(auth.uid(), 'admin'::user_role));

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_scraped_files_source ON public.scraped_files(source_id);
CREATE INDEX IF NOT EXISTS idx_scraped_files_processed ON public.scraped_files(content_extracted);