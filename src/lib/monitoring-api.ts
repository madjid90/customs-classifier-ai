import { supabase } from "@/integrations/supabase/client";

export interface ClassificationStats {
  total_classifications: number;
  status_done: number;
  status_need_info: number;
  status_error: number;
  status_low_confidence: number;
  avg_confidence: number;
  avg_confidence_done: number;
  high_confidence_count: number;
  medium_confidence_count: number;
  low_confidence_count: number;
  classifications_today: number;
  classifications_this_week: number;
  classifications_this_month: number;
}

export interface EvidenceStats {
  source_name: string;
  usage_count: number;
}

export interface ClassificationTrend {
  day: string;
  done_count: number;
  need_info_count: number;
  error_count: number;
  low_confidence_count: number;
}

export async function getClassificationStats(): Promise<ClassificationStats> {
  const { data, error } = await supabase.rpc('get_classification_stats');
  
  if (error) {
    console.error("Erreur récupération stats classification:", error);
    throw new Error(error.message);
  }
  
  if (!data || data.length === 0) {
    return {
      total_classifications: 0,
      status_done: 0,
      status_need_info: 0,
      status_error: 0,
      status_low_confidence: 0,
      avg_confidence: 0,
      avg_confidence_done: 0,
      high_confidence_count: 0,
      medium_confidence_count: 0,
      low_confidence_count: 0,
      classifications_today: 0,
      classifications_this_week: 0,
      classifications_this_month: 0,
    };
  }
  
  const row = data[0];
  return {
    total_classifications: Number(row.total_classifications) || 0,
    status_done: Number(row.status_done) || 0,
    status_need_info: Number(row.status_need_info) || 0,
    status_error: Number(row.status_error) || 0,
    status_low_confidence: Number(row.status_low_confidence) || 0,
    avg_confidence: Number(row.avg_confidence) || 0,
    avg_confidence_done: Number(row.avg_confidence_done) || 0,
    high_confidence_count: Number(row.high_confidence_count) || 0,
    medium_confidence_count: Number(row.medium_confidence_count) || 0,
    low_confidence_count: Number(row.low_confidence_count) || 0,
    classifications_today: Number(row.classifications_today) || 0,
    classifications_this_week: Number(row.classifications_this_week) || 0,
    classifications_this_month: Number(row.classifications_this_month) || 0,
  };
}

export async function getEvidenceStats(): Promise<EvidenceStats[]> {
  const { data, error } = await supabase.rpc('get_evidence_stats');
  
  if (error) {
    console.error("Erreur récupération stats preuves:", error);
    throw new Error(error.message);
  }
  
  return (data || []).map((row: { source_name: string; usage_count: number }) => ({
    source_name: row.source_name || 'unknown',
    usage_count: Number(row.usage_count) || 0,
  }));
}

export async function getClassificationTrend(daysBack: number = 30): Promise<ClassificationTrend[]> {
  const { data, error } = await supabase.rpc('get_classification_trend', { 
    days_back: daysBack 
  });
  
  if (error) {
    console.error("Erreur récupération tendance:", error);
    throw new Error(error.message);
  }
  
  return (data || []).map((row: { 
    day: string; 
    done_count: number; 
    need_info_count: number; 
    error_count: number; 
    low_confidence_count: number 
  }) => ({
    day: row.day,
    done_count: Number(row.done_count) || 0,
    need_info_count: Number(row.need_info_count) || 0,
    error_count: Number(row.error_count) || 0,
    low_confidence_count: Number(row.low_confidence_count) || 0,
  }));
}
