import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { FileUploadZone } from "@/components/case/FileUploadZone";
import { QuestionForm } from "@/components/case/QuestionForm";
import { getCaseDetail, classify } from "@/lib/api-client";
import { supabase } from "@/integrations/supabase/client";
import { CaseDetailResponse, CaseFile, HSResult, CaseStatus } from "@/lib/types";
import { Loader2, Play, AlertCircle, RefreshCw, Package, Wifi, WifiOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { cn } from "@/lib/utils";

export default function AnalyzeCasePage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [caseData, setCaseData] = useState<CaseDetailResponse | null>(null);
  const [files, setFiles] = useState<CaseFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastResult, setLastResult] = useState<HSResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const fetchCaseData = useCallback(async () => {
    if (!caseId) return;
    
    try {
      const response = await getCaseDetail(caseId);
      setCaseData(response.data);
      setFiles(response.data.files);
      setLastResult(response.data.last_result);
      
      // Redirect based on status
      if (response.data.case.status === "RESULT_READY" || response.data.case.status === "VALIDATED") {
        if (response.data.last_result?.evidence && response.data.last_result.evidence.length > 0) {
          navigate(`/cases/${caseId}/result`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setIsLoading(false);
    }
  }, [caseId, navigate]);

  useEffect(() => {
    fetchCaseData();
  }, [fetchCaseData]);

  // Realtime subscription for case updates
  useEffect(() => {
    if (!caseId) return;

    const casesChannel = supabase
      .channel(`case-${caseId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'cases',
          filter: `id=eq.${caseId}`
        },
        (payload) => {
          console.log('Case update:', payload);
          
          // Update case data with proper typing
          setCaseData(prev => {
            if (!prev) return null;
            return {
              ...prev,
              case: { 
                ...prev.case, 
                status: payload.new.status as CaseStatus 
              }
            };
          });

          const newStatus = payload.new.status as CaseStatus;

          // Handle status changes
          if (newStatus === "RESULT_READY" || newStatus === "VALIDATED") {
            sonnerToast.success("Résultat disponible", {
              description: "La classification est terminée",
              action: {
                label: "Voir le résultat",
                onClick: () => navigate(`/cases/${caseId}/result`)
              }
            });
          } else if (newStatus === "ERROR") {
            sonnerToast.error("Erreur de classification", {
              description: "Une erreur s'est produite lors de l'analyse"
            });
          }
        }
      )
      .subscribe((status) => {
        console.log('Case realtime status:', status);
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    // Subscribe to classification_results for live updates
    const resultsChannel = supabase
      .channel(`results-${caseId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'classification_results',
          filter: `case_id=eq.${caseId}`
        },
        (payload) => {
          console.log('New classification result:', payload);
          const newResult = payload.new as HSResult;
          setLastResult(newResult);

          if (newResult.status === "DONE" || newResult.status === "LOW_CONFIDENCE") {
            if (newResult.evidence && Array.isArray(newResult.evidence) && newResult.evidence.length > 0) {
              sonnerToast.success("Classification terminée", {
                description: `Code SH: ${newResult.recommended_code}`,
                action: {
                  label: "Voir",
                  onClick: () => navigate(`/cases/${caseId}/result`)
                }
              });
            }
          } else if (newResult.status === "NEED_INFO") {
            sonnerToast.info("Information requise", {
              description: "Veuillez répondre à la question pour continuer"
            });
          }
        }
      )
      .subscribe();

    // Subscribe to case_files for live file updates
    const filesChannel = supabase
      .channel(`files-${caseId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'case_files',
          filter: `case_id=eq.${caseId}`
        },
        (payload) => {
          console.log('New file attached:', payload);
          const newFile = payload.new as CaseFile;
          // Only add if not already in list (avoid duplicates from our own uploads)
          setFiles(prev => {
            if (prev.some(f => f.id === newFile.id)) return prev;
            return [...prev, newFile];
          });
        }
      )
      .subscribe();

    return () => {
      console.log('Cleaning up realtime subscriptions');
      supabase.removeChannel(casesChannel);
      supabase.removeChannel(resultsChannel);
      supabase.removeChannel(filesChannel);
    };
  }, [caseId, navigate]);

  const handleFileUploaded = (file: CaseFile) => {
    setFiles((prev) => [...prev, file]);
  };

  const handleAnalyze = async () => {
    if (!caseId || !caseData || files.length === 0) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await classify({
        case_id: caseId,
        file_urls: files.map((f) => f.file_url),
        answers,
        context: {
          type_import_export: caseData.case.type_import_export,
          origin_country: caseData.case.origin_country,
        },
      });

      const result = response.data as HSResult;
      setLastResult(result);

      if (result.status === "DONE" || result.status === "LOW_CONFIDENCE") {
        if (result.evidence && result.evidence.length > 0) {
          navigate(`/cases/${caseId}/result`);
        } else {
          toast({
            title: "Resultat incomplet",
            description: "Aucune preuve disponible. Veuillez ajouter plus de documents.",
            variant: "destructive",
          });
        }
      } else if (result.status === "ERROR") {
        setError(result.error_message || "Une erreur s'est produite lors de l'analyse.");
      }
      // NEED_INFO is handled by displaying the question
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors de l'analyse";
      setError(message);
      toast({
        title: "Erreur",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnswer = async (questionId: string, answer: string) => {
    const newAnswers = { ...answers, [questionId]: answer };
    setAnswers(newAnswers);

    // Re-run classification with new answer
    if (!caseId || !caseData) return;

    setIsAnalyzing(true);
    try {
      const response = await classify({
        case_id: caseId,
        file_urls: files.map((f) => f.file_url),
        answers: newAnswers,
        context: {
          type_import_export: caseData.case.type_import_export,
          origin_country: caseData.case.origin_country,
        },
      });

      const result = response.data as HSResult;
      setLastResult(result);

      if (result.status === "DONE" || result.status === "LOW_CONFIDENCE") {
        if (result.evidence && result.evidence.length > 0) {
          navigate(`/cases/${caseId}/result`);
        }
      } else if (result.status === "ERROR") {
        setError(result.error_message || "Une erreur s'est produite.");
      }
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="container py-8">
          <Skeleton className="h-6 w-48 mb-6" />
          
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {/* Main content skeleton */}
            <div className="space-y-6 lg:col-span-2">
              {/* Case header skeleton */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-6 w-6 rounded" />
                      <div className="space-y-2">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </div>
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </div>
                </CardHeader>
              </Card>

              {/* File upload zone skeleton */}
              <Card>
                <CardHeader>
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-56 mt-1" />
                </CardHeader>
                <CardContent>
                  <div className="border-2 border-dashed rounded-lg p-8">
                    <div className="flex flex-col items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-3 p-3 border rounded-lg">
                        <Skeleton className="h-8 w-8 rounded" />
                        <div className="flex-1 space-y-1">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sidebar skeleton */}
            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-48 mt-1" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-3 w-full" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-20" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((i) => (
                      <Skeleton key={i} className="h-4 w-full" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!caseData) {
    return (
      <AppLayout>
        <div className="container py-8">
          <div className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="mt-4 text-lg font-medium">Dossier introuvable</p>
            <Button variant="link" onClick={() => navigate("/dashboard")}>
              Retour au tableau de bord
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container py-8">
        <Breadcrumbs
          items={[
            { label: "Dossiers", href: "/history" },
            { label: caseData.case.product_name.slice(0, 30) + (caseData.case.product_name.length > 30 ? "..." : "") },
          ]}
        />

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="space-y-6 lg:col-span-2">
            {/* Case Header */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Package className="h-6 w-6 text-accent" />
                    <div>
                      <CardTitle className="text-lg">{caseData.case.product_name}</CardTitle>
                      <CardDescription>
                        {caseData.case.type_import_export === "import" ? "Import" : "Export"} - {caseData.case.origin_country}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {realtimeConnected ? (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Mises à jour en temps réel actives">
                        <Wifi className="h-3.5 w-3.5 text-green-500" />
                        <span className="hidden sm:inline">Temps réel</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Connexion temps réel inactive">
                        <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                    <StatusBadge status={caseData.case.status} />
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Error Message */}
            {error && (
              <Card className="border-destructive/50 bg-destructive/5">
                <CardContent className="flex items-center gap-3 py-4">
                  <AlertCircle className="h-5 w-5 text-destructive" />
                  <div className="flex-1">
                    <p className="font-medium text-destructive">Erreur</p>
                    <p className="text-sm text-muted-foreground">{error}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleAnalyze} disabled={isAnalyzing}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reessayer
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Question Form */}
            {lastResult?.status === "NEED_INFO" && lastResult.next_question && (
              <QuestionForm
                question={lastResult.next_question}
                onAnswer={handleAnswer}
                isSubmitting={isAnalyzing}
              />
            )}

            {/* File Upload */}
            <FileUploadZone
              caseId={caseId!}
              existingFiles={files}
              onFileUploaded={handleFileUploaded}
            />
          </div>

          {/* Sidebar - Analyze Button */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Analyse</CardTitle>
                <CardDescription>
                  Lancez l'analyse une fois les documents ajoutes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm">
                  <p className="text-muted-foreground">
                    Documents: <span className="font-medium text-foreground">{files.length}</span>
                  </p>
                </div>

                <Button
                  className="w-full"
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || files.length === 0}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Analyse en cours...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Analyser
                    </>
                  )}
                </Button>

                {files.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center">
                    Ajoutez au moins un document pour lancer l'analyse
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Tips */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Conseils</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>- Ajoutez la fiche technique du produit</li>
                  <li>- La facture aide a identifier le produit</li>
                  <li>- Les photos de l'etiquette sont utiles</li>
                  <li>- Plus de documents = meilleure precision</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
