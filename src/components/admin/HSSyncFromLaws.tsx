import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Play,
  Eye,
  History,
  RefreshCw,
  Scale,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import {
  syncHSFromLaws,
  previewHSSync,
  getSyncHistory,
  type SyncResult,
  type SyncHistoryEntry,
  type HSUpdate,
} from "@/lib/hs-sync-api";

export function HSSyncFromLaws() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("sync");
  
  // Sync state
  const [versionLabel, setVersionLabel] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  
  // History state
  const [history, setHistory] = useState<SyncHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  useEffect(() => {
    if (activeTab === "history") {
      loadHistory();
    }
  }, [activeTab]);
  
  async function loadHistory() {
    setIsLoadingHistory(true);
    try {
      const data = await getSyncHistory(20);
      setHistory(data);
    } catch (e) {
      toast({
        title: "Erreur",
        description: "Impossible de charger l'historique",
        variant: "destructive",
      });
    } finally {
      setIsLoadingHistory(false);
    }
  }
  
  async function handlePreview() {
    setIsPreviewing(true);
    setSyncResult(null);
    try {
      const result = await previewHSSync(versionLabel || undefined);
      setSyncResult(result);
      toast({
        title: "Aperçu terminé",
        description: `${result.updates_found} modifications détectées dans ${result.laws_analyzed} documents`,
      });
    } catch (e) {
      toast({
        title: "Erreur",
        description: e instanceof Error ? e.message : "Erreur lors de l'aperçu",
        variant: "destructive",
      });
    } finally {
      setIsPreviewing(false);
    }
  }
  
  async function handleSync() {
    setIsSyncing(true);
    try {
      const result = await syncHSFromLaws({
        version_label: versionLabel || undefined,
        dry_run: false,
        limit: 100,
      });
      setSyncResult(result);
      toast({
        title: "Synchronisation terminée",
        description: `${result.updates_applied} codes HS mis à jour`,
      });
      // Reload history
      loadHistory();
    } catch (e) {
      toast({
        title: "Erreur",
        description: e instanceof Error ? e.message : "Erreur lors de la synchronisation",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  }
  
  function renderFieldBadge(field: string) {
    switch (field) {
      case "taxes":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700">Taxes</Badge>;
      case "label_fr":
        return <Badge variant="outline" className="bg-green-50 text-green-700">Libellé</Badge>;
      case "active":
        return <Badge variant="outline" className="bg-orange-50 text-orange-700">Statut</Badge>;
      case "unit":
        return <Badge variant="outline" className="bg-purple-50 text-purple-700">Unité</Badge>;
      default:
        return <Badge variant="outline">{field}</Badge>;
    }
  }
  
  function formatValue(value: string | null): string {
    if (!value) return "-";
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object") {
        return Object.entries(parsed)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
      }
      return String(parsed);
    } catch {
      return value;
    }
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          Synchronisation Codes HS depuis Lois de Finance
        </CardTitle>
        <CardDescription>
          Analyse automatique des lois de finance importées pour mettre à jour les codes HS
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="sync">Synchroniser</TabsTrigger>
            <TabsTrigger value="history">Historique</TabsTrigger>
          </TabsList>
          
          <TabsContent value="sync" className="space-y-4">
            {/* Info Alert */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Ce système analyse les lois de finance importées (source "lois" dans la KB) et extrait
                automatiquement les modifications de codes HS : changements de taux, exonérations, 
                nouveaux codes, etc.
              </AlertDescription>
            </Alert>
            
            {/* Options */}
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <Label htmlFor="version">Version (optionnel)</Label>
                <Input
                  id="version"
                  placeholder="ex: LF_2024"
                  value={versionLabel}
                  onChange={(e) => setVersionLabel(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Filtrer par version de loi de finance
                </p>
              </div>
              <Button
                variant="outline"
                onClick={handlePreview}
                disabled={isPreviewing || isSyncing}
              >
                {isPreviewing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="mr-2 h-4 w-4" />
                )}
                Aperçu
              </Button>
              <Button
                onClick={handleSync}
                disabled={isSyncing || isPreviewing}
              >
                {isSyncing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Synchroniser
              </Button>
            </div>
            
            {/* Results */}
            {syncResult && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="p-4 border rounded-lg text-center">
                    <p className="text-2xl font-bold">{syncResult.laws_analyzed}</p>
                    <p className="text-sm text-muted-foreground">Documents analysés</p>
                  </div>
                  <div className="p-4 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-blue-600">{syncResult.updates_found}</p>
                    <p className="text-sm text-muted-foreground">Modifications trouvées</p>
                  </div>
                  <div className="p-4 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-green-600">{syncResult.updates_applied}</p>
                    <p className="text-sm text-muted-foreground">Codes mis à jour</p>
                  </div>
                  <div className="p-4 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-orange-600">{syncResult.errors.length}</p>
                    <p className="text-sm text-muted-foreground">Erreurs</p>
                  </div>
                </div>
                
                {/* Updates Table */}
                {syncResult.updates.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Détail des modifications</h4>
                    <ScrollArea className="h-[300px] border rounded-lg">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Code HS</TableHead>
                            <TableHead>Champ</TableHead>
                            <TableHead>Ancienne valeur</TableHead>
                            <TableHead></TableHead>
                            <TableHead>Nouvelle valeur</TableHead>
                            <TableHead>Source</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {syncResult.updates.map((update, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono">{update.code_10}</TableCell>
                              <TableCell>{renderFieldBadge(update.field)}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatValue(update.old_value)}
                              </TableCell>
                              <TableCell>
                                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                              </TableCell>
                              <TableCell className="font-medium">
                                {formatValue(update.new_value)}
                              </TableCell>
                              <TableCell className="text-xs max-w-[150px] truncate">
                                {update.source_ref}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </div>
                )}
                
                {/* Errors */}
                {syncResult.errors.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <p className="font-medium mb-2">{syncResult.errors.length} erreurs :</p>
                      <ul className="list-disc list-inside text-sm">
                        {syncResult.errors.slice(0, 5).map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                        {syncResult.errors.length > 5 && (
                          <li>...et {syncResult.errors.length - 5} autres</li>
                        )}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
                
                {/* Success message */}
                {syncResult.success && syncResult.updates_applied > 0 && (
                  <Alert className="border-green-200 bg-green-50">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-700">
                      {syncResult.updates_applied} codes HS ont été mis à jour avec succès !
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="history" className="space-y-4">
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={loadHistory}
                disabled={isLoadingHistory}
              >
                {isLoadingHistory ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Actualiser
              </Button>
            </div>
            
            {isLoadingHistory ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Aucune synchronisation effectuée</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Documents</TableHead>
                      <TableHead>Trouvées</TableHead>
                      <TableHead>Appliquées</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          {new Date(entry.created_at).toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{entry.version_label}</Badge>
                        </TableCell>
                        <TableCell>{entry.laws_analyzed}</TableCell>
                        <TableCell>{entry.updates_found}</TableCell>
                        <TableCell className="font-medium text-green-600">
                          {entry.updates_applied}
                        </TableCell>
                        <TableCell>
                          {entry.details?.errors?.length ? (
                            <Badge variant="destructive" className="text-xs">
                              {entry.details.errors.length} erreurs
                            </Badge>
                          ) : (
                            <Badge className="bg-green-100 text-green-700">
                              Succès
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
