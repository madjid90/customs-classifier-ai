-- Add missing columns to dum_records
ALTER TABLE public.dum_records 
ADD COLUMN IF NOT EXISTS destination_country VARCHAR(2) DEFAULT 'MA',
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Create trigger for automatic updated_at
CREATE OR REPLACE TRIGGER update_dum_records_updated_at
BEFORE UPDATE ON public.dum_records
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index on destination_country for queries
CREATE INDEX IF NOT EXISTS idx_dum_destination ON public.dum_records(destination_country);