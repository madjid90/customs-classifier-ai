import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  History,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  ChevronDown,
  Play,
  XCircle,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  getIngestionList,
  runEtl,
  retryIngestion,
  disableIngestion,
  getIngestionLogs,
} from "@/lib/api-client";
import {
  IngestionFile,
  IngestionLog,
  IngestionStatus,
  INGESTION_SOURCE_LABELS,
  INGESTION_STATUS_LABELS,
} from "@/lib/types";

const STATUS_ICONS: Record<IngestionStatus, React.ReactNode> = {
  NEW: <Clock className="h-4 w-4 text-muted-foreground" />,
  EXTRACTING: <Loader2 className="h-4 w-4 animate-spin text-info" />,
  PARSING: <Loader2 className="h-4 w-4 animate-spin text-info" />,
  INDEXING: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  DONE: <CheckCircle className="h-4 w-4 text-success" />,
  ERROR: <AlertCircle className="h-4 w-4 text-destructive" />,
  DISABLED: <XCircle className="h-4 w-4 text-muted-foreground" />,
};

const STATUS_COLORS: Record<IngestionStatus, string> = {
  NEW: "bg-muted text-muted-foreground",
  EXTRACTING: "bg-info/10 text-info",
  PARSING: "bg-info/10 text-info",
  INDEXING: "bg-primary/10 text-primary",
  DONE: "bg-success/10 text-success",
  ERROR: "bg-destructive/10 text-destructive",
  DISABLED: "bg-muted text-muted-foreground",
};

export function ImportHistory() {
  const { toast } = useToast();
  const [ingestions, setIngestions] = useState<IngestionFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<IngestionLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  useEffect(() => {
    fetchIngestions();
    
    // Poll for updates if any ingestion is in progress
    const interval = setInterval(() => {
      if (ingestions.some((i) => ["EXTRACTING", "PARSING", "INDEXING"].includes(i.status))) {
        fetchIngestions();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [ingestions.length]);

  async function fetchIngestions() {
    try {
      const response = await getIngestionList();
      setIngestions(response.data.items);
    } catch (err) {
      console.error("Failed to fetch ingestions:", err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRunEtl(id: string) {
    try {
      await runEtl(id);
      toast({ title: "Traitement lancé" });
      fetchIngestions();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur",
        variant: "destructive",
      });
    }
  }

  async function handleRetry(id: string) {
    try {
      await retryIngestion(id);
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

  async function handleDisable(id: string) {
    try {
      await disableIngestion(id);
      toast({ title: "Import désactivé" });
      fetchIngestions();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur",
        variant: "destructive",
      });
    }
  }

  async function toggleLogs(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setLogs([]);
      return;
    }

    setExpandedId(id);
    setIsLoadingLogs(true);
    try {
      const response = await getIngestionLogs(id);
      setLogs(response.data.items);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setIsLoadingLogs(false);
    }
  }

  const inProgressCount = ingestions.filter((i) =>
    ["EXTRACTING", "PARSING", "INDEXING"].includes(i.status)
  ).length;
  const errorCount = ingestions.filter((i) => i.status === "ERROR").length;
  const doneCount = ingestions.filter((i) => i.status === "DONE").length;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Total imports</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{ingestions.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Terminés</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-success">{doneCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">En cours</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-info">{inProgressCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Erreurs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">{errorCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* History Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Historique des imports
            </CardTitle>
            <CardDescription>Suivez l'état de tous vos imports</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchIngestions} disabled={isLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : ingestions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Aucun import trouvé
            </div>
          ) : (
            <div className="space-y-2">
              {ingestions.map((ing) => (
                <Collapsible
                  key={ing.id}
                  open={expandedId === ing.id}
                  onOpenChange={() => toggleLogs(ing.id)}
                >
                  <div className="rounded-lg border">
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-4">
                        {STATUS_ICONS[ing.status]}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {INGESTION_SOURCE_LABELS[ing.source]}
                            </span>
                            <Badge variant="outline" className={STATUS_COLORS[ing.status]}>
                              {INGESTION_STATUS_LABELS[ing.status]}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {ing.version_label} • {ing.filename}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(ing.created_at), "d MMM yyyy HH:mm", { locale: fr })}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {["EXTRACTING", "PARSING", "INDEXING"].includes(ing.status) && (
                          <div className="w-24">
                            <Progress value={ing.progress_percent} className="h-2" />
                          </div>
                        )}

                        {ing.status === "NEW" && (
                          <Button size="sm" onClick={() => handleRunEtl(ing.id)}>
                            <Play className="mr-1 h-3 w-3" />
                            Lancer
                          </Button>
                        )}

                        {ing.status === "ERROR" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRetry(ing.id)}
                          >
                            <RefreshCw className="mr-1 h-3 w-3" />
                            Relancer
                          </Button>
                        )}

                        {ing.status !== "DISABLED" && ing.status !== "DONE" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDisable(ing.id)}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}

                        <CollapsibleTrigger asChild>
                          <Button size="sm" variant="ghost">
                            <FileText className="mr-1 h-3 w-3" />
                            Logs
                            <ChevronDown
                              className={`ml-1 h-3 w-3 transition-transform ${
                                expandedId === ing.id ? "rotate-180" : ""
                              }`}
                            />
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </div>

                    {ing.error_message && (
                      <div className="px-4 pb-3">
                        <p className="text-sm text-destructive">{ing.error_message}</p>
                      </div>
                    )}

                    <CollapsibleContent>
                      <div className="border-t bg-muted/30 p-4">
                        {isLoadingLogs ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : logs.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Aucun log</p>
                        ) : (
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {logs.map((log) => (
                              <div
                                key={log.id}
                                className="flex items-start gap-2 text-sm"
                              >
                                {log.level === "error" ? (
                                  <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                                ) : log.level === "warning" ? (
                                  <AlertCircle className="h-4 w-4 text-warning mt-0.5" />
                                ) : (
                                  <CheckCircle className="h-4 w-4 text-success mt-0.5" />
                                )}
                                <span className="text-muted-foreground">
                                  [{log.step}]
                                </span>
                                <span>{log.message}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
