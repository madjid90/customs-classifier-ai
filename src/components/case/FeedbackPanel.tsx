import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, AlertCircle, Star, Loader2 } from "lucide-react";
import { submitFeedback, getFeedbackForCase, type FeedbackType } from "@/lib/feedback-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface FeedbackPanelProps {
  caseId: string;
  resultId?: string;
  recommendedCode?: string;
}

export function FeedbackPanel({ caseId, resultId, recommendedCode }: FeedbackPanelProps) {
  const { toast } = useToast();
  const [feedbackType, setFeedbackType] = useState<FeedbackType | null>(null);
  const [suggestedCode, setSuggestedCode] = useState("");
  const [comment, setComment] = useState("");
  const [rating, setRating] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingFeedback, setExistingFeedback] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadExisting() {
      try {
        const existing = await getFeedbackForCase(caseId);
        if (existing) {
          setExistingFeedback(existing);
          setFeedbackType(existing.feedback_type);
          setSuggestedCode(existing.suggested_code || "");
          setComment(existing.comment || "");
          setRating(existing.rating || 0);
        }
      } catch (e) {
        // Ignore
      } finally {
        setIsLoading(false);
      }
    }
    loadExisting();
  }, [caseId]);

  const handleSubmit = async () => {
    if (!feedbackType) return;
    
    setIsSubmitting(true);
    try {
      await submitFeedback({
        case_id: caseId,
        result_id: resultId,
        feedback_type: feedbackType,
        suggested_code: feedbackType === "incorrect" ? suggestedCode : undefined,
        comment: comment || undefined,
        rating: rating || undefined,
      });
      
      toast({
        title: "Merci pour votre feedback!",
        description: "Votre retour nous aide à améliorer le système.",
      });
      
      setExistingFeedback({ feedback_type: feedbackType });
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Impossible d'enregistrer le feedback",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <Card><CardContent className="py-4"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></CardContent></Card>;
  }

  if (existingFeedback) {
    const icons = { correct: CheckCircle, incorrect: XCircle, partial: AlertCircle };
    const Icon = icons[existingFeedback.feedback_type as FeedbackType];
    const labels = { correct: "Correct", incorrect: "Incorrect", partial: "Partiel" };
    
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-4 flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-primary" />
          <span>Feedback enregistré: <strong>{labels[existingFeedback.feedback_type as FeedbackType]}</strong></span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Évaluer ce résultat</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Feedback Type Buttons */}
        <div className="flex gap-2">
          <Button
            variant={feedbackType === "correct" ? "default" : "outline"}
            size="sm"
            onClick={() => setFeedbackType("correct")}
            className={cn(feedbackType === "correct" && "bg-green-600 hover:bg-green-700")}
          >
            <CheckCircle className="mr-1 h-4 w-4" /> Correct
          </Button>
          <Button
            variant={feedbackType === "incorrect" ? "default" : "outline"}
            size="sm"
            onClick={() => setFeedbackType("incorrect")}
            className={cn(feedbackType === "incorrect" && "bg-destructive hover:bg-destructive/90")}
          >
            <XCircle className="mr-1 h-4 w-4" /> Incorrect
          </Button>
          <Button
            variant={feedbackType === "partial" ? "default" : "outline"}
            size="sm"
            onClick={() => setFeedbackType("partial")}
            className={cn(feedbackType === "partial" && "bg-warning hover:bg-warning/90")}
          >
            <AlertCircle className="mr-1 h-4 w-4" /> Partiel
          </Button>
        </div>

        {/* Suggested Code (if incorrect) */}
        {feedbackType === "incorrect" && (
          <div>
            <label className="text-xs text-muted-foreground">Code HS correct (optionnel)</label>
            <Input
              placeholder="Ex: 8471300000"
              value={suggestedCode}
              onChange={(e) => setSuggestedCode(e.target.value)}
              maxLength={10}
            />
          </div>
        )}

        {/* Rating Stars */}
        {feedbackType && (
          <div>
            <label className="text-xs text-muted-foreground">Note (optionnel)</label>
            <div className="flex gap-1 mt-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(rating === star ? 0 : star)}
                  className="focus:outline-none"
                >
                  <Star
                    className={cn(
                      "h-5 w-5 transition-colors",
                      star <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Comment */}
        {feedbackType && (
          <div>
            <label className="text-xs text-muted-foreground">Commentaire (optionnel)</label>
            <Textarea
              placeholder="Précisions sur le résultat..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
            />
          </div>
        )}

        {/* Submit */}
        {feedbackType && (
          <Button onClick={handleSubmit} disabled={isSubmitting} size="sm" className="w-full">
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Envoyer le feedback
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
