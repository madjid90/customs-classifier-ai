// API pour le feedback utilisateur sur les classifications
import { supabase } from "@/integrations/supabase/client";

export type FeedbackType = "correct" | "incorrect" | "partial";

export interface ClassificationFeedback {
  id: string;
  case_id: string;
  result_id: string | null;
  user_id: string;
  feedback_type: FeedbackType;
  suggested_code: string | null;
  comment: string | null;
  rating: number | null;
  use_for_training: boolean;
  created_at: string;
}

export interface SubmitFeedbackParams {
  case_id: string;
  result_id?: string;
  feedback_type: FeedbackType;
  suggested_code?: string;
  comment?: string;
  rating?: number;
}

export async function submitFeedback(params: SubmitFeedbackParams): Promise<ClassificationFeedback> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const { data, error } = await supabase
    .from("classification_feedback")
    .insert({
      case_id: params.case_id,
      result_id: params.result_id || null,
      user_id: user.id,
      feedback_type: params.feedback_type,
      suggested_code: params.suggested_code || null,
      comment: params.comment || null,
      rating: params.rating || null,
      use_for_training: params.feedback_type === "incorrect" && !!params.suggested_code,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as ClassificationFeedback;
}

export async function getFeedbackForCase(caseId: string): Promise<ClassificationFeedback | null> {
  const { data, error } = await supabase
    .from("classification_feedback")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as ClassificationFeedback | null;
}
