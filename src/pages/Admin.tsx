import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { IngestionStatusBadge } from "@/components/ui/status-badge";
import { HSCodeImport } from "@/components/admin/HSCodeImport";
import { DUMImport } from "@/components/admin/DUMImport";
import { KBImport } from "@/components/admin/KBImport";
import { DataIngestionPanel } from "@/components/admin/DataIngestionPanel";
import { 
  getIngestionList, 
  registerIngestion, 
  runEtl, 
  getIngestionLogs,
  retryIngestion,
  disableIngestion,
  searchKB,
  presignFile
} from "@/lib/api-client";
import { 
  IngestionFile, 
  IngestionLog, 
  IngestionSource,
  KBChunk,
  INGESTION_SOURCE_LABELS 
} from "@/lib/types";
import { 
  Loader2, 
  Upload, 
  Play, 
  RefreshCw, 
  XCircle,
  Search,
  Database,
  FileText,
  AlertCircle,
  CheckCircle,
  Activity,
  BookOpen,
  ClipboardList,
  Library,
  Sparkles
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const SOURCES: IngestionSource[] = ["omd", "maroc", "lois", "dum"];

export default function AdminPage() {
  const { toast } = useToast();
  
  const [ingestions, setIngestions] = useState<IngestionFile[]>([]);
  const [isLoadingIngestions, setIsLoadingIngestions] = useState(true);
  
  // New import form
  const [newSource, setNewSource] = useState<IngestionSource>("omd");
  const [newVersionLabel, setNewVersionLabel] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // Logs
  const [selectedIngestionId, setSelectedIngestionId] = useState<string | null>(null);
  const [logs, setLogs] = useState<IngestionLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  
  // KB Search
  const [kbQuery, setKbQuery] = useState("");
  const [kbResults, setKbResults] = useState<KBChunk[]>([]);
  const [isSearchingKB, setIsSearchingKB] = useState(false);

  useEffect(() => {
    fetchIngestions();
    const interval = setInterval(() => {
      // Poll if any ingestion is in progress
      if (ingestions.some(i => ["EXTRACTING", "PARSING", "INDEXING"].includes(i.status))) {
        fetchIngestions();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [ingestions.length]);

  async function fetchIngestions() {
    try {
      const response = await getIngestionList();
      setIngestions(response.data.items);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingIngestions(false);
    }
  }

  async function handleNewImport(e: React.FormEvent) {
    e.preventDefault();
    if (!newFile || !newVersionLabel) return;

    setIsUploading(true);
    try {
      // 1. Get presigned URL
      const presignRes = await presignFile({
        case_id: null,
        file_type: "admin_ingestion",
        filename: newFile.name,
        content_type: newFile.type,
      });

      // 2. Upload file
      await fetch(presignRes.data.upload_url, {
        method: "PUT",
        headers: { "Content-Type": newFile.type },
        body: newFile,
      });

      // 3. Register ingestion
      const registerRes = await registerIngestion({
        source: newSource,
        version_label: newVersionLabel,
        file_url: presignRes.data.file_url,
      });

      toast({
        title: "Import enregistre",
        description: "Le fichier a ete telecharge. Lancez l'ETL pour commencer le traitement.",
      });

      // Reset form
      setNewVersionLabel("");
      setNewFile(null);
      
      // Refresh list
      fetchIngestions();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur lors de l'import",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRunEtl(ingestionId: string) {
    try {
      await runEtl(ingestionId);
      toast({
        title: "ETL lance",
        description: "Le traitement a demarre.",
      });
      fetchIngestions();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur",
        variant: "destructive",
      });
    }
  }

  async function handleRetry(ingestionId: string) {
    try {
      await retryIngestion(ingestionId);
      toast({ title: "Relance en cours" });
      fetchIngestions();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur",
        variant: "destructive",
      });
    }
  }

  async function handleDisable(ingestionId: string) {
    try {
      await disableIngestion(ingestionId);
      toast({ title: "Import desactive" });
      fetchIngestions();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur",
        variant: "destructive",
      });
    }
  }

  async function handleViewLogs(ingestionId: string) {
    setSelectedIngestionId(ingestionId);
    setIsLoadingLogs(true);
    try {
      const response = await getIngestionLogs(ingestionId);
      setLogs(response.data.items);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingLogs(false);
    }
  }

  async function handleKBSearch(e: React.FormEvent) {
    e.preventDefault();
    if (kbQuery.length < 3) return;

    setIsSearchingKB(true);
    try {
      const response = await searchKB(kbQuery);
      setKbResults(response.data.chunks);
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur de recherche",
        variant: "destructive",
      });
    } finally {
      setIsSearchingKB(false);
    }
  }

  const getLogLevelIcon = (level: string) => {
    switch (level) {
      case "error": return <AlertCircle className="h-4 w-4 text-destructive" />;
      case "warning": return <AlertCircle className="h-4 w-4 text-warning" />;
      default: return <CheckCircle className="h-4 w-4 text-success" />;
    }
  };

  return (
    <AppLayout allowedRoles={["admin"]}>
      <div className="container py-8">
        <Breadcrumbs items={[{ label: "Administration" }]} />

        <div className="mt-6">
          <Tabs defaultValue="home">
            <TabsList className="mb-6 flex-wrap">
              <TabsTrigger value="home" className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Accueil
              </TabsTrigger>
              <TabsTrigger value="nomenclature" className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                Nomenclature
              </TabsTrigger>
              <TabsTrigger value="new" className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Nouvel import
              </TabsTrigger>
              <TabsTrigger value="imports" className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                Imports
              </TabsTrigger>
              <TabsTrigger value="ai-ingest" className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                IA Ingestion
              </TabsTrigger>
              <TabsTrigger value="kb" className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                Qualite KB
              </TabsTrigger>
              <TabsTrigger value="kb-import" className="flex items-center gap-2">
                <Library className="h-4 w-4" />
                Base Preuves
              </TabsTrigger>
              <TabsTrigger value="dum" className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                DUM
              </TabsTrigger>
            </TabsList>

            {/* Home Tab */}
            <TabsContent value="home">
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Imports totaux</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{ingestions.length}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">En cours</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-info">
                      {ingestions.filter(i => ["EXTRACTING", "PARSING", "INDEXING"].includes(i.status)).length}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Erreurs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-destructive">
                      {ingestions.filter(i => i.status === "ERROR").length}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="text-base">Derniers imports</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {ingestions.slice(0, 5).map((ing) => (
                      <div key={ing.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <p className="font-medium">{INGESTION_SOURCE_LABELS[ing.source]}</p>
                          <p className="text-sm text-muted-foreground">{ing.version_label}</p>
                        </div>
                        <IngestionStatusBadge status={ing.status} />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Nomenclature Tab */}
            <TabsContent value="nomenclature">
              <HSCodeImport />
            </TabsContent>

            {/* New Import Tab */}
            <TabsContent value="new">
              <Card className="max-w-xl">
                <CardHeader>
                  <CardTitle>Nouvel import</CardTitle>
                  <CardDescription>
                    Telecharger un nouveau fichier pour ingestion dans la base de connaissances
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleNewImport} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Source</Label>
                      <Select value={newSource} onValueChange={(v) => setNewSource(v as IngestionSource)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SOURCES.map((s) => (
                            <SelectItem key={s} value={s}>{INGESTION_SOURCE_LABELS[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="version">Version</Label>
                      <Input
                        id="version"
                        placeholder="Ex: 2024-01"
                        value={newVersionLabel}
                        onChange={(e) => setNewVersionLabel(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="file">Fichier</Label>
                      <Input
                        id="file"
                        type="file"
                        accept=".pdf,.xlsx,.xls,.csv,.json"
                        onChange={(e) => setNewFile(e.target.files?.[0] || null)}
                      />
                    </div>

                    <Button type="submit" disabled={isUploading || !newFile || !newVersionLabel}>
                      {isUploading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Telechargement...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          Telecharger et enregistrer
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Imports Tab */}
            <TabsContent value="imports">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Liste des imports</CardTitle>
                    <CardDescription>Gerez les fichiers ingeres</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchIngestions}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Actualiser
                  </Button>
                </CardHeader>
                <CardContent>
                  {isLoadingIngestions ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {ingestions.map((ing) => (
                        <div key={ing.id} className="rounded-lg border p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <p className="font-medium">{INGESTION_SOURCE_LABELS[ing.source]}</p>
                              <p className="text-sm text-muted-foreground">{ing.version_label} - {ing.filename}</p>
                            </div>
                            <IngestionStatusBadge status={ing.status} />
                          </div>

                          {["EXTRACTING", "PARSING", "INDEXING"].includes(ing.status) && (
                            <Progress value={ing.progress_percent} className="h-2 mb-2" />
                          )}

                          {ing.error_message && (
                            <p className="text-sm text-destructive mb-2">{ing.error_message}</p>
                          )}

                          <div className="flex flex-wrap gap-2 mt-3">
                            {ing.status === "NEW" && (
                              <Button size="sm" onClick={() => handleRunEtl(ing.id)}>
                                <Play className="mr-2 h-4 w-4" />
                                Lancer ETL
                              </Button>
                            )}
                            {ing.status === "ERROR" && (
                              <Button size="sm" variant="outline" onClick={() => handleRetry(ing.id)}>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Relancer
                              </Button>
                            )}
                            {ing.status !== "DISABLED" && (
                              <Button size="sm" variant="ghost" onClick={() => handleDisable(ing.id)}>
                                <XCircle className="mr-2 h-4 w-4" />
                                Desactiver
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => handleViewLogs(ing.id)}>
                              <FileText className="mr-2 h-4 w-4" />
                              Logs
                            </Button>
                          </div>

                          {/* Inline Logs */}
                          {selectedIngestionId === ing.id && (
                            <div className="mt-4 rounded bg-muted/50 p-3">
                              {isLoadingLogs ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : logs.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Aucun log disponible</p>
                              ) : (
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                  {logs.map((log) => (
                                    <div key={log.id} className="flex items-start gap-2 text-sm">
                                      {getLogLevelIcon(log.level)}
                                      <div className="flex-1">
                                        <span className="text-muted-foreground">
                                          [{log.step}] {format(new Date(log.created_at), "HH:mm:ss")}
                                        </span>
                                        <p>{log.message}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* KB Quality Tab */}
            <TabsContent value="kb">
              <Card>
                <CardHeader>
                  <CardTitle>Recherche dans la base de connaissances</CardTitle>
                  <CardDescription>
                    Testez la qualite des donnees indexees
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleKBSearch} className="flex gap-2 mb-6">
                    <Input
                      placeholder="Rechercher (min. 3 caracteres)..."
                      value={kbQuery}
                      onChange={(e) => setKbQuery(e.target.value)}
                      className="flex-1"
                    />
                    <Button type="submit" disabled={isSearchingKB || kbQuery.length < 3}>
                      {isSearchingKB ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </Button>
                  </form>

                  {kbResults.length > 0 && (
                    <div className="space-y-3">
                      {kbResults.map((chunk) => (
                        <div key={chunk.id} className="rounded-lg border p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{INGESTION_SOURCE_LABELS[chunk.source]}</span>
                              <span className="text-xs text-muted-foreground">{chunk.ref}</span>
                            </div>
                            <span className="text-sm font-mono text-accent">
                              Score: {chunk.score.toFixed(3)}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-3">{chunk.text}</p>
                          <p className="text-xs text-muted-foreground mt-2">
                            Version: {chunk.version_label}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* KB Import Tab */}
            <TabsContent value="kb-import">
              <KBImport />
            </TabsContent>

            {/* DUM Import Tab */}
            <TabsContent value="dum">
              <DUMImport />
            </TabsContent>

            {/* AI Ingestion Tab */}
            <TabsContent value="ai-ingest">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5" />
                    Ingestion Automatique par IA
                  </CardTitle>
                  <CardDescription>
                    Utilisez l'IA pour générer, enrichir et vectoriser automatiquement vos données de référence
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DataIngestionPanel />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
