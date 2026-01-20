import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FeedbackPanel } from "@/components/case/FeedbackPanel";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, ConfidenceBadge } from "@/components/ui/status-badge";
import { getCaseDetail, validateCase, exportPdf, canDisplayResult } from "@/lib/api-client";
import { CaseDetailResponse, EvidenceItem, Alternative, INGESTION_SOURCE_LABELS } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { 
  Loader2, 
  Copy, 
  Download, 
  CheckCircle, 
  AlertTriangle,
  FileText,
  Package,
  ExternalLink,
  Wifi,
  WifiOff,
  RefreshCw,
  XCircle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function ResultPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasRole } = useAuth();

  const [caseData, setCaseData] = useState<CaseDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  useEffect(() => {
    async function fetchCase() {
      if (!caseId) return;
      try {
        const response = await getCaseDetail(caseId);
        setCaseData(response.data);
        
        // If no result or no evidence, redirect back
        if (!response.data.last_result || 
            (response.data.last_result.evidence?.length === 0 && 
             response.data.last_result.status !== "ERROR")) {
          navigate(`/cases/${caseId}/analyze`);
        }
      } catch (err) {
        toast({
          title: "Erreur",
          description: err instanceof Error ? err.message : "Erreur de chargement",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    }
    fetchCase();
  }, [caseId, navigate, toast]);

  // Realtime subscription for case status updates
  useEffect(() => {
    if (!caseId) return;

    const channel = supabase
      .channel(`result-case-${caseId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'cases',
          filter: `id=eq.${caseId}`,
        },
        async (payload) => {
          const newCase = payload.new as any;
          
          // Update case data
          setCaseData(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              case: {
                ...prev.case,
                status: newCase.status,
                validated_at: newCase.validated_at,
                validated_by: newCase.validated_by,
              }
            };
          });

          // Show notification for validation
          if (newCase.status === 'VALIDATED' && newCase.validated_at) {
            sonnerToast.success("Dossier validé", {
              description: "Ce dossier a été validé avec succès.",
            });
          }
        }
      )
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [caseId]);

  const handleCopyCode = () => {
    if (caseData?.last_result?.recommended_code) {
      navigator.clipboard.writeText(caseData.last_result.recommended_code);
      toast({
        title: "Code copie",
        description: "Le code SH a ete copie dans le presse-papiers.",
      });
    }
  };

  const handleExportPdf = async () => {
    if (!caseId) return;
    setIsExporting(true);
    try {
      const response = await exportPdf(caseId);
      window.open(response.data.download_url, "_blank");
      toast({
        title: "Export reussi",
        description: "Le PDF a ete genere avec succes.",
      });
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Impossible d'exporter le PDF.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleValidate = async () => {
    if (!caseId) return;
    setIsValidating(true);
    try {
      await validateCase(caseId);
      toast({
        title: "Dossier valide",
        description: "Le resultat a ete valide avec succes.",
      });
      // Refresh data
      const response = await getCaseDetail(caseId);
      setCaseData(response.data);
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Impossible de valider.",
        variant: "destructive",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const formatHSCode = (code: string) => {
    // Format: XXXX.XX.XX.XX
    const cleaned = code.replace(/\D/g, "");
    if (cleaned.length <= 4) return cleaned;
    if (cleaned.length <= 6) return `${cleaned.slice(0, 4)}.${cleaned.slice(4)}`;
    if (cleaned.length <= 8) return `${cleaned.slice(0, 4)}.${cleaned.slice(4, 6)}.${cleaned.slice(6)}`;
    return `${cleaned.slice(0, 4)}.${cleaned.slice(4, 6)}.${cleaned.slice(6, 8)}.${cleaned.slice(8)}`;
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="container py-8">
          <Skeleton className="h-6 w-48 mb-6" />
          
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {/* Main content skeleton */}
            <div className="space-y-6 lg:col-span-2">
              {/* HS Code Result skeleton */}
              <Card>
                <CardHeader>
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
                <CardContent className="space-y-6">
                  {/* Main code skeleton */}
                  <div className="rounded-lg border bg-muted/30 p-6 text-center">
                    <Skeleton className="h-4 w-40 mx-auto mb-2" />
                    <Skeleton className="h-10 w-56 mx-auto" />
                    <Skeleton className="h-6 w-24 mx-auto mt-3 rounded-full" />
                  </div>
                  
                  {/* Justification skeleton */}
                  <div>
                    <Skeleton className="h-5 w-24 mb-2" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4 mt-1" />
                  </div>
                  
                  {/* Actions skeleton */}
                  <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-9 w-32" />
                    <Skeleton className="h-9 w-36" />
                    <Skeleton className="h-9 w-24" />
                  </div>
                </CardContent>
              </Card>

              {/* Alternatives skeleton */}
              <Card>
                <CardHeader className="pb-3">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-4 w-48 mt-1" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[1, 2].map((i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-1">
                          <Skeleton className="h-5 w-32" />
                          <Skeleton className="h-4 w-48" />
                        </div>
                        <Skeleton className="h-4 w-12" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Evidence skeleton */}
              <Card>
                <CardHeader className="pb-3">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-4 w-56 mt-1" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[1, 2].map((i) => (
                      <div key={i} className="rounded-lg border p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Skeleton className="h-4 w-4" />
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-2/3 mt-1" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sidebar skeleton */}
            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex justify-between">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-28" />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-36" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 flex-1" />
                        <Skeleton className="h-4 w-4" />
                      </div>
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

  // ===== ANTI-HALLUCINATION UI RULES =====
  // RULE: Never display result without evidence
  if (!caseData || !caseData.last_result) {
    return (
      <AppLayout>
        <div className="container py-8">
          <div className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-warning" />
            <p className="mt-4 text-lg font-medium">Resultat non disponible</p>
            <Button variant="link" onClick={() => navigate(`/cases/${caseId}/analyze`)}>
              Retour a l'analyse
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const result = caseData.last_result;
  
  // ===== STATUS-BASED UI RENDERING =====
  // ERROR: Show error message + retry button
  if (result.status === "ERROR") {
    return (
      <AppLayout>
        <div className="container py-8">
          <Breadcrumbs
            items={[
              { label: "Dossiers", href: "/history" },
              { label: caseData.case.product_name.slice(0, 30) },
            ]}
          />
          <Card className="mt-6 border-destructive/50 bg-destructive/5">
            <CardContent className="flex flex-col items-center py-12">
              <XCircle className="h-12 w-12 text-destructive" />
              <p className="mt-4 text-lg font-medium text-destructive">Erreur de classification</p>
              <p className="mt-2 text-sm text-muted-foreground text-center max-w-md">
                {result.error_message || "Une erreur s'est produite lors de l'analyse."}
              </p>
              <Button className="mt-6" onClick={() => navigate(`/cases/${caseId}/analyze`)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Réessayer l'analyse
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  // NEED_INFO: Should not reach this page - redirect to analyze
  if (result.status === "NEED_INFO") {
    navigate(`/cases/${caseId}/analyze`);
    return null;
  }

  // ANTI-HALLUCINATION: Never display code without evidence
  if (!canDisplayResult(result)) {
    return (
      <AppLayout>
        <div className="container py-8">
          <Breadcrumbs
            items={[
              { label: "Dossiers", href: "/history" },
              { label: caseData.case.product_name.slice(0, 30) },
            ]}
          />
          <Card className="mt-6 border-warning/50 bg-warning/5">
            <CardContent className="flex flex-col items-center py-12">
              <AlertTriangle className="h-12 w-12 text-warning" />
              <p className="mt-4 text-lg font-medium text-warning">Résultat non affichable</p>
              <p className="mt-2 text-sm text-muted-foreground text-center max-w-md">
                La classification n'a pas pu être vérifiée car aucune preuve documentaire n'est disponible.
                Veuillez ajouter des documents supplémentaires pour obtenir une classification fiable.
              </p>
              <Button className="mt-6" onClick={() => navigate(`/cases/${caseId}/analyze`)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Ajouter des documents
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const canValidate = hasRole(["admin", "manager"]) && caseData.case.status === "RESULT_READY";

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
          {/* Main Result */}
          <div className="space-y-6 lg:col-span-2">
            {/* HS Code Result */}
            <Card>
              <CardHeader>
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
                  <div className="flex items-center gap-2">
                    {realtimeConnected ? (
                      <Wifi className="h-4 w-4 text-green-500" />
                    ) : (
                      <WifiOff className="h-4 w-4 text-muted-foreground" />
                    )}
                    <StatusBadge status={caseData.case.status} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Main Code - Only displayed if canDisplayResult passed */}
                {result.recommended_code && (
                  <div className="rounded-lg border bg-muted/30 p-6 text-center">
                    <p className="text-sm text-muted-foreground mb-2">Code SH / Nomenclature Maroc</p>
                    <p className="hs-code text-3xl text-primary">
                      {formatHSCode(result.recommended_code)}
                    </p>
                    <div className="mt-3 flex items-center justify-center gap-2">
                      <ConfidenceBadge level={result.confidence_level} percentage={result.confidence} />
                    </div>
                  </div>
                )}

                {/* Low Confidence Warning */}
                {result.status === "LOW_CONFIDENCE" && (
                  <div className="flex items-start gap-3 rounded-lg border border-warning/50 bg-warning/5 p-4">
                    <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
                    <div>
                      <p className="font-medium text-warning">Confiance faible</p>
                      <p className="text-sm text-muted-foreground">
                        Ce resultat necessite une verification manuelle. Ajoutez des documents supplementaires pour ameliorer la precision.
                      </p>
                    </div>
                  </div>
                )}

                {/* Justification détaillée */}
                {result.justification_detailed ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-medium mb-2 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary" />
                        Justification IA
                      </h3>
                      <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                        {result.justification_detailed.summary}
                      </p>
                    </div>

                    {/* Raisonnement étape par étape */}
                    {result.justification_detailed.reasoning_steps?.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Raisonnement</h4>
                        <ol className="space-y-2 text-sm">
                          {result.justification_detailed.reasoning_steps.map((step: string, idx: number) => (
                            <li key={idx} className="flex gap-2">
                              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">
                                {idx + 1}
                              </span>
                              <span className="text-muted-foreground">{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* Sources citées */}
                    {result.justification_detailed.sources_cited?.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Sources consultées</h4>
                        <div className="space-y-2">
                          {result.justification_detailed.sources_cited.map((source: any, idx: number) => (
                            <div key={idx} className="flex items-start gap-2 text-sm rounded-lg border p-2 bg-muted/30">
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-accent/20 text-accent-foreground">
                                {source.source}
                              </span>
                              <div className="flex-1">
                                <p className="font-medium text-foreground">{source.reference}</p>
                                <p className="text-xs text-muted-foreground">{source.relevance}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Facteurs clés */}
                    {result.justification_detailed.key_factors?.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Facteurs déterminants</h4>
                        <div className="flex flex-wrap gap-2">
                          {result.justification_detailed.key_factors.map((factor: string, idx: number) => (
                            <span key={idx} className="px-3 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20">
                              {factor}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : result.justification_short && (
                  <div>
                    <h3 className="font-medium mb-2">Justification</h3>
                    <p className="text-sm text-muted-foreground">{result.justification_short}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopyCode}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copier le code
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={isExporting}>
                    {isExporting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Telecharger PDF
                  </Button>
                  {canValidate && (
                    <Button size="sm" onClick={handleValidate} disabled={isValidating}>
                      {isValidating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="mr-2 h-4 w-4" />
                      )}
                      Valider
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Alternatives */}
            {result.alternatives && result.alternatives.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Codes alternatifs</CardTitle>
                  <CardDescription>
                    Autres classifications possibles
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {result.alternatives.map((alt: Alternative, index: number) => (
                      <div key={index} className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <p className="font-mono font-medium">{formatHSCode(alt.code)}</p>
                          <p className="text-sm text-muted-foreground">{alt.reason}</p>
                        </div>
                        <span className="text-sm text-muted-foreground font-mono">
                          {Math.round((alt.confidence <= 1 ? alt.confidence * 100 : alt.confidence))}%
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Evidence */}
            {result.evidence && result.evidence.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Preuves et sources</CardTitle>
                  <CardDescription>
                    Documents justifiant la classification
                  </CardDescription>
                  {/* Légende des sources */}
                  <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                      📚 Sources internes = vérifiées
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-orange-500"></span>
                      🌐 Sources externes = à vérifier
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {result.evidence.map((ev: EvidenceItem, index: number) => {
                      const isExternal = ev.external === true;
                      
                      const handleCopyCitation = () => {
                        const citationText = `Source: ${INGESTION_SOURCE_LABELS[ev.source] || ev.source}, Référence: ${ev.ref}${ev.source_url ? `, URL: ${ev.source_url}` : ""}${ev.page_number ? `, Page: ${ev.page_number}` : ""}, Extrait: "${ev.excerpt}"`;
                        navigator.clipboard.writeText(citationText);
                        toast({
                          title: "Citation copiée",
                          description: "La citation a été copiée dans le presse-papiers.",
                        });
                      };

                      return (
                        <div 
                          key={index} 
                          className={`rounded-lg border p-4 ${
                            isExternal 
                              ? "border-orange-200 bg-orange-50/50 dark:border-orange-800/50 dark:bg-orange-950/20" 
                              : "border-border bg-background"
                          }`}
                        >
                          <div className="flex items-center flex-wrap gap-2 mb-2">
                            <FileText className={`h-4 w-4 ${isExternal ? "text-orange-500" : "text-accent"}`} />
                            <span className="text-sm font-medium">
                              {INGESTION_SOURCE_LABELS[ev.source] || ev.source}
                            </span>
                            
                            {/* Badge source type */}
                            {isExternal ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                                🌐 Source externe
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                📚 Base interne
                              </span>
                            )}
                            
                            {/* Référence avec lien cliquable si source_url existe */}
                            {ev.source_url ? (
                              <a
                                href={ev.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                {ev.ref}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {ev.ref}
                              </span>
                            )}
                            
                            {/* Numéro de page si disponible */}
                            {ev.page_number && (
                              <span className="text-xs text-muted-foreground">
                                (page {ev.page_number})
                              </span>
                            )}
                          </div>
                          
                          <p className="text-sm text-muted-foreground italic mb-3">
                            "{ev.excerpt}"
                          </p>
                          
                          {/* Note de vérification pour sources externes */}
                          {isExternal && (
                            <p className="text-xs text-orange-600 dark:text-orange-400 mb-2 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Résultat trouvé via recherche web - vérifiez la source originale
                            </p>
                          )}
                          
                          {/* Bouton copier citation */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCopyCitation}
                            className="h-7 text-xs"
                          >
                            <Copy className="mr-1 h-3 w-3" />
                            Copier citation
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar - Info */}
          <div className="space-y-6">
            {/* Case Info */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Informations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cree le</span>
                  <span>{format(new Date(caseData.case.created_at), "dd MMM yyyy HH:mm", { locale: fr })}</span>
                </div>
                {caseData.case.validated_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valide le</span>
                    <span>{format(new Date(caseData.case.validated_at), "dd MMM yyyy HH:mm", { locale: fr })}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Documents</span>
                  <span>{caseData.files.length}</span>
                </div>
              </CardContent>
            </Card>

            {/* Files */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Documents attaches</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {caseData.files.map((file) => (
                    <div key={file.id} className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate flex-1">{file.filename}</span>
                      <a 
                        href={file.file_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
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
