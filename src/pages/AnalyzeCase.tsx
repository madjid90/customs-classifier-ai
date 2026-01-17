import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { FileUploadZone } from "@/components/case/FileUploadZone";
import { QuestionForm } from "@/components/case/QuestionForm";
import { getCaseDetail, classify } from "@/lib/api-client";
import { CaseDetailResponse, CaseFile, HSResult } from "@/lib/types";
import { Loader2, Play, AlertCircle, RefreshCw, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
                  <StatusBadge status={caseData.case.status} />
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
