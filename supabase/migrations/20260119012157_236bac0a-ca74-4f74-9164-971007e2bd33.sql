-- =====================================================
-- Migration: Add auth trigger and storage_path column
-- =====================================================

-- 1. Add storage_path column to case_files for stable file references
ALTER TABLE public.case_files ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- 2. Create function to auto-create profile when user signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_company_id UUID;
  user_phone TEXT;
BEGIN
  -- Get phone from user metadata
  user_phone := COALESCE(
    NEW.phone,
    NEW.raw_user_meta_data->>'phone',
    ''
  );

  -- Check if profile already exists
  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Create a new company for the user
  INSERT INTO public.companies (name)
  VALUES ('Company ' || COALESCE(user_phone, NEW.id::TEXT))
  RETURNING id INTO new_company_id;

  -- Create profile linked to Supabase Auth user
  INSERT INTO public.profiles (user_id, company_id, phone)
  VALUES (NEW.id, new_company_id, user_phone);

  -- Assign default role (agent)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'agent')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 3. Create trigger on auth.users (drop first if exists)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();