-- Ajouter politique DELETE pour ingestion_ambiguities (compléter RLS)
CREATE POLICY "Admins can delete ingestion_ambiguities"
ON public.ingestion_ambiguities FOR DELETE
USING (has_role(auth.uid(), 'admin'));