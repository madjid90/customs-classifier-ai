-- =============================================
-- SECURITY FIX: Add base authentication policies
-- Ensure all tables require authentication before any access
-- =============================================

-- 1. Profiles: Require authentication for all access
CREATE POLICY "profiles_require_auth" ON public.profiles
FOR ALL USING (auth.uid() IS NOT NULL);

-- 2. Audit logs: Require authentication for all access
CREATE POLICY "audit_logs_require_auth" ON public.audit_logs
FOR SELECT USING (auth.uid() IS NOT NULL);

-- 3. Security logs: Tighten INSERT policy to prevent service role bypass
DROP POLICY IF EXISTS "Admins can view security logs" ON public.security_logs;
DROP POLICY IF EXISTS "Service role can insert security logs" ON public.security_logs;

CREATE POLICY "security_logs_admin_select" ON public.security_logs
FOR SELECT USING (
  auth.uid() IS NOT NULL 
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur 
    WHERE ur.user_id = auth.uid() 
    AND ur.role = 'admin'
  )
);

CREATE POLICY "security_logs_service_insert" ON public.security_logs
FOR INSERT WITH CHECK (
  -- Only allow inserts from service role (current_user check)
  current_setting('request.jwt.claim.role', true) = 'service_role'
  OR (
    auth.uid() IS NOT NULL 
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur 
      WHERE ur.user_id = auth.uid() 
      AND ur.role = 'admin'
    )
  )
);

-- 4. Companies: Require authentication
CREATE POLICY "companies_require_auth" ON public.companies
FOR ALL USING (auth.uid() IS NOT NULL);

-- 5. User roles: Require authentication
CREATE POLICY "user_roles_require_auth" ON public.user_roles
FOR ALL USING (auth.uid() IS NOT NULL);

-- 6. Cases: Require authentication for all operations
CREATE POLICY "cases_require_auth" ON public.cases
FOR ALL USING (auth.uid() IS NOT NULL);

-- 7. Case files: Require authentication
CREATE POLICY "case_files_require_auth" ON public.case_files
FOR ALL USING (auth.uid() IS NOT NULL);

-- 8. Classification results: Require authentication
CREATE POLICY "classification_results_require_auth" ON public.classification_results
FOR ALL USING (auth.uid() IS NOT NULL);

-- 9. DUM records: Require authentication
CREATE POLICY "dum_records_require_auth" ON public.dum_records
FOR ALL USING (auth.uid() IS NOT NULL);

-- 10. Background tasks: Require authentication
CREATE POLICY "background_tasks_require_auth" ON public.background_tasks
FOR ALL USING (auth.uid() IS NOT NULL);