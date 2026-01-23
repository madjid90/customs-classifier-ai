import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  PlayCircle, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Database, 
  Cpu, 
  AlertTriangle,
  Loader2,
  FileText,
  Search,
  Zap
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { classify, createCase } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import type { HSResult } from "@/lib/types";

interface TestResult {
  step: string;
  status: "pending" | "running" | "success" | "error" | "warning";
  message: string;
  duration?: number;
  details?: any;
}

interface PipelineStats {
  hsCodes: { total: number; withEmbedding: number };
  kbChunks: { total: number; withEmbedding: number };
  classifications: number;
}

export function PipelineTest() {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [lastClassification, setLastClassification] = useState<HSResult | null>(null);
  const [testCaseId, setTestCaseId] = useState<string | null>(null);

  // Fetch stats on mount
  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const { data, error } = await supabase.rpc("get_ingestion_stats");
      if (error) throw error;
      
      const statsData = data as any;
      
      // Get classification count
      const { count } = await supabase
        .from("classification_results")
        .select("*", { count: "exact", head: true });

      setStats({
        hsCodes: {
          total: statsData?.hs_codes?.total || 0,
          withEmbedding: statsData?.hs_codes?.with_embedding || 0,
        },
        kbChunks: {
          total: statsData?.kb_chunks?.total || 0,
          withEmbedding: statsData?.kb_chunks?.with_embedding || 0,
        },
        classifications: count || 0,
      });
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  };

  const updateResult = (step: string, update: Partial<TestResult>) => {
    setTestResults(prev => 
      prev.map(r => r.step === step ? { ...r, ...update } : r)
    );
  };

  const runPipelineTest = async () => {
    setIsRunning(true);
    setTestResults([]);
    setLastClassification(null);

    const steps: TestResult[] = [
      { step: "1. Vérification données HS", status: "pending", message: "" },
      { step: "2. Vérification KB", status: "pending", message: "" },
      { step: "3. Vérification embeddings", status: "pending", message: "" },
      { step: "4. Création cas test", status: "pending", message: "" },
      { step: "5. Appel classification", status: "pending", message: "" },
      { step: "6. Validation résultat", status: "pending", message: "" },
    ];
    setTestResults(steps);

    try {
      // Step 1: Check HS codes
      updateResult("1. Vérification données HS", { status: "running", message: "Vérification..." });
      const startHs = Date.now();
      
      const { count: hsCount } = await supabase
        .from("hs_codes")
        .select("*", { count: "exact", head: true })
        .eq("active", true);
      
      if (hsCount && hsCount > 0) {
        updateResult("1. Vérification données HS", { 
          status: "success", 
          message: `${hsCount} codes HS actifs`,
          duration: Date.now() - startHs,
        });
      } else {
        updateResult("1. Vérification données HS", { 
          status: "error", 
          message: "Aucun code HS trouvé",
          duration: Date.now() - startHs,
        });
        throw new Error("No HS codes");
      }

      // Step 2: Check KB chunks
      updateResult("2. Vérification KB", { status: "running", message: "Vérification..." });
      const startKb = Date.now();
      
      const { count: kbCount } = await supabase
        .from("kb_chunks")
        .select("*", { count: "exact", head: true });
      
      if (kbCount && kbCount > 0) {
        updateResult("2. Vérification KB", { 
          status: "success", 
          message: `${kbCount} chunks KB`,
          duration: Date.now() - startKb,
        });
      } else {
        updateResult("2. Vérification KB", { 
          status: "warning", 
          message: "Aucun chunk KB - recherche textuelle uniquement",
          duration: Date.now() - startKb,
        });
      }

      // Step 3: Check embeddings
      updateResult("3. Vérification embeddings", { status: "running", message: "Vérification..." });
      const startEmb = Date.now();
      
      const { data: hsWithEmb } = await supabase
        .from("hs_codes")
        .select("code_10")
        .not("embedding", "is", null)
        .limit(1);
      
      const { data: kbWithEmb } = await supabase
        .from("kb_chunks")
        .select("id")
        .not("embedding", "is", null)
        .limit(1);
      
      const hasHsEmb = hsWithEmb && hsWithEmb.length > 0;
      const hasKbEmb = kbWithEmb && kbWithEmb.length > 0;
      
      if (hasHsEmb || hasKbEmb) {
        updateResult("3. Vérification embeddings", { 
          status: "success", 
          message: `HS: ${hasHsEmb ? "✓" : "✗"}, KB: ${hasKbEmb ? "✓" : "✗"}`,
          duration: Date.now() - startEmb,
        });
      } else {
        updateResult("3. Vérification embeddings", { 
          status: "warning", 
          message: "Aucun embedding - recherche textuelle uniquement",
          duration: Date.now() - startEmb,
        });
      }

      // Step 4: Create test case
      updateResult("4. Création cas test", { status: "running", message: "Création..." });
      const startCase = Date.now();
      
      const caseResponse = await createCase({
        type_import_export: "import",
        origin_country: "CN",
        product_name: "Chemise en coton pour homme - taille L - 100% coton tissé",
      });
      
      const newCaseId = caseResponse.data?.id;
      if (!newCaseId) {
        throw new Error("Failed to create case");
      }
      
      setTestCaseId(newCaseId);
      updateResult("4. Création cas test", { 
        status: "success", 
        message: `Case ID: ${newCaseId.slice(0, 8)}...`,
        duration: Date.now() - startCase,
      });

      // Step 5: Run classification
      updateResult("5. Appel classification", { status: "running", message: "Classification en cours..." });
      const startClassify = Date.now();
      
      const classifyResponse = await classify({
        case_id: newCaseId,
        file_urls: [],
        answers: {},
        context: {
          type_import_export: "import",
          origin_country: "CN",
        },
      });
      
      const result = classifyResponse.data;
      setLastClassification(result);
      
      const classifyDuration = Date.now() - startClassify;
      
      if (result.status === "ERROR") {
        updateResult("5. Appel classification", { 
          status: "error", 
          message: result.error_message || "Erreur inconnue",
          duration: classifyDuration,
        });
      } else {
        updateResult("5. Appel classification", { 
          status: "success", 
          message: `Status: ${result.status} (${(classifyDuration / 1000).toFixed(1)}s)`,
          duration: classifyDuration,
        });
      }

      // Step 6: Validate result structure
      updateResult("6. Validation résultat", { status: "running", message: "Validation..." });
      const startValidate = Date.now();
      
      const validationErrors: string[] = [];
      
      if (!result.status) validationErrors.push("status manquant");
      if (result.status === "DONE" || result.status === "LOW_CONFIDENCE") {
        if (!result.recommended_code) validationErrors.push("recommended_code manquant");
        if (result.recommended_code && !/^\d{10}$/.test(result.recommended_code)) {
          validationErrors.push("recommended_code invalide (doit être 10 chiffres)");
        }
        if (result.confidence === undefined) validationErrors.push("confidence manquant");
        if (!result.evidence || result.evidence.length === 0) {
          validationErrors.push("evidence vide");
        }
      }
      
      if (validationErrors.length > 0) {
        updateResult("6. Validation résultat", { 
          status: "error", 
          message: validationErrors.join(", "),
          duration: Date.now() - startValidate,
        });
      } else {
        updateResult("6. Validation résultat", { 
          status: "success", 
          message: "Structure conforme",
          duration: Date.now() - startValidate,
          details: {
            code: result.recommended_code,
            confidence: result.confidence,
            evidenceCount: result.evidence?.length || 0,
          },
        });
      }

      // Refresh stats
      await fetchStats();
      
      toast({
        title: "Test pipeline terminé",
        description: `Classification: ${result.status}`,
      });

    } catch (error: any) {
      console.error("Pipeline test error:", error);
      
      // Mark remaining steps as error
      setTestResults(prev => 
        prev.map(r => 
          r.status === "pending" || r.status === "running" 
            ? { ...r, status: "error" as const, message: "Annulé" }
            : r
        )
      );
      
      toast({
        title: "Erreur test pipeline",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "pending": return <Clock className="h-4 w-4 text-muted-foreground" />;
      case "running": return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "success": return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
      case "warning": return <AlertTriangle className="h-4 w-4 text-amber-600" />;
      case "error": return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  const getStatusBadge = (status: TestResult["status"]) => {
    const variants: Record<TestResult["status"], "secondary" | "default" | "destructive" | "outline"> = {
      pending: "secondary",
      running: "default",
      success: "default",
      warning: "outline",
      error: "destructive",
    };
    return variants[status];
  };

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Codes HS</span>
            </div>
            <div className="mt-1 text-2xl font-bold">
              {stats?.hsCodes.total || 0}
            </div>
            <div className="text-xs text-muted-foreground">
              {stats?.hsCodes.withEmbedding || 0} avec embeddings
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">KB Chunks</span>
            </div>
            <div className="mt-1 text-2xl font-bold">
              {stats?.kbChunks.total || 0}
            </div>
            <div className="text-xs text-muted-foreground">
              {stats?.kbChunks.withEmbedding || 0} avec embeddings
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Classifications</span>
            </div>
            <div className="mt-1 text-2xl font-bold">
              {stats?.classifications || 0}
            </div>
            <div className="text-xs text-muted-foreground">
              résultats en base
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Statut RAG</span>
            </div>
            <div className="mt-1">
              {stats?.hsCodes.withEmbedding && stats.hsCodes.withEmbedding > 0 ? (
                <Badge className="bg-emerald-600 text-white">Actif</Badge>
              ) : (
                <Badge variant="secondary">Textuel uniquement</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Test Runner */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5" />
                Test Pipeline E2E
              </CardTitle>
              <CardDescription>
                Valide le pipeline complet : données → classification → résultat
              </CardDescription>
            </div>
            <Button 
              onClick={runPipelineTest} 
              disabled={isRunning}
              size="lg"
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  En cours...
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Lancer le test
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {testResults.length === 0 ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Aucun test exécuté</AlertTitle>
              <AlertDescription>
                Cliquez sur "Lancer le test" pour valider le pipeline de classification.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {testResults.map((result) => (
                <div 
                  key={result.step}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(result.status)}
                    <span className="font-medium">{result.step}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {result.duration && (
                      <span className="text-xs text-muted-foreground">
                        {result.duration}ms
                      </span>
                    )}
                    <Badge variant={getStatusBadge(result.status)}>
                      {result.message || result.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Classification Result */}
      {lastClassification && (
        <Card>
          <CardHeader>
            <CardTitle>Résultat de Classification</CardTitle>
            <CardDescription>
              Case ID: {testCaseId?.slice(0, 8)}...
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h4 className="font-medium mb-2">Statut</h4>
                <Badge 
                  variant={lastClassification.status === "DONE" ? "default" : 
                           lastClassification.status === "ERROR" ? "destructive" : "secondary"}
                  className="text-sm"
                >
                  {lastClassification.status}
                </Badge>
              </div>
              
              {lastClassification.recommended_code && (
                <div>
                  <h4 className="font-medium mb-2">Code Recommandé</h4>
                  <code className="text-lg font-mono bg-muted px-2 py-1 rounded">
                    {lastClassification.recommended_code}
                  </code>
                </div>
              )}
              
              {lastClassification.confidence !== undefined && (
                <div>
                  <h4 className="font-medium mb-2">Confiance</h4>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold">
                      {(lastClassification.confidence * 100).toFixed(0)}%
                    </span>
                    <Badge variant="outline">{lastClassification.confidence_level}</Badge>
                  </div>
                </div>
              )}
              
              {lastClassification.evidence && lastClassification.evidence.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Sources</h4>
                  <div className="flex flex-wrap gap-1">
                    {lastClassification.evidence.slice(0, 5).map((e, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {e.source}: {e.ref?.slice(0, 20)}...
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {lastClassification.justification_short && (
                <div className="md:col-span-2">
                  <h4 className="font-medium mb-2">Justification</h4>
                  <p className="text-sm text-muted-foreground">
                    {lastClassification.justification_short}
                  </p>
                </div>
              )}
              
              {lastClassification.error_message && (
                <div className="md:col-span-2">
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertTitle>Erreur</AlertTitle>
                    <AlertDescription>
                      {lastClassification.error_message}
                    </AlertDescription>
                  </Alert>
                </div>
              )}
              
              {lastClassification.next_question && (
                <div className="md:col-span-2">
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Question Requise</AlertTitle>
                    <AlertDescription>
                      {lastClassification.next_question.label}
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
