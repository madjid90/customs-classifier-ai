-- Table des codes HS/Nomenclature Maroc (10 chiffres)
CREATE TABLE public.hs_codes (
  code_10 VARCHAR(10) PRIMARY KEY,
  code_6 VARCHAR(6) NOT NULL,
  chapter_2 VARCHAR(2) NOT NULL,
  label_fr TEXT NOT NULL,
  label_ar TEXT,
  unit TEXT,
  taxes JSONB DEFAULT '{}'::jsonb,
  restrictions TEXT[],
  active_version_label TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index pour recherche rapide
CREATE INDEX idx_hs_codes_code_6 ON public.hs_codes(code_6);
CREATE INDEX idx_hs_codes_chapter_2 ON public.hs_codes(chapter_2);
CREATE INDEX idx_hs_codes_label_fr ON public.hs_codes USING gin(to_tsvector('french', label_fr));

-- Table des notes explicatives OMD
CREATE TABLE public.hs_omd_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hs_level VARCHAR(20) NOT NULL, -- 'chapter', 'heading', 'subheading'
  hs_code VARCHAR(10) NOT NULL, -- code associé (2, 4, 6 ou 10 digits)
  ref TEXT NOT NULL, -- référence page/article
  text TEXT NOT NULL,
  version_label TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_hs_omd_notes_code ON public.hs_omd_notes(hs_code);
CREATE INDEX idx_hs_omd_notes_text ON public.hs_omd_notes USING gin(to_tsvector('french', text));

-- Table des articles de loi (lois de finances, circulaires)
CREATE TABLE public.finance_law_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref TEXT NOT NULL, -- article/chapitre
  title TEXT,
  text TEXT NOT NULL,
  keywords JSONB DEFAULT '[]'::jsonb,
  effective_date DATE,
  version_label TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_finance_law_articles_ref ON public.finance_law_articles(ref);
CREATE INDEX idx_finance_law_articles_text ON public.finance_law_articles USING gin(to_tsvector('french', text));

-- Table des DUM historiques (par entreprise)
CREATE TABLE public.dum_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  dum_date DATE NOT NULL,
  dum_number TEXT,
  product_description TEXT NOT NULL,
  hs_code_10 VARCHAR(10) NOT NULL,
  origin_country TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  reliability_score INTEGER DEFAULT 0, -- 0: non validé, 1-5: score confiance
  validated_by UUID REFERENCES auth.users(id),
  validated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_dum_records_company ON public.dum_records(company_id);
CREATE INDEX idx_dum_records_hs_code ON public.dum_records(hs_code_10);
CREATE INDEX idx_dum_records_description ON public.dum_records USING gin(to_tsvector('french', product_description));

-- Table des références croisées HS (voir aussi, exclusions)
CREATE TABLE public.hs_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_code VARCHAR(10) NOT NULL,
  target_code VARCHAR(10) NOT NULL,
  reference_type VARCHAR(20) NOT NULL, -- 'see_also', 'exclusion', 'example', 'range'
  note TEXT,
  version_label TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_hs_references_source ON public.hs_references(source_code);
CREATE INDEX idx_hs_references_target ON public.hs_references(target_code);

-- Enable RLS
ALTER TABLE public.hs_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hs_omd_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_law_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dum_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hs_references ENABLE ROW LEVEL SECURITY;

-- RLS Policies: hs_codes (lecture pour tous les authentifiés, écriture admin)
CREATE POLICY "Authenticated users can view hs_codes"
ON public.hs_codes FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage hs_codes"
ON public.hs_codes FOR ALL
USING (has_role(auth.uid(), 'admin'::user_role));

-- RLS Policies: hs_omd_notes (lecture pour tous, écriture admin)
CREATE POLICY "Authenticated users can view hs_omd_notes"
ON public.hs_omd_notes FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage hs_omd_notes"
ON public.hs_omd_notes FOR ALL
USING (has_role(auth.uid(), 'admin'::user_role));

-- RLS Policies: finance_law_articles (lecture pour tous, écriture admin)
CREATE POLICY "Authenticated users can view finance_law_articles"
ON public.finance_law_articles FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage finance_law_articles"
ON public.finance_law_articles FOR ALL
USING (has_role(auth.uid(), 'admin'::user_role));

-- RLS Policies: dum_records (lecture/écriture par company)
CREATE POLICY "Users can view their company dum_records"
ON public.dum_records FOR SELECT
USING (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Users can insert their company dum_records"
ON public.dum_records FOR INSERT
WITH CHECK (company_id = get_user_company_id(auth.uid()));

CREATE POLICY "Users can update their company dum_records"
ON public.dum_records FOR UPDATE
USING (company_id = get_user_company_id(auth.uid()));

-- RLS Policies: hs_references (lecture pour tous, écriture admin)
CREATE POLICY "Authenticated users can view hs_references"
ON public.hs_references FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage hs_references"
ON public.hs_references FOR ALL
USING (has_role(auth.uid(), 'admin'::user_role));

-- Triggers pour updated_at
CREATE TRIGGER update_hs_codes_updated_at
BEFORE UPDATE ON public.hs_codes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();