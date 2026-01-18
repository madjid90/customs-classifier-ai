import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Database,
  FileText,
  Loader2,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Zap,
  Upload,
} from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

interface IngestionStats {
  hs_codes: { total: number; with_embedding: number };
  kb_chunks: { total: number; with_embedding: number };
}

interface ActionResult {
  success: boolean;
  processed?: number;
  remaining?: number;
  error?: string;
}

export function DataIngestionPanel() {
  const { toast } = useToast();
  const [stats, setStats] = useState<IngestionStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  
  // Loading states for each action
  const [isGeneratingHSCodes, setIsGeneratingHSCodes] = useState(false);
  const [isGeneratingKBChunks, setIsGeneratingKBChunks] = useState(false);
  const [isEnrichingHS, setIsEnrichingHS] = useState(false);
  const [isGeneratingHSEmbeddings, setIsGeneratingHSEmbeddings] = useState(false);
  const [isGeneratingKBEmbeddings, setIsGeneratingKBEmbeddings] = useState(false);
  const [isGeneratingDUM, setIsGeneratingDUM] = useState(false);
  
  // DUM generation count
  const [dumCount, setDumCount] = useState(100);

  useEffect(() => {
    fetchStats();
  }, []);

  async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token}`,
    };
  }

  async function fetchStats() {
    setIsLoadingStats(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-synthetic-data`, {
        method: "POST",
        headers,
        body: JSON.stringify({ mode: "stats" }),
      });
      
      if (!response.ok) {
        throw new Error("Erreur lors de la récupération des stats");
      }
      
      const data = await response.json();
      setStats(data.stats);
    } catch (err) {
      console.error("Error fetching stats:", err);
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Impossible de charger les statistiques",
        variant: "destructive",
      });
    } finally {
      setIsLoadingStats(false);
    }
  }

  async function callEdgeFunction(
    functionName: string,
    body: Record<string, unknown>,
    setLoading: (loading: boolean) => void
  ): Promise<ActionResult> {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Erreur lors de l'appel");
      }
      
      toast({
        title: "Succès",
        description: data.processed !== undefined 
          ? `${data.processed} éléments traités, ${data.remaining || 0} restants`
          : "Opération terminée avec succès",
      });
      
      // Refresh stats after action
      await fetchStats();
      
      return { success: true, processed: data.processed, remaining: data.remaining };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Erreur inconnue";
      toast({
        title: "Erreur",
        description: errorMessage,
        variant: "destructive",
      });
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }

  // Action handlers
  const handleGenerateHSCodes = () => 
    callEdgeFunction("generate-synthetic-data", { mode: "hs_sample", count: 100 }, setIsGeneratingHSCodes);
  
  const handleGenerateKBChunks = () => 
    callEdgeFunction("generate-synthetic-data", { mode: "kb_sample", count: 50 }, setIsGeneratingKBChunks);
  
  const handleEnrichHS = () => 
    callEdgeFunction("enrich-hs-codes", { batch_size: 30 }, setIsEnrichingHS);
  
  const handleGenerateHSEmbeddings = () => 
    callEdgeFunction("generate-embeddings", { mode: "batch", target: "hs", batch_size: 50 }, setIsGeneratingHSEmbeddings);
  
  const handleGenerateKBEmbeddings = () => 
    callEdgeFunction("generate-embeddings", { mode: "batch", target: "kb", batch_size: 50 }, setIsGeneratingKBEmbeddings);
  
  const handleGenerateDUM = () => 
    callEdgeFunction("generate-synthetic-data", { mode: "dum_sample", count: dumCount }, setIsGeneratingDUM);

  // Derived values
  const hsTotal = stats?.hs_codes.total ?? 0;
  const hsWithEmbedding = stats?.hs_codes.with_embedding ?? 0;
  const hsEmbeddingPercent = hsTotal > 0 ? (hsWithEmbedding / hsTotal) * 100 : 0;
  
  const kbTotal = stats?.kb_chunks.total ?? 0;
  const kbWithEmbedding = stats?.kb_chunks.with_embedding ?? 0;
  const kbEmbeddingPercent = kbTotal > 0 ? (kbWithEmbedding / kbTotal) * 100 : 0;
  
  const isReady = hsTotal >= 100 && kbTotal >= 100;

  const getHSBadge = () => {
    if (hsTotal >= 1000) return <Badge className="bg-success text-success-foreground">Complet</Badge>;
    if (hsTotal >= 100) return <Badge className="bg-warning text-warning-foreground">En cours</Badge>;
    return <Badge className="bg-destructive text-destructive-foreground">Insuffisant</Badge>;
  };

  const getKBBadge = () => {
    if (kbTotal >= 500) return <Badge className="bg-success text-success-foreground">Complet</Badge>;
    if (kbTotal >= 100) return <Badge className="bg-warning text-warning-foreground">En cours</Badge>;
    return <Badge className="bg-destructive text-destructive-foreground">Insuffisant</Badge>;
  };

  if (isLoadingStats) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Card 1: Codes HS */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-5 w-5 text-primary" />
              Codes HS
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{hsTotal.toLocaleString()}</p>
            <Progress value={hsEmbeddingPercent} className="h-2 mt-2" />
            <div className="flex items-center justify-between mt-2">
              <span className="text-sm text-muted-foreground">{hsWithEmbedding} embeddings</span>
              {getHSBadge()}
            </div>
          </CardContent>
        </Card>

        {/* Card 2: KB Chunks */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5 text-primary" />
              KB Chunks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{kbTotal.toLocaleString()}</p>
            <Progress value={kbEmbeddingPercent} className="h-2 mt-2" />
            <div className="flex items-center justify-between mt-2">
              <span className="text-sm text-muted-foreground">{kbWithEmbedding} embeddings</span>
              {getKBBadge()}
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Classification Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Statut Classification</CardTitle>
          </CardHeader>
          <CardContent>
            {isReady ? (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-8 w-8 text-success" />
                <span className="text-2xl font-bold text-success">Prêt</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-8 w-8 text-warning" />
                <span className="text-2xl font-bold text-warning">Données insuffisantes</span>
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              Min requis: 100 codes HS + 100 KB chunks
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Start Alert */}
      {!isReady && (
        <Alert className="border-accent bg-accent/10">
          <Sparkles className="h-4 w-4 text-accent" />
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <span>
              <strong>Démarrage rapide:</strong> Générez des données de test pour commencer immédiatement.
            </span>
            <div className="flex gap-2">
              <Button 
                size="sm" 
                onClick={handleGenerateHSCodes}
                disabled={isGeneratingHSCodes}
              >
                {isGeneratingHSCodes ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="mr-2 h-4 w-4" />
                )}
                Générer 100 codes HS
              </Button>
              <Button 
                size="sm" 
                variant="outline"
                onClick={handleGenerateKBChunks}
                disabled={isGeneratingKBChunks}
              >
                {isGeneratingKBChunks ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="mr-2 h-4 w-4" />
                )}
                Générer 50 KB chunks
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Main Tabs */}
      <Tabs defaultValue="hs" className="w-full">
        <TabsList>
          <TabsTrigger value="hs">Codes HS</TabsTrigger>
          <TabsTrigger value="kb">Base Connaissances</TabsTrigger>
          <TabsTrigger value="dum">Historique DUM</TabsTrigger>
          <TabsTrigger value="embeddings">Embeddings</TabsTrigger>
        </TabsList>

        {/* Tab 1: Codes HS */}
        <TabsContent value="hs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions sur codes existants</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Button 
                  onClick={handleEnrichHS}
                  disabled={isEnrichingHS || hsTotal === 0}
                >
                  {isEnrichingHS ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Enrichir (30 codes)
                </Button>
                <Button 
                  variant="outline"
                  onClick={handleGenerateHSEmbeddings}
                  disabled={isGeneratingHSEmbeddings || hsTotal === 0}
                >
                  {isGeneratingHSEmbeddings ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Database className="mr-2 h-4 w-4" />
                  )}
                  Générer embeddings (50)
                </Button>
              </div>
              
              <div className="grid gap-2 text-sm text-muted-foreground">
                <p>• Codes sans enrichissement: {hsTotal - (stats?.hs_codes.with_embedding ?? 0)} (estimation)</p>
                <p>• Codes sans embedding: {hsTotal - hsWithEmbedding}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Base Connaissances */}
        <TabsContent value="kb" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions sur la base de connaissances</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button 
                onClick={handleGenerateKBEmbeddings}
                disabled={isGeneratingKBEmbeddings || kbTotal === 0}
              >
                {isGeneratingKBEmbeddings ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Database className="mr-2 h-4 w-4" />
                )}
                Générer embeddings KB (50)
              </Button>
              
              <p className="text-sm text-muted-foreground">
                • Chunks sans embedding: {kbTotal - kbWithEmbedding}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Historique DUM */}
        <TabsContent value="dum" className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Les DUM synthétiques ont un score de fiabilité réduit (60%) par rapport aux données réelles (80-100%).
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Générer des DUM synthétiques</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dum-count">Nombre de DUM</Label>
                  <Input
                    id="dum-count"
                    type="number"
                    min={10}
                    max={500}
                    value={dumCount}
                    onChange={(e) => setDumCount(Math.max(10, Math.min(500, parseInt(e.target.value) || 10)))}
                    className="w-32"
                  />
                </div>
                <Button 
                  onClick={handleGenerateDUM}
                  disabled={isGeneratingDUM || hsTotal < 10}
                >
                  {isGeneratingDUM ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Générer DUM synthétiques
                </Button>
              </div>
              
              {hsTotal < 10 && (
                <p className="text-sm text-destructive">
                  Minimum 10 codes HS requis pour générer des DUM
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Embeddings */}
        <TabsContent value="embeddings" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Codes HS</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Progress value={hsEmbeddingPercent} className="h-2" />
                <p className="text-sm text-muted-foreground">
                  {hsWithEmbedding} / {hsTotal} ({hsEmbeddingPercent.toFixed(1)}%)
                </p>
                <Button 
                  size="sm"
                  onClick={() => callEdgeFunction(
                    "generate-embeddings", 
                    { mode: "batch", target: "hs", batch_size: 100 }, 
                    setIsGeneratingHSEmbeddings
                  )}
                  disabled={isGeneratingHSEmbeddings || hsWithEmbedding >= hsTotal}
                >
                  {isGeneratingHSEmbeddings ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="mr-2 h-4 w-4" />
                  )}
                  Générer 100
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">KB Chunks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Progress value={kbEmbeddingPercent} className="h-2" />
                <p className="text-sm text-muted-foreground">
                  {kbWithEmbedding} / {kbTotal} ({kbEmbeddingPercent.toFixed(1)}%)
                </p>
                <Button 
                  size="sm"
                  onClick={() => callEdgeFunction(
                    "generate-embeddings", 
                    { mode: "batch", target: "kb", batch_size: 100 }, 
                    setIsGeneratingKBEmbeddings
                  )}
                  disabled={isGeneratingKBEmbeddings || kbWithEmbedding >= kbTotal}
                >
                  {isGeneratingKBEmbeddings ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="mr-2 h-4 w-4" />
                  )}
                  Générer 100
                </Button>
              </CardContent>
            </Card>
          </div>

          <Alert>
            <AlertDescription>
              ~$0.0001 par embedding, 100 embeddings ≈ $0.01
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>

      {/* Refresh Button */}
      <div className="flex justify-end">
        <Button 
          variant="outline" 
          onClick={fetchStats}
          disabled={isLoadingStats}
        >
          {isLoadingStats ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Actualiser
        </Button>
      </div>
    </div>
  );
}
