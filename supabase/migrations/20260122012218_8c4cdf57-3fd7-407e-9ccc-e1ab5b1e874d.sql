-- Remove the invalid foreign key constraint that references auth.users
-- Our custom OTP auth system uses profiles.user_id instead

ALTER TABLE public.cases 
DROP CONSTRAINT IF EXISTS cases_created_by_fkey;

-- Remove the invalid foreign key constraint on validated_by if it exists
ALTER TABLE public.cases 
DROP CONSTRAINT IF EXISTS cases_validated_by_fkey;

-- Remove invalid foreign key constraints on audit_logs if they exist
ALTER TABLE public.audit_logs 
DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;