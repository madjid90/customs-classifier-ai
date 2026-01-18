import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  Upload, 
  FileSpreadsheet, 
  Search, 
  Trash2, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  Download,
  Eye,
  Sparkles,
  Wand2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  importHSCodes, 
  getHSCodeStats, 
  searchHSCodes, 
  clearAllHSCodes,
  parseCSVPreview,
  ImportResult,
  HSCodeStats,
  HSCode
} from "@/lib/hs-import-api";
import { extractHSCodes, ExtractedHSCode, readFileAsText } from "@/lib/extract-api";

export function HSCodeImport() {
  const { toast } = useToast();
  
  // Stats
  const [stats, setStats] = useState<HSCodeStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  
  // Import form
  const [file, setFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileFormat, setFileFormat] = useState<"csv" | "json">("csv");
  const [versionLabel, setVersionLabel] = useState("");
  const [importMode, setImportMode] = useState<"upsert" | "insert">("upsert");
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  
  // AI Extraction
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedCodes, setExtractedCodes] = useState<ExtractedHSCode[]>([]);
  const [extractionStats, setExtractionStats] = useState<{ valid: number; invalid: number } | null>(null);
  
  // Preview
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  
  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<HSCode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // Clear
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    setIsLoadingStats(true);
    try {
      const data = await getHSCodeStats();
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setIsLoadingStats(false);
    }
  }

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setImportResult(null);
    
    // Detect format
    const ext = selectedFile.name.split('.').pop()?.toLowerCase();
    if (ext === 'json') {
      setFileFormat('json');
    } else {
      setFileFormat('csv');
    }
    
    // Read file content
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setFileContent(content);
      
      // Generate preview for CSV
      if (ext !== 'json') {
        const previewData = parseCSVPreview(content, 5);
        setPreview(previewData);
      } else {
        try {
          const parsed = JSON.parse(content);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          if (arr.length > 0) {
            setPreview({
              headers: Object.keys(arr[0]),
              rows: arr.slice(0, 5).map(row => Object.values(row).map(v => String(v)))
            });
          }
        } catch {
          setPreview(null);
        }
      }
    };
    reader.readAsText(selectedFile);
  }, []);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!fileContent || !versionLabel) return;
    
    setIsImporting(true);
    setImportResult(null);
    
    try {
      const result = await importHSCodes(fileContent, fileFormat, versionLabel, importMode);
      setImportResult(result);
      
      if (result.errors === 0) {
        toast({
          title: "Import reussi",
          description: `${result.imported} codes importes avec succes.`,
        });
      } else {
        toast({
          title: "Import termine avec erreurs",
          description: `${result.imported} importes, ${result.errors} erreurs.`,
          variant: "destructive",
        });
      }
      
      // Refresh stats
      fetchStats();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur lors de l'import",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  }

  // AI Extraction
  async function handleAIExtract() {
    if (!file || !fileContent) return;
    
    setIsExtracting(true);
    setExtractedCodes([]);
    setExtractionStats(null);
    
    try {
      const result = await extractHSCodes(fileContent, versionLabel || undefined);
      
      if (result.success && result.extracted.length > 0) {
        setExtractedCodes(result.extracted);
        setExtractionStats({ valid: result.stats.valid, invalid: result.stats.invalid });
        
        toast({
          title: "Extraction IA réussie",
          description: `${result.stats.valid} codes extraits avec l'IA.`,
        });
      } else {
        toast({
          title: "Aucun code extrait",
          description: result.errors?.join(", ") || "L'IA n'a pas pu extraire de codes valides.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Erreur d'extraction IA",
        description: err instanceof Error ? err.message : "Erreur lors de l'extraction",
        variant: "destructive",
      });
    } finally {
      setIsExtracting(false);
    }
  }

  // Import extracted codes
  async function handleImportExtracted() {
    if (extractedCodes.length === 0 || !versionLabel) return;
    
    setIsImporting(true);
    
    try {
      // Convert extracted to CSV format for import
      const csvContent = "code;label_fr;label_ar;unit\n" + 
        extractedCodes.map(c => 
          `${c.code_10};${c.label_fr};${c.label_ar || ''};${c.unit || ''}`
        ).join("\n");
      
      const result = await importHSCodes(csvContent, "csv", versionLabel, importMode);
      setImportResult(result);
      
      if (result.errors === 0) {
        toast({
          title: "Import réussi",
          description: `${result.imported} codes importés depuis l'extraction IA.`,
        });
        setExtractedCodes([]);
        setExtractionStats(null);
      } else {
        toast({
          title: "Import terminé avec erreurs",
          description: `${result.imported} importés, ${result.errors} erreurs.`,
          variant: "destructive",
        });
      }
      
      fetchStats();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur lors de l'import",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchQuery.length < 2) return;
    
    setIsSearching(true);
    try {
      const result = await searchHSCodes(searchQuery, 20);
      setSearchResults(result.codes);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleClear() {
    setIsClearing(true);
    try {
      await clearAllHSCodes();
      toast({
        title: "Codes supprimes",
        description: "Tous les codes HS ont ete supprimes.",
      });
      setShowClearConfirm(false);
      fetchStats();
      setSearchResults([]);
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur",
        variant: "destructive",
      });
    } finally {
      setIsClearing(false);
    }
  }

  // Format HS code with dots
  function formatHSCode(code: string): string {
    if (code.length < 6) return code;
    return `${code.slice(0, 4)}.${code.slice(4, 6)}.${code.slice(6, 8)}.${code.slice(8, 10)}`.replace(/\.+$/, '');
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Codes HS</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <p className="text-3xl font-bold">{stats?.total_codes.toLocaleString() || 0}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Chapitres</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <p className="text-3xl font-bold">{stats?.chapters_count || 0}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Version</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <p className="text-xl font-medium text-muted-foreground">
                {stats?.current_version || "Aucune"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="import">
        <TabsList>
          <TabsTrigger value="import" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import
          </TabsTrigger>
          <TabsTrigger value="search" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Recherche
          </TabsTrigger>
          <TabsTrigger value="manage" className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Gestion
          </TabsTrigger>
        </TabsList>

        {/* Import Tab */}
        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Importer des codes HS</CardTitle>
              <CardDescription>
                Telecharger un fichier CSV, Excel (exporte en CSV), ou JSON contenant les codes HS
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleImport} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="hs-file">Fichier (CSV ou JSON)</Label>
                  <Input
                    id="hs-file"
                    type="file"
                    accept=".csv,.json,.txt"
                    onChange={handleFileChange}
                  />
                  <p className="text-xs text-muted-foreground">
                    Colonnes attendues: code (ou code_10, hs_code), label_fr (ou libelle, designation)
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="version-label">Version</Label>
                    <Input
                      id="version-label"
                      placeholder="Ex: 2024-01, v2025"
                      value={versionLabel}
                      onChange={(e) => setVersionLabel(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Mode d'import</Label>
                    <Select value={importMode} onValueChange={(v) => setImportMode(v as "upsert" | "insert")}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="upsert">Mise a jour (upsert)</SelectItem>
                        <SelectItem value="insert">Insertion seule</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Preview */}
                {preview && preview.headers.length > 0 && (
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Apercu ({preview.rows.length} premieres lignes)</span>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {preview.headers.map((h, i) => (
                              <TableHead key={i} className="text-xs">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.rows.map((row, i) => (
                            <TableRow key={i}>
                              {row.map((cell, j) => (
                                <TableCell key={j} className="text-xs">{cell.substring(0, 50)}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={isImporting || !fileContent || !versionLabel}>
                    {isImporting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Import en cours...
                      </>
                    ) : (
                      <>
                        <Upload className="mr-2 h-4 w-4" />
                        Import standard
                      </>
                    )}
                  </Button>
                  
                  <Button 
                    type="button" 
                    variant="secondary"
                    disabled={isExtracting || !fileContent}
                    onClick={handleAIExtract}
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Extraction IA...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Extraction IA
                      </>
                    )}
                  </Button>
                </div>
              </form>

              {/* AI Extraction Results */}
              {extractedCodes.length > 0 && (
                <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Wand2 className="h-5 w-5 text-primary" />
                      <h4 className="font-medium">Extraction IA</h4>
                      <Badge variant="secondary">
                        {extractedCodes.length} codes extraits
                      </Badge>
                      {extractionStats && (
                        <span className="text-xs text-muted-foreground">
                          ({extractionStats.valid} valides, {extractionStats.invalid} ignorés)
                        </span>
                      )}
                    </div>
                    <Button 
                      size="sm" 
                      disabled={!versionLabel || isImporting}
                      onClick={handleImportExtracted}
                    >
                      {isImporting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      Importer ces codes
                    </Button>
                  </div>
                  
                  <div className="max-h-64 overflow-y-auto rounded border bg-background">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Code HS</TableHead>
                          <TableHead className="text-xs">Libellé FR</TableHead>
                          <TableHead className="text-xs">Chapitre</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {extractedCodes.slice(0, 20).map((code, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{formatHSCode(code.code_10)}</TableCell>
                            <TableCell className="text-xs max-w-md truncate">{code.label_fr}</TableCell>
                            <TableCell className="text-xs">{code.chapter_2}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {extractedCodes.length > 20 && (
                      <p className="text-xs text-muted-foreground p-2 text-center">
                        ... et {extractedCodes.length - 20} autres codes
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Import Result */}
              {importResult && (
                <Alert className="mt-4" variant={importResult.errors > 0 ? "destructive" : "default"}>
                  {importResult.errors === 0 ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>
                    <div className="space-y-1">
                      <p>
                        <strong>{importResult.imported}</strong> codes importes sur <strong>{importResult.total_rows}</strong> lignes.
                        {importResult.errors > 0 && <span className="text-destructive"> {importResult.errors} erreurs.</span>}
                      </p>
                      {importResult.warnings.length > 0 && (
                        <ul className="list-disc list-inside text-xs text-muted-foreground">
                          {importResult.warnings.slice(0, 5).map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Format Help */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Format attendu</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <div>
                <p className="font-medium">CSV:</p>
                <code className="block bg-muted p-2 rounded text-xs mt-1">
                  code;label_fr<br/>
                  0101210000;Chevaux reproducteurs de race pure<br/>
                  0101290000;Autres chevaux vivants
                </code>
              </div>
              <div>
                <p className="font-medium">JSON:</p>
                <code className="block bg-muted p-2 rounded text-xs mt-1">
                  {'[{"code": "0101210000", "label_fr": "Chevaux reproducteurs de race pure"}]'}
                </code>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Search Tab */}
        <TabsContent value="search">
          <Card>
            <CardHeader>
              <CardTitle>Rechercher des codes</CardTitle>
              <CardDescription>Rechercher par code ou par libelle</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                <Input
                  placeholder="Code ou mot-cle..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="max-w-md"
                />
                <Button type="submit" disabled={isSearching || searchQuery.length < 2}>
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </form>

              {searchResults.length > 0 && (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Libelle</TableHead>
                        <TableHead>Chapitre</TableHead>
                        <TableHead>Version</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {searchResults.map((code) => (
                        <TableRow key={code.code_10}>
                          <TableCell className="font-mono font-medium">
                            {formatHSCode(code.code_10)}
                          </TableCell>
                          <TableCell className="max-w-md truncate">
                            {code.label_fr}
                          </TableCell>
                          <TableCell>{code.chapter_2}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {code.active_version_label}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                <p className="text-muted-foreground text-sm">Aucun resultat trouve.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Manage Tab */}
        <TabsContent value="manage">
          <Card>
            <CardHeader>
              <CardTitle>Gestion des donnees</CardTitle>
              <CardDescription>Actions de maintenance</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border">
                <div>
                  <p className="font-medium">Supprimer tous les codes</p>
                  <p className="text-sm text-muted-foreground">
                    Cette action est irreversible.
                  </p>
                </div>
                {!showClearConfirm ? (
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => setShowClearConfirm(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Supprimer
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setShowClearConfirm(false)}
                    >
                      Annuler
                    </Button>
                    <Button 
                      variant="destructive" 
                      size="sm"
                      onClick={handleClear}
                      disabled={isClearing}
                    >
                      {isClearing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Confirmer
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border">
                <div>
                  <p className="font-medium">Exporter les codes</p>
                  <p className="text-sm text-muted-foreground">
                    Telecharger tous les codes au format CSV.
                  </p>
                </div>
                <Button variant="outline" size="sm" disabled>
                  <Download className="mr-2 h-4 w-4" />
                  Exporter (bientot)
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
