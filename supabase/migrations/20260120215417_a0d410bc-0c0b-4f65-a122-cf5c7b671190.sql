-- Add source tracking columns to kb_chunks table
ALTER TABLE public.kb_chunks
ADD COLUMN source_url TEXT,
ADD COLUMN page_number INTEGER,
ADD COLUMN section_path TEXT;

-- Create index on source_url for faster lookups
CREATE INDEX idx_kb_chunks_source_url ON public.kb_chunks(source_url);

-- Add comments for documentation
COMMENT ON COLUMN public.kb_chunks.source_url IS 'URL of the original source document';
COMMENT ON COLUMN public.kb_chunks.page_number IS 'Page number in the source PDF document';
COMMENT ON COLUMN public.kb_chunks.section_path IS 'Navigation path in the document (e.g., "Chapitre 84 > Note 1")';