-- Create a table to track background tasks
CREATE TABLE public.background_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_type TEXT NOT NULL, -- 'embeddings_hs', 'embeddings_kb', 'enrichment_hs', 'sync_hs_laws'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
  source_id UUID, -- Reference to ingestion_files.id if applicable
  items_total INTEGER DEFAULT 0,
  items_processed INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.background_tasks ENABLE ROW LEVEL SECURITY;

-- Admins can view all tasks (correct argument order: uuid first, then role)
CREATE POLICY "Admins can view all background tasks"
ON public.background_tasks
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.user_role));

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.background_tasks;

-- Create index for faster queries
CREATE INDEX idx_background_tasks_status ON public.background_tasks(status);
CREATE INDEX idx_background_tasks_created_at ON public.background_tasks(created_at DESC);