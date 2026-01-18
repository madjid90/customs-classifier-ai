-- Create security_logs table for unauthorized access attempts
CREATE TABLE public.security_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id UUID,
  user_phone TEXT,
  attempted_path TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for querying by user and time
CREATE INDEX idx_security_logs_user_id ON public.security_logs(user_id);
CREATE INDEX idx_security_logs_created_at ON public.security_logs(created_at DESC);
CREATE INDEX idx_security_logs_event_type ON public.security_logs(event_type);

-- Enable RLS
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view security logs
CREATE POLICY "Admins can view security logs"
  ON public.security_logs
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::user_role));

-- Service role can insert security logs (edge functions)
CREATE POLICY "Service role can insert security logs"
  ON public.security_logs
  FOR INSERT
  WITH CHECK (true);

-- Add comment
COMMENT ON TABLE public.security_logs IS 'Logs for security events like unauthorized access attempts';