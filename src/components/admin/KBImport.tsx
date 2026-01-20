import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { 
  Upload, 
  FileText, 
  Database, 
  CheckCircle, 
  AlertCircle, 
  Trash2, 
  Search,
  BookOpen,
  Scale,
  FileCode,
  Package,
  RefreshCw,
  Sparkles,
  Wand2
} from "lucide-react";
import { toast } from "sonner";
import { 
  importKBDocuments, 
  getKBStats, 
  searchKBChunks, 
  deleteKBChunks,
  parseTextFile,
  type KBSource,
  type DocumentInput,
  type KBStats 
} from "@/lib/kb-import-api";
import { extractKBChunks, readFileAsText, type ExtractedKBChunk } from "@/lib/extract-api";

const SOURCE_CONFIG: Record<KBSource, { label: string; icon: typeof BookOpen; color: string; description: string }> = {
  omd: { 
    label: "Notes OMD/SH", 
    icon: BookOpen, 
    color: "bg-blue-500",
    description: "Notes explicatives du Système Harmonisé (OMD)"
  },
  maroc: { 
    label: "Tarif Marocain", 
    icon: FileCode, 
    color: "bg-green-500",
    description: "Nomenclature et tarif douanier marocain"
  },
  lois: { 
    label: "Lois de Finances", 
    icon: Scale, 
    color: "bg-purple-500",
    description: "Articles de lois de finances et textes réglementaires"
  },
  dum: { 
    label: "Références DUM", 
    icon: Package, 
    color: "bg-orange-500",
    description: "Documentation liée aux déclarations DUM"
  },
};

