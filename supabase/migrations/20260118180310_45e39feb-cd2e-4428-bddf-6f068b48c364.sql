-- Create function to get classification statistics
CREATE OR REPLACE FUNCTION public.get_classification_stats()
RETURNS TABLE(
  total_classifications bigint,
  status_done bigint,
  status_need_info bigint,
  status_error bigint,
  status_low_confidence bigint,
  avg_confidence numeric,
  avg_confidence_done numeric,
  high_confidence_count bigint,
  medium_confidence_count bigint,
  low_confidence_count bigint,
  classifications_today bigint,
  classifications_this_week bigint,
  classifications_this_month bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    COUNT(*)::bigint as total_classifications,
    COUNT(*) FILTER (WHERE status = 'DONE')::bigint as status_done,
    COUNT(*) FILTER (WHERE status = 'NEED_INFO')::bigint as status_need_info,
    COUNT(*) FILTER (WHERE status = 'ERROR')::bigint as status_error,
    COUNT(*) FILTER (WHERE status = 'LOW_CONFIDENCE')::bigint as status_low_confidence,
    COALESCE(AVG(confidence), 0)::numeric as avg_confidence,
    COALESCE(AVG(confidence) FILTER (WHERE status = 'DONE'), 0)::numeric as avg_confidence_done,
    COUNT(*) FILTER (WHERE confidence_level = 'high')::bigint as high_confidence_count,
    COUNT(*) FILTER (WHERE confidence_level = 'medium')::bigint as medium_confidence_count,
    COUNT(*) FILTER (WHERE confidence_level = 'low')::bigint as low_confidence_count,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::bigint as classifications_today,
    COUNT(*) FILTER (WHERE created_at >= date_trunc('week', CURRENT_DATE))::bigint as classifications_this_week,
    COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE))::bigint as classifications_this_month
  FROM public.classification_results;
$$;

-- Create function to get evidence source statistics
CREATE OR REPLACE FUNCTION public.get_evidence_stats()
RETURNS TABLE(
  source_name text,
  usage_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    COALESCE(elem->>'source', 'unknown') as source_name,
    COUNT(*)::bigint as usage_count
  FROM public.classification_results cr,
       jsonb_array_elements(cr.evidence) as elem
  WHERE cr.status IN ('DONE', 'LOW_CONFIDENCE')
  GROUP BY elem->>'source'
  ORDER BY usage_count DESC;
$$;

-- Create function to get daily classification trend
CREATE OR REPLACE FUNCTION public.get_classification_trend(days_back integer DEFAULT 30)
RETURNS TABLE(
  day date,
  done_count bigint,
  need_info_count bigint,
  error_count bigint,
  low_confidence_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (days_back - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date as day
  )
  SELECT 
    ds.day,
    COALESCE(COUNT(*) FILTER (WHERE cr.status = 'DONE'), 0)::bigint as done_count,
    COALESCE(COUNT(*) FILTER (WHERE cr.status = 'NEED_INFO'), 0)::bigint as need_info_count,
    COALESCE(COUNT(*) FILTER (WHERE cr.status = 'ERROR'), 0)::bigint as error_count,
    COALESCE(COUNT(*) FILTER (WHERE cr.status = 'LOW_CONFIDENCE'), 0)::bigint as low_confidence_count
  FROM date_series ds
  LEFT JOIN public.classification_results cr ON DATE(cr.created_at) = ds.day
  GROUP BY ds.day
  ORDER BY ds.day;
$$;