-- =====================================================
-- Fix remaining RLS issues
-- =====================================================

-- 1. Fix otp_codes: RLS enabled but no policies (table should be service role only)
CREATE POLICY "No direct user access to otp_codes"
  ON public.otp_codes
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- 2. Fix security_logs INSERT policy: restrict to service role only
DROP POLICY IF EXISTS "Service role can insert security logs" ON public.security_logs;

-- Service role INSERT is handled at database level, not via RLS
-- We deny direct user access
CREATE POLICY "Service role can insert security logs"
  ON public.security_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 3. The other "true" policies are for service_role which is acceptable
-- service_role bypasses RLS anyway, these are just explicit grants