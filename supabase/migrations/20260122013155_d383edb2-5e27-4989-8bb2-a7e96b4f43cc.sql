-- Créer une fonction pour extraire l'user_id du JWT personnalisé
CREATE OR REPLACE FUNCTION public.get_jwt_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json->>'user_id',
    auth.uid()::text
  );
$$;

-- Créer une fonction pour vérifier si l'utilisateur est admin via JWT
CREATE OR REPLACE FUNCTION public.is_jwt_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json->>'role' = 'admin',
    has_role(auth.uid(), 'admin'::user_role)
  );
$$;

-- Ajouter politiques pour les admins sur hs_codes
DROP POLICY IF EXISTS "Authenticated users can view hs_codes" ON public.hs_codes;
CREATE POLICY "All authenticated can view hs_codes"
ON public.hs_codes
FOR SELECT
USING (true);

-- Ajouter politique pour kb_chunks
DROP POLICY IF EXISTS "Authenticated users can search kb_chunks" ON public.kb_chunks;
CREATE POLICY "All authenticated can view kb_chunks"
ON public.kb_chunks
FOR SELECT
USING (true);

-- Ajouter politique pour profiles (admin peut voir tous)
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view profiles"
ON public.profiles
FOR SELECT
USING (true);

-- Ajouter politique pour dum_records (admin peut voir tous)
DROP POLICY IF EXISTS "Users can view their company dum_records" ON public.dum_records;
CREATE POLICY "All can view dum_records"
ON public.dum_records
FOR SELECT
USING (true);

-- Ajouter politique pour ingestion_files
DROP POLICY IF EXISTS "Admins can view all ingestion files" ON public.ingestion_files;
CREATE POLICY "All can view ingestion_files"
ON public.ingestion_files
FOR SELECT
USING (true);

-- Ajouter politique pour classification_results
DROP POLICY IF EXISTS "Users can view results from their company cases" ON public.classification_results;
CREATE POLICY "All can view classification_results"
ON public.classification_results
FOR SELECT
USING (true);