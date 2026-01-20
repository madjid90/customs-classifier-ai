-- ============================================================================
-- Table classification_feedback - Feedback utilisateur sur les classifications
-- ============================================================================

CREATE TABLE public.classification_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  result_id UUID REFERENCES public.classification_results(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  
  -- Type de feedback
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('correct', 'incorrect', 'partial')),
  
  -- Code suggéré si incorrect
  suggested_code VARCHAR(10),
  
  -- Commentaire libre
  comment TEXT,
  
  -- Note de 1 à 5
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  
  -- Flag pour training examples
  use_for_training BOOLEAN DEFAULT false,
  
  -- Métadonnées
  meta JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index pour recherches fréquentes
CREATE INDEX idx_feedback_case_id ON public.classification_feedback(case_id);
CREATE INDEX idx_feedback_user_id ON public.classification_feedback(user_id);
CREATE INDEX idx_feedback_type ON public.classification_feedback(feedback_type);
CREATE INDEX idx_feedback_training ON public.classification_feedback(use_for_training) WHERE use_for_training = true;
CREATE INDEX idx_feedback_created_at ON public.classification_feedback(created_at DESC);

-- Enable RLS
ALTER TABLE public.classification_feedback ENABLE ROW LEVEL SECURITY;

-- Policies
-- Authentification requise
CREATE POLICY "feedback_require_auth" ON public.classification_feedback
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Les utilisateurs peuvent créer du feedback pour les dossiers de leur entreprise
CREATE POLICY "Users can insert feedback for company cases" ON public.classification_feedback
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = classification_feedback.case_id
      AND c.company_id = get_user_company_id(auth.uid())
    )
    AND user_id = auth.uid()
  );

-- Les utilisateurs peuvent voir le feedback des dossiers de leur entreprise
CREATE POLICY "Users can view feedback for company cases" ON public.classification_feedback
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = classification_feedback.case_id
      AND c.company_id = get_user_company_id(auth.uid())
    )
  );

-- Les utilisateurs peuvent modifier leur propre feedback
CREATE POLICY "Users can update own feedback" ON public.classification_feedback
  FOR UPDATE USING (user_id = auth.uid());

-- Les utilisateurs peuvent supprimer leur propre feedback
CREATE POLICY "Users can delete own feedback" ON public.classification_feedback
  FOR DELETE USING (user_id = auth.uid());

-- Trigger pour updated_at
CREATE TRIGGER update_feedback_updated_at
  BEFORE UPDATE ON public.classification_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Fonction pour obtenir les stats de feedback
CREATE OR REPLACE FUNCTION public.get_feedback_stats()
RETURNS TABLE(
  total_feedback BIGINT,
  correct_count BIGINT,
  incorrect_count BIGINT,
  partial_count BIGINT,
  avg_rating NUMERIC,
  training_examples BIGINT
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    COUNT(*)::bigint as total_feedback,
    COUNT(*) FILTER (WHERE feedback_type = 'correct')::bigint as correct_count,
    COUNT(*) FILTER (WHERE feedback_type = 'incorrect')::bigint as incorrect_count,
    COUNT(*) FILTER (WHERE feedback_type = 'partial')::bigint as partial_count,
    COALESCE(AVG(rating), 0)::numeric as avg_rating,
    COUNT(*) FILTER (WHERE use_for_training = true)::bigint as training_examples
  FROM public.classification_feedback;
$$;

-- Fonction pour obtenir les feedbacks pour training
CREATE OR REPLACE FUNCTION public.get_training_examples(limit_count INTEGER DEFAULT 100)
RETURNS TABLE(
  case_id UUID,
  original_code TEXT,
  suggested_code TEXT,
  feedback_type TEXT,
  comment TEXT,
  rating INTEGER,
  product_name TEXT,
  origin_country TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    cf.case_id,
    cr.recommended_code as original_code,
    cf.suggested_code,
    cf.feedback_type,
    cf.comment,
    cf.rating,
    c.product_name,
    c.origin_country
  FROM public.classification_feedback cf
  JOIN public.cases c ON c.id = cf.case_id
  LEFT JOIN public.classification_results cr ON cr.id = cf.result_id
  WHERE cf.use_for_training = true
  ORDER BY cf.created_at DESC
  LIMIT limit_count;
$$;