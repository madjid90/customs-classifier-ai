-- Ajouter la colonne code_14 pour le format marocain (14 chiffres)
ALTER TABLE public.hs_codes 
ADD COLUMN IF NOT EXISTS code_14 character varying(14);

-- Créer un index pour les recherches sur code_14
CREATE INDEX IF NOT EXISTS idx_hs_codes_code_14 ON public.hs_codes(code_14);

-- Commentaire pour documentation
COMMENT ON COLUMN public.hs_codes.code_14 IS 'Code HS marocain à 14 chiffres (extension nationale)';