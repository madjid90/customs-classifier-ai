import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { 
  Upload, 
  Search, 
  Trash2, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  ArrowRight,
  Calendar,
  FileText,
  MapPin,
  Hash,
  Sparkles,
  Wand2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  detectColumnMapping,
  importDUMRecords, 
  getDUMStats, 
  searchDUMRecords, 
  clearAllDUMRecords,
  parseCSVHeaders,
  parseCSVPreview,
  ImportResult,
  DUMStats,
  DUMRecord,
  ColumnMapping
} from "@/lib/dum-import-api";
import { extractDUMRecords, ExtractedDUM } from "@/lib/extract-api";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const REQUIRED_FIELDS: { key: keyof ColumnMapping; label: string; icon: React.ReactNode; required: boolean }[] = [
  { key: "dum_date", label: "Date DUM", icon: <Calendar className="h-4 w-4" />, required: true },
  { key: "dum_number", label: "Numero DUM", icon: <Hash className="h-4 w-4" />, required: false },
  { key: "product_description", label: "Description produit", icon: <FileText className="h-4 w-4" />, required: true },
  { key: "hs_code_10", label: "Code HS", icon: <Hash className="h-4 w-4" />, required: true },
  { key: "origin_country", label: "Pays d'origine", icon: <MapPin className="h-4 w-4" />, required: true },
];