export function KBImport() {
  const [activeTab, setActiveTab] = useState<"import" | "browse" | "stats">("import");
  const [source, setSource] = useState<KBSource>("omd");
  const [versionLabel, setVersionLabel] = useState(new Date().getFullYear().toString());
  const [documents, setDocuments] = useState<DocumentInput[]>([]);
  const [manualContent, setManualContent] = useState("");
  const [manualDocId, setManualDocId] = useState("");
  const [manualRefPrefix, setManualRefPrefix] = useState("");
  const [manualSourceUrl, setManualSourceUrl] = useState("");
  const [globalSourceUrl, setGlobalSourceUrl] = useState("");
  const [globalSourceUrlError, setGlobalSourceUrlError] = useState("");
  const [chunkSize, setChunkSize] = useState(1000);
  const [chunkOverlap, setChunkOverlap] = useState(200);
  const [clearExisting, setClearExisting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [stats, setStats] = useState<KBStats | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // AI Extraction states
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiContent, setAiContent] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedChunks, setExtractedChunks] = useState<ExtractedKBChunk[]>([]);
  const [extractionStats, setExtractionStats] = useState<{ valid: number; invalid: number } | null>(null);

  // Validate URL format
  const isValidUrl = (url: string): boolean => {
    if (!url.trim()) return true; // Empty is valid (optional)
    return url.startsWith("http://") || url.startsWith("https://");
  };

  // Handle global source URL change with validation
  const handleGlobalSourceUrlChange = (url: string) => {
    setGlobalSourceUrl(url);
    if (url.trim() && !isValidUrl(url)) {
      setGlobalSourceUrlError("L'URL doit commencer par http:// ou https://");
    } else {
      setGlobalSourceUrlError("");
    }
  };

  // File upload handler
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newDocs: DocumentInput[] = [];
    
    for (const file of acceptedFiles) {
      try {
        const content = await file.text();
        const fileName = file.name.replace(/\.[^.]+$/, "");
        
        if (file.name.endsWith(".txt") || file.name.endsWith(".md")) {
          // Parse text file for multiple documents
          const parsed = parseTextFile(content);
          newDocs.push(...parsed.map(doc => ({
            ...doc,
            doc_id: `${fileName}_${doc.doc_id}`,
          })));
        } else if (file.name.endsWith(".json")) {
          // Parse JSON (expect array of documents or single document)
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item.doc_id && item.content) {
                newDocs.push({
                  doc_id: item.doc_id,
                  title: item.title,
                  content: item.content,
                  ref_prefix: item.ref_prefix,
                  source_url: item.source_url,
                });
              }
            }
          } else if (parsed.doc_id && parsed.content) {
            newDocs.push(parsed);
          }
        } else {
          // Treat as single text document
          newDocs.push({
            doc_id: fileName.toLowerCase().replace(/\s+/g, "_"),
            title: fileName,
            content,
            ref_prefix: fileName,
          });
        }
      } catch (e) {
        toast.error(`Erreur lecture ${file.name}`);
      }
    }
    
    setDocuments(prev => [...prev, ...newDocs]);
    toast.success(`${newDocs.length} document(s) ajouté(s)`);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/plain": [".txt"],
      "text/markdown": [".md"],
      "application/json": [".json"],
    },
  });

  // Add manual document
  const handleAddManual = () => {
    if (!manualDocId.trim() || !manualContent.trim()) {
      toast.error("ID et contenu requis");
      return;
    }
    
    setDocuments(prev => [...prev, {
      doc_id: manualDocId.trim(),
      content: manualContent.trim(),
      ref_prefix: manualRefPrefix.trim() || undefined,
      source_url: manualSourceUrl.trim() || undefined,
    }]);
    
    setManualDocId("");
    setManualContent("");
    setManualRefPrefix("");
    setManualSourceUrl("");
    toast.success("Document ajouté");
  };

  // Remove document
  const handleRemoveDocument = (index: number) => {
    setDocuments(prev => prev.filter((_, i) => i !== index));
  };

  // Import documents
  const handleImport = async () => {
    if (documents.length === 0) {
      toast.error("Aucun document à importer");
      return;
    }

    // Validate global source URL if provided
    if (globalSourceUrl.trim() && !isValidUrl(globalSourceUrl)) {
      toast.error("URL source invalide - doit commencer par http:// ou https://");
      return;
    }

    setIsImporting(true);
    setImportProgress(10);

    try {
      // Apply global source URL to documents that don't have one
      const docsWithSourceUrl = documents.map(doc => ({
        ...doc,
        source_url: doc.source_url || (globalSourceUrl.trim() || undefined),
      }));

      const result = await importKBDocuments({
        source,
        version_label: versionLabel,
        documents: docsWithSourceUrl,
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
        clear_existing: clearExisting,
      });

      setImportProgress(100);

      if (result.success) {
        toast.success(`Import réussi: ${result.total_chunks_created} chunks créés`);
        setDocuments([]);
        setGlobalSourceUrl("");
        loadStats();
      } else {
        toast.warning(`Import partiel: ${result.total_chunks_created} chunks, ${result.errors.length} erreurs`);
        console.error("Import errors:", result.errors);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur import");
    } finally {
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  // Load stats
  const loadStats = async () => {
    try {
      const data = await getKBStats();
      setStats(data);
    } catch (e) {
      console.error("Error loading stats:", e);
    }
  };

  // Search
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const results = await searchKBChunks(searchQuery);
      setSearchResults(results);
    } catch (e) {
      toast.error("Erreur recherche");
    } finally {
      setIsSearching(false);
    }
  };

  // Delete chunks
  const handleDeleteChunks = async (deleteSource?: KBSource, deleteVersion?: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ces chunks ?")) return;
    
    try {
      await deleteKBChunks(deleteSource, deleteVersion);
      toast.success("Chunks supprimés");
      loadStats();
    } catch (e) {
      toast.error("Erreur suppression");
    }
  };

  // Load stats on mount
  useState(() => {
    loadStats();
  });

  // AI Extraction handler
  const handleAIExtract = async () => {
    let content = aiContent;
    
    // If file is provided, read it
    if (aiFile && !aiContent.trim()) {
      try {
        content = await readFileAsText(aiFile);
      } catch (e) {
        toast.error("Erreur lecture fichier");
        return;
      }
    }
    
    if (!content.trim()) {
      toast.error("Veuillez fournir un fichier ou du contenu texte");
      return;
    }

    setIsExtracting(true);
    setExtractedChunks([]);
    setExtractionStats(null);

    try {
      toast.info("Extraction IA en cours... Cela peut prendre quelques minutes.");
      
      const result = await extractKBChunks(content, versionLabel);
      
      if (result.success && result.extracted.length > 0) {
        setExtractedChunks(result.extracted);
        setExtractionStats({
          valid: result.stats.valid,
          invalid: result.stats.invalid
        });
        toast.success(`${result.stats.valid} chunks extraits par l'IA`);
      } else {
        toast.warning("Aucun chunk extrait. Vérifiez le contenu du fichier.");
      }
      
      if (result.errors && result.errors.length > 0) {
        console.warn("AI extraction warnings:", result.errors);
      }
    } catch (e) {
      console.error("AI extraction error:", e);
      toast.error(e instanceof Error ? e.message : "Erreur extraction IA");
    } finally {
      setIsExtracting(false);
    }
  };

  // Convert extracted chunks to documents and import
  const handleImportExtracted = async () => {
    if (extractedChunks.length === 0) {
      toast.error("Aucun chunk à importer");
      return;
    }

    setIsImporting(true);
    setImportProgress(10);

    try {
      // Convert extracted chunks to documents format
      const docsToImport: DocumentInput[] = extractedChunks.map(chunk => ({
        doc_id: chunk.doc_id,
        content: chunk.text,
        ref_prefix: chunk.ref,
      }));

      setImportProgress(30);

      const result = await importKBDocuments({
        source,
        version_label: versionLabel,
        documents: docsToImport,
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
        clear_existing: clearExisting,
      });

      setImportProgress(100);

      if (result.success) {
        toast.success(`Import réussi: ${result.total_chunks_created} chunks créés`);
        setExtractedChunks([]);
        setExtractionStats(null);
        setAiFile(null);
        setAiContent("");
        loadStats();
      } else {
        toast.warning(`Import partiel: ${result.total_chunks_created} chunks, ${result.errors.length} erreurs`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur import");
    } finally {
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const SourceIcon = SOURCE_CONFIG[source].icon;

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="import" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import
          </TabsTrigger>
          <TabsTrigger value="ai-extract" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Extraction IA
          </TabsTrigger>
          <TabsTrigger value="browse" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Recherche
          </TabsTrigger>
          <TabsTrigger value="stats" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Stats
          </TabsTrigger>
        </TabsList>

        {/* IMPORT TAB */}
        <TabsContent value="import" className="space-y-4">
          {/* Source & Version */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SourceIcon className="h-5 w-5" />
                Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Source</Label>
                  <Select value={source} onValueChange={(v) => setSource(v as KBSource)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SOURCE_CONFIG).map(([key, config]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <config.icon className="h-4 w-4" />
                            {config.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {SOURCE_CONFIG[source].description}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Version</Label>
                  <Input
                    value={versionLabel}
                    onChange={(e) => setVersionLabel(e.target.value)}
                    placeholder="ex: 2024, v2.1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Taille chunks (caractères)</Label>
                  <Input
                    type="number"
                    value={chunkSize}
                    onChange={(e) => setChunkSize(parseInt(e.target.value) || 1000)}
                    min={200}
                    max={5000}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Chevauchement</Label>
                  <Input
                    type="number"
                    value={chunkOverlap}
                    onChange={(e) => setChunkOverlap(parseInt(e.target.value) || 0)}
                    min={0}
                    max={500}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="clear-existing"
                  checked={clearExisting}
                  onCheckedChange={setClearExisting}
                />
                <Label htmlFor="clear-existing" className="text-sm">
                  Effacer les chunks existants (source + version)
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* File Upload */}
          <Card>
            <CardHeader>
              <CardTitle>Upload fichiers</CardTitle>
              <CardDescription>
                Formats supportés: .txt, .md, .json
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
                }`}
              >
                <input {...getInputProps()} />
                <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                {isDragActive ? (
                  <p>Déposez les fichiers ici...</p>
                ) : (
                  <p>Glissez-déposez ou cliquez pour sélectionner</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Manual Input */}
          <Card>
            <CardHeader>
              <CardTitle>Saisie manuelle</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ID Document *</Label>
                  <Input
                    value={manualDocId}
                    onChange={(e) => setManualDocId(e.target.value)}
                    placeholder="ex: chapitre_84"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Préfixe référence</Label>
                  <Input
                    value={manualRefPrefix}
                    onChange={(e) => setManualRefPrefix(e.target.value)}
                    placeholder="ex: Chapitre 84"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>URL source (optionnel)</Label>
                <Input
                  value={manualSourceUrl}
                  onChange={(e) => setManualSourceUrl(e.target.value)}
                  placeholder="ex: https://douane.gov.ma/document.pdf"
                  type="url"
                />
                <p className="text-xs text-muted-foreground">
                  Lien vers le document officiel pour traçabilité
                </p>
              </div>
              <div className="space-y-2">
                <Label>Contenu *</Label>
                <Textarea
                  value={manualContent}
                  onChange={(e) => setManualContent(e.target.value)}
                  placeholder="Collez le texte ici..."
                  rows={6}
                />
              </div>
              <Button onClick={handleAddManual} variant="secondary">
                <FileText className="h-4 w-4 mr-2" />
                Ajouter document
              </Button>
            </CardContent>
          </Card>

          {/* Documents List */}
          {documents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Documents à importer ({documents.length})</span>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => setDocuments([])}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Tout effacer
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {documents.map((doc, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{doc.doc_id}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {doc.content.slice(0, 100)}...
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {doc.content.length} caractères
                          </span>
                          {doc.source_url && (
                            <a
                              href={doc.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline flex items-center gap-1"
                            >
                              🔗 Source
                            </a>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveDocument(idx)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Source URL & Import Button */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <Label>URL source du document (optionnel)</Label>
                <Input
                  value={globalSourceUrl}
                  onChange={(e) => handleGlobalSourceUrlChange(e.target.value)}
                  placeholder="ex: https://douane.gov.ma/nomenclature-2024.pdf"
                  type="url"
                  className={globalSourceUrlError ? "border-destructive" : ""}
                />
                {globalSourceUrlError ? (
                  <p className="text-xs text-destructive">{globalSourceUrlError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Optionnel - URL officielle du document (ex: lien vers le PDF sur douane.gov.ma). 
                    Sera appliquée à tous les documents qui n'ont pas déjà une URL source.
                  </p>
                )}
              </div>

              {isImporting && (
                <Progress value={importProgress} />
              )}
              <Button
                onClick={handleImport}
                disabled={documents.length === 0 || isImporting || !!globalSourceUrlError}
                className="w-full"
                size="lg"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Import en cours...
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4 mr-2" />
                    Importer {documents.length} document(s)
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI EXTRACTION TAB */}
        <TabsContent value="ai-extract" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-500" />
                Extraction IA de documents
              </CardTitle>
              <CardDescription>
                Utilisez l'IA pour extraire automatiquement des chunks structurés depuis des documents complexes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Source & Version for AI */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Source cible</Label>
                  <Select value={source} onValueChange={(v) => setSource(v as KBSource)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SOURCE_CONFIG).map(([key, config]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <config.icon className="h-4 w-4" />
                            {config.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Version</Label>
                  <Input
                    value={versionLabel}
                    onChange={(e) => setVersionLabel(e.target.value)}
                    placeholder="ex: 2024"
                  />
                </div>
              </div>

              {/* File Input */}
              <div className="space-y-2">
                <Label>Fichier source</Label>
                <Input
                  type="file"
                  accept=".txt,.md,.pdf,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setAiFile(file);
                      setAiContent("");
                    }
                  }}
                />
                {aiFile && (
                  <p className="text-sm text-muted-foreground">
                    Fichier: {aiFile.name} ({(aiFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              {/* Or Text Content */}
              <div className="space-y-2">
                <Label>Ou collez le contenu texte</Label>
                <Textarea
                  value={aiContent}
                  onChange={(e) => {
                    setAiContent(e.target.value);
                    if (e.target.value.trim()) setAiFile(null);
                  }}
                  placeholder="Collez ici le texte brut du document à analyser..."
                  rows={8}
                />
                {aiContent && (
                  <p className="text-sm text-muted-foreground">
                    {aiContent.length} caractères
                  </p>
                )}
              </div>

              <Button
                onClick={handleAIExtract}
                disabled={isExtracting || (!aiFile && !aiContent.trim())}
                className="w-full"
                variant="secondary"
              >
                {isExtracting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Extraction en cours...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4 mr-2" />
                    Extraire avec l'IA
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Extraction Results */}
          {extractionStats && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  Résultats de l'extraction
                </CardTitle>
                <CardDescription>
                  {extractionStats.valid} chunks valides extraits, {extractionStats.invalid} invalides
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {extractedChunks.map((chunk, idx) => (
                    <div key={idx} className="p-3 bg-muted rounded-lg space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{chunk.doc_id}</Badge>
                        <span className="text-sm font-medium">{chunk.ref}</span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-3">
                        {chunk.text}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {chunk.text.length} caractères | Source: {chunk.source}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Import Extracted Button */}
          {extractedChunks.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                {isImporting && (
                  <Progress value={importProgress} className="mb-4" />
                )}
                <Button
                  onClick={handleImportExtracted}
                  disabled={isImporting}
                  className="w-full"
                  size="lg"
                >
                  {isImporting ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Import en cours...
                    </>
                  ) : (
                    <>
                      <Database className="h-4 w-4 mr-2" />
                      Importer {extractedChunks.length} chunks extraits
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* BROWSE TAB */}
        <TabsContent value="browse" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Rechercher dans la base</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Mots-clés..."
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <Button onClick={handleSearch} disabled={isSearching}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>

              {searchResults.length > 0 && (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {searchResults.map((result, idx) => (
                    <div key={idx} className="p-4 bg-muted rounded-lg space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge className={SOURCE_CONFIG[result.source as KBSource]?.color}>
                          {result.source}
                        </Badge>
                        <span className="text-sm font-medium">{result.ref}</span>
                        <span className="text-xs text-muted-foreground">
                          ({result.doc_id})
                        </span>
                      </div>
                      <p className="text-sm">{result.text.slice(0, 300)}...</p>
                      <p className="text-xs text-muted-foreground">
                        Version: {result.version_label}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* STATS TAB */}
        <TabsContent value="stats" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" onClick={loadStats}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Rafraîchir
            </Button>
          </div>

          {stats && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold">{stats.total_chunks}</div>
                    <div className="text-sm text-muted-foreground">Total chunks</div>
                  </CardContent>
                </Card>
                {Object.entries(stats.by_source).map(([src, count]) => (
                  <Card key={src}>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-3 h-3 rounded-full ${SOURCE_CONFIG[src as KBSource]?.color}`} />
                        <span className="text-sm font-medium">{SOURCE_CONFIG[src as KBSource]?.label}</span>
                      </div>
                      <div className="text-2xl font-bold">{count}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Par version</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(stats.by_version).map(([version, count]) => (
                      <div key={version} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                        <span className="font-medium">{version}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{count} chunks</Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteChunks(undefined, version)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
