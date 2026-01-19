-- =====================================================
-- Fix overly permissive RLS policies
-- =====================================================

-- 1. Fix rate_limits: only service role should access (via edge functions)
DROP POLICY IF EXISTS "Service role full access on rate_limits" ON public.rate_limits;

-- Rate limits should only be accessible via service role (edge functions)
-- No direct user access needed
CREATE POLICY "No direct user access to rate_limits"
  ON public.rate_limits
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- 2. Fix kb_chunks: require authentication for SELECT
DROP POLICY IF EXISTS "Authenticated users can search kb_chunks" ON public.kb_chunks;

CREATE POLICY "Authenticated users can search kb_chunks"
  ON public.kb_chunks
  FOR SELECT
  USING (auth.uid() IS NOT NULL);