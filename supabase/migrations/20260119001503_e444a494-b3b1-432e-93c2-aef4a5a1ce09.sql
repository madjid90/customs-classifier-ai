-- Remove the foreign key constraint that references auth.users
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;

-- Add new foreign key constraint referencing profiles.user_id
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;