export function DUMImport() {
  const { toast } = useToast();
  
  // Stats
  const [stats, setStats] = useState<DUMStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  
  // Import form
  const [file, setFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileFormat, setFileFormat] = useState<"csv" | "json">("csv");
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<ColumnMapping>>({});
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  
  // AI Extraction
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedRecords, setExtractedRecords] = useState<ExtractedDUM[]>([]);
  const [extractionStats, setExtractionStats] = useState<{ valid: number; invalid: number } | null>(null);
  
  // Preview
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  
  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DUMRecord[]>([]);
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
      const data = await getDUMStats();
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
    setMapping({});
    
    // Detect format
    const ext = selectedFile.name.split('.').pop()?.toLowerCase();
    if (ext === 'json') {
      setFileFormat('json');
    } else {
      setFileFormat('csv');
    }
    
    // Read file content
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      setFileContent(content);
      
      // Parse headers and preview
      if (ext !== 'json') {
        const headers = parseCSVHeaders(content);
        setAvailableColumns(headers);
        const previewData = parseCSVPreview(content, 5);
        setPreview(previewData);
        
        // Auto-detect mapping
        setIsDetecting(true);
        try {
          const result = await detectColumnMapping(headers);
          setMapping(result.mapping);
        } catch (err) {
          console.error("Auto-detect failed:", err);
        } finally {
          setIsDetecting(false);
        }
      } else {
        try {
          const parsed = JSON.parse(content);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          if (arr.length > 0) {
            const headers = Object.keys(arr[0]);
            setAvailableColumns(headers);
            setPreview({
              headers,
              rows: arr.slice(0, 5).map(row => Object.values(row).map(v => String(v)))
            });
            
            // Auto-detect mapping for JSON
            setIsDetecting(true);
            try {
              const result = await detectColumnMapping(headers);
              setMapping(result.mapping);
            } catch (err) {
              console.error("Auto-detect failed:", err);
            } finally {
              setIsDetecting(false);
            }
          }
        } catch {
          setPreview(null);
          setAvailableColumns([]);
        }
      }
    };
    reader.readAsText(selectedFile);
  }, []);

  const updateMapping = (field: keyof ColumnMapping, value: string) => {
    setMapping(prev => ({
      ...prev,
      [field]: value || undefined,
    }));
  };

  const isMappingComplete = () => {
    return mapping.dum_date && mapping.product_description && mapping.hs_code_10 && mapping.origin_country;
  };

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!fileContent || !isMappingComplete()) return;
    
    setIsImporting(true);
    setImportResult(null);
    
    try {
      const result = await importDUMRecords(
        fileContent, 
        fileFormat, 
        mapping as ColumnMapping,
        skipDuplicates
      );
      setImportResult(result);
      
      if (result.errors === 0) {
        toast({
          title: "Import reussi",
          description: `${result.imported} DUM importes. ${result.duplicates} doublons ignores.`,
        });
      } else {
        toast({
          title: "Import termine avec erreurs",
          description: `${result.imported} importes, ${result.errors} erreurs.`,
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

  // AI Extraction for DUM
  async function handleAIExtract() {
    if (!fileContent) return;
    
    setIsExtracting(true);
    setExtractedRecords([]);
    setExtractionStats(null);
    
    try {
      const result = await extractDUMRecords(fileContent);
      
      if (result.success && result.extracted.length > 0) {
        setExtractedRecords(result.extracted);
        setExtractionStats({ valid: result.stats.valid, invalid: result.stats.invalid });
        
        toast({
          title: "Extraction IA réussie",
          description: `${result.stats.valid} DUM extraits avec l'IA.`,
        });
      } else {
        toast({
          title: "Aucun DUM extrait",
          description: result.errors?.join(", ") || "L'IA n'a pas pu extraire de DUM valides.",
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

  // Import AI-extracted records directly to database
  async function handleImportExtracted() {
    if (extractedRecords.length === 0) return;
    
    setIsImporting(true);
    
    try {
      // Convert to CSV for the standard import function
      const csvContent = "dum_date;dum_number;product_description;hs_code_10;origin_country\n" +
        extractedRecords.map(r => 
          `${r.dum_date};${r.dum_number || ''};${r.product_description};${r.hs_code_10};${r.origin_country}`
        ).join("\n");
      
      const mapping: ColumnMapping = {
        dum_date: "dum_date",
        dum_number: "dum_number",
        product_description: "product_description",
        hs_code_10: "hs_code_10",
        origin_country: "origin_country"
      };
      
      const result = await importDUMRecords(csvContent, "csv", mapping, skipDuplicates);
      setImportResult(result);
      
      if (result.errors === 0) {
        toast({
          title: "Import réussi",
          description: `${result.imported} DUM importés depuis l'extraction IA.`,
        });
        setExtractedRecords([]);
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
    setIsSearching(true);
    try {
      const result = await searchDUMRecords(searchQuery, 20);
      setSearchResults(result.records);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleClear() {
    setIsClearing(true);
    try {
      await clearAllDUMRecords();
      toast({
        title: "DUM supprimes",
        description: "Tous les DUM historiques ont ete supprimes.",
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
            <CardTitle className="text-base">DUM historiques</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <p className="text-3xl font-bold">{stats?.total_records.toLocaleString() || 0}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Codes uniques</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <p className="text-3xl font-bold">{stats?.unique_codes || 0}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Periode</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingStats ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : stats?.date_range.from ? (
              <p className="text-sm text-muted-foreground">
                {format(new Date(stats.date_range.from), "MMM yyyy", { locale: fr })} - {" "}
                {stats.date_range.to ? format(new Date(stats.date_range.to), "MMM yyyy", { locale: fr }) : "..."}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune donnee</p>
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
            Historique
          </TabsTrigger>
          <TabsTrigger value="manage" className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" />
            Gestion
          </TabsTrigger>
        </TabsList>

        {/* Import Tab */}
        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Importer des DUM historiques</CardTitle>
              <CardDescription>
                Telecharger un fichier CSV ou JSON contenant vos declarations douanieres passees
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleImport} className="space-y-6">
                {/* File Upload */}
                <div className="space-y-2">
                  <Label htmlFor="dum-file">Fichier (CSV ou JSON)</Label>
                  <Input
                    id="dum-file"
                    type="file"
                    accept=".csv,.json,.txt"
                    onChange={handleFileChange}
                  />
                </div>

                {/* Column Mapping */}
                {availableColumns.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">Mapping des colonnes</h4>
                      {isDetecting && <Loader2 className="h-4 w-4 animate-spin" />}
                      {!isDetecting && isMappingComplete() && (
                        <Badge variant="outline" className="text-success border-success">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Complet
                        </Badge>
                      )}
                    </div>
                    
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {REQUIRED_FIELDS.map((field) => (
                        <div key={field.key} className="space-y-2">
                          <Label className="flex items-center gap-2">
                            {field.icon}
                            {field.label}
                            {field.required && <span className="text-destructive">*</span>}
                          </Label>
                          <Select 
                            value={mapping[field.key] || ""} 
                            onValueChange={(v) => updateMapping(field.key, v)}
                          >
                            <SelectTrigger className={mapping[field.key] ? "border-success" : ""}>
                              <SelectValue placeholder="Selectionner..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">-- Non mappe --</SelectItem>
                              {availableColumns.map((col) => (
                                <SelectItem key={col} value={col}>{col}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Preview */}
                {preview && preview.headers.length > 0 && (
                  <div className="rounded-lg border p-4">
                    <h4 className="text-sm font-medium mb-3">Apercu des donnees</h4>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {preview.headers.map((h, i) => (
                              <TableHead key={i} className="text-xs whitespace-nowrap">
                                {h}
                                {Object.values(mapping).includes(h) && (
                                  <ArrowRight className="inline h-3 w-3 ml-1 text-success" />
                                )}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.rows.map((row, i) => (
                            <TableRow key={i}>
                              {row.map((cell, j) => (
                                <TableCell key={j} className="text-xs max-w-[200px] truncate">
                                  {cell}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Options */}
                <div className="flex items-center gap-2">
                  <Checkbox 
                    id="skip-duplicates" 
                    checked={skipDuplicates}
                    onCheckedChange={(checked) => setSkipDuplicates(checked as boolean)}
                  />
                  <Label htmlFor="skip-duplicates" className="text-sm">
                    Ignorer les doublons (meme numero DUM + code + date)
                  </Label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button 
                    type="submit" 
                    disabled={isImporting || !fileContent || !isMappingComplete()}
                  >
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
              {extractedRecords.length > 0 && (
                <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Wand2 className="h-5 w-5 text-primary" />
                      <h4 className="font-medium">Extraction IA</h4>
                      <Badge variant="secondary">
                        {extractedRecords.length} DUM extraits
                      </Badge>
                      {extractionStats && (
                        <span className="text-xs text-muted-foreground">
                          ({extractionStats.valid} valides, {extractionStats.invalid} ignorés)
                        </span>
                      )}
                    </div>
                    <Button 
                      size="sm" 
                      disabled={isImporting}
                      onClick={handleImportExtracted}
                    >
                      {isImporting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      Importer ces DUM
                    </Button>
                  </div>
                  
                  <div className="max-h-64 overflow-y-auto rounded border bg-background">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Numéro</TableHead>
                          <TableHead className="text-xs">Produit</TableHead>
                          <TableHead className="text-xs">Code HS</TableHead>
                          <TableHead className="text-xs">Origine</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {extractedRecords.slice(0, 20).map((record, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs">{record.dum_date}</TableCell>
                            <TableCell className="text-xs">{record.dum_number || '-'}</TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate">{record.product_description}</TableCell>
                            <TableCell className="font-mono text-xs">{formatHSCode(record.hs_code_10)}</TableCell>
                            <TableCell className="text-xs">{record.origin_country}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {extractedRecords.length > 20 && (
                      <p className="text-xs text-muted-foreground p-2 text-center">
                        ... et {extractedRecords.length - 20} autres DUM
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
                        <strong>{importResult.imported}</strong> DUM importes sur <strong>{importResult.total_rows}</strong> lignes.
                        {importResult.duplicates > 0 && <span className="text-muted-foreground"> {importResult.duplicates} doublons ignores.</span>}
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
        </TabsContent>

        {/* Search Tab */}
        <TabsContent value="search">
          <Card>
            <CardHeader>
              <CardTitle>Historique des DUM</CardTitle>
              <CardDescription>Rechercher dans vos declarations passees</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                <Input
                  placeholder="Code HS ou mot-cle..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="max-w-md"
                />
                <Button type="submit" disabled={isSearching}>
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
                        <TableHead>Date</TableHead>
                        <TableHead>Numero</TableHead>
                        <TableHead>Code HS</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Origine</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {searchResults.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(record.dum_date), "dd/MM/yyyy")}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {record.dum_number || "-"}
                          </TableCell>
                          <TableCell className="font-mono font-medium">
                            {formatHSCode(record.hs_code_10)}
                          </TableCell>
                          <TableCell className="max-w-xs truncate">
                            {record.product_description}
                          </TableCell>
                          <TableCell>{record.origin_country}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {searchQuery && searchResults.length === 0 && !isSearching && (
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
              <CardDescription>Actions de maintenance sur vos DUM</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border">
                <div>
                  <p className="font-medium">Supprimer tous les DUM</p>
                  <p className="text-sm text-muted-foreground">
                    Supprime definitivement tous vos DUM historiques.
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
