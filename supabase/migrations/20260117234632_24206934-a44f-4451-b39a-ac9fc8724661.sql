-- Remove foreign key constraint from profiles to auth.users
-- Since we're using custom OTP auth, user_id is just a UUID identifier, not linked to auth.users
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;