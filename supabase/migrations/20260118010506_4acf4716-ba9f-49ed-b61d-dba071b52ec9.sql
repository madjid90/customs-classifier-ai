-- Storage RLS policies for case-files bucket
-- Files are stored with path: {case_id}/{filename}

-- Policy: Users can upload files to cases belonging to their company
CREATE POLICY "Users can upload files to their company cases"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'case-files' 
  AND EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id::text = (storage.foldername(name))[1]
    AND c.company_id = public.get_user_company_id(auth.uid())
  )
);

-- Policy: Users can view files from cases belonging to their company
CREATE POLICY "Users can view files from their company cases"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'case-files'
  AND EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id::text = (storage.foldername(name))[1]
    AND c.company_id = public.get_user_company_id(auth.uid())
  )
);

-- Policy: Users can update files in cases belonging to their company
CREATE POLICY "Users can update files in their company cases"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'case-files'
  AND EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id::text = (storage.foldername(name))[1]
    AND c.company_id = public.get_user_company_id(auth.uid())
  )
);

-- Policy: Users can delete files from cases belonging to their company
CREATE POLICY "Users can delete files from their company cases"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'case-files'
  AND EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id::text = (storage.foldername(name))[1]
    AND c.company_id = public.get_user_company_id(auth.uid())
  )
);