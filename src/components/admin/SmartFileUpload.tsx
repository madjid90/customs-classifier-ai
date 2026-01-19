import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Upload, 
  FileText, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  X,
  Play,
  FileImage,
  FileSpreadsheet,
  File,
  Database
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface DetectedFile {
  id: string;
  file: File;
  detectedType: string | null;
  targetDatabase: string | null;
  confidence: number;
  status: "pending" | "detecting" | "ready" | "uploading" | "processing" | "done" | "error";
  error?: string;
  progress: number;
  recordsCreated?: number;
}

const DATABASE_LABELS: Record<string, string> = {
  hs_codes: "Codes HS",
  kb_chunks_omd: "Notes OMD",
  kb_chunks_maroc: "Réglementation Maroc",
  kb_chunks_lois: "Lois de finances",
  dum_records: "Historique DUM",
  finance_law_articles: "Articles de lois",
  kb_chunks: "Base de connaissances",
};

const getFileIcon = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return FileImage;
  if (['xls', 'xlsx', 'csv'].includes(ext || '')) return FileSpreadsheet;
  if (ext === 'pdf') return FileText;
  return File;
};

export function SmartFileUpload({ onUploadComplete }: { onUploadComplete?: () => void }) {
  const { toast } = useToast();
  const [files, setFiles] = useState<DetectedFile[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);

  const analyzeFileWithAI = async (file: File): Promise<{ type: string; database: string; confidence: number }> => {
    try {
      // Read file content
      const text = await readFileContent(file);
      
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        throw new Error("Non authentifié");
      }

      // Call AI analysis
      const response = await supabase.functions.invoke("analyze-file", {
        body: {
          action: "analyze",
          content: text.slice(0, 10000), // Send first 10KB for analysis
          filename: file.name,
        },
      });

      if (response.error) throw response.error;

      return {
        type: response.data.detectedType || "Document",
        database: response.data.targetDatabase || "kb_chunks",
        confidence: response.data.confidence || 0.5,
      };
    } catch (e) {
      console.error("AI analysis failed:", e);
      // Fallback to basic detection
      return basicDetection(file.name);
    }
  };

  const basicDetection = (filename: string): { type: string; database: string; confidence: number } => {
    const lower = filename.toLowerCase();
    
    if (/sh|harmonised|tarif|nomenclature/i.test(lower)) {
      return { type: "Nomenclature HS", database: "hs_codes", confidence: 0.7 };
    }
    if (/omd|wco|explicat/i.test(lower)) {
      return { type: "Notes OMD", database: "kb_chunks_omd", confidence: 0.7 };
    }
    if (/loi|dahir|décret|finance/i.test(lower)) {
      return { type: "Loi de finances", database: "kb_chunks_lois", confidence: 0.7 };
    }
    if (/dum|déclaration|import|export/i.test(lower)) {
      return { type: "Historique DUM", database: "dum_records", confidence: 0.6 };
    }
    if (/maroc|adii|douane/i.test(lower)) {
      return { type: "Réglementation Maroc", database: "kb_chunks_maroc", confidence: 0.6 };
    }
    
    return { type: "Document", database: "kb_chunks", confidence: 0.5 };
  };

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string || "");
      reader.onerror = () => reject(new Error("Erreur de lecture"));
      
      // For binary files, try to read as text anyway
      if (file.type.includes("image") || file.type.includes("application/pdf")) {
        // For PDF/images, we'll rely on filename analysis mainly
        resolve(`[Fichier binaire: ${file.name}]`);
      } else {
        reader.readAsText(file);
      }
    });
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newFiles: DetectedFile[] = acceptedFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      detectedType: null,
      targetDatabase: null,
      confidence: 0,
      status: "detecting" as const,
      progress: 0,
    }));

    setFiles((prev) => [...prev, ...newFiles]);

    // Analyze each file with AI
    for (const fileItem of newFiles) {
      try {
        const analysis = await analyzeFileWithAI(fileItem.file);
        
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileItem.id
              ? { 
                  ...f, 
                  detectedType: analysis.type, 
                  targetDatabase: analysis.database,
                  confidence: analysis.confidence, 
                  status: "ready" 
                }
              : f
          )
        );
      } catch {
        const fallback = basicDetection(fileItem.file.name);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileItem.id 
              ? { 
                  ...f, 
                  detectedType: fallback.type,
                  targetDatabase: fallback.database,
                  confidence: fallback.confidence,
                  status: "ready" 
                } 
              : f
          )
        );
      }
    }
  }, []);

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const changeDatabase = (id: string, database: string) => {
    const dbInfo = Object.entries(DATABASE_LABELS).find(([key]) => key === database);
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { 
        ...f, 
        targetDatabase: database, 
        detectedType: dbInfo?.[1] || "Document",
        confidence: 1 
      } : f))
    );
  };

  const processFile = async (fileItem: DetectedFile) => {
    if (!fileItem.targetDatabase) {
      toast({
        title: "Base cible non définie",
        description: "Veuillez sélectionner une base de données.",
        variant: "destructive",
      });
      return;
    }

    setFiles((prev) =>
      prev.map((f) => (f.id === fileItem.id ? { ...f, status: "uploading", progress: 10 } : f))
    );

    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) throw new Error("Non authentifié");

      // Read file content
      const content = await readFileContent(fileItem.file);

      setFiles((prev) =>
        prev.map((f) => (f.id === fileItem.id ? { ...f, progress: 40, status: "processing" } : f))
      );

      // Process with AI and store
      const response = await supabase.functions.invoke("analyze-file", {
        body: {
          action: "process",
          content: content,
          filename: fileItem.file.name,
        },
      });

      if (response.error) throw new Error(response.error.message);

      setFiles((prev) =>
        prev.map((f) => (f.id === fileItem.id ? { 
          ...f, 
          status: "done", 
          progress: 100,
          recordsCreated: response.data.recordsCreated || 0
        } : f))
      );

      toast({
        title: "Fichier traité avec succès",
        description: `${fileItem.file.name} → ${response.data.recordsCreated || 0} enregistrements créés dans ${DATABASE_LABELS[response.data.targetDatabase] || "la base"}`,
      });
    } catch (err) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileItem.id
            ? { ...f, status: "error", error: err instanceof Error ? err.message : "Erreur" }
            : f
        )
      );
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur lors du traitement",
        variant: "destructive",
      });
    }
  };

  const processAllFiles = async () => {
    const readyFiles = files.filter((f) => f.status === "ready" && f.targetDatabase);
    if (readyFiles.length === 0) return;

    setIsProcessingAll(true);
    for (const file of readyFiles) {
      await processFile(file);
    }
    setIsProcessingAll(false);
    onUploadComplete?.();
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    // Accept ALL file types
    maxSize: 50 * 1024 * 1024, // 50MB
  });

  const readyFiles = files.filter((f) => f.status === "ready" && f.targetDatabase);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Dépôt intelligent de fichiers
        </CardTitle>
        <CardDescription>
          L'IA analyse et classe automatiquement vos fichiers dans les bonnes bases de données
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Dropzone - accepts all files */}
        <div
          {...getRootProps()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
          )}
        >
          <input {...getInputProps()} />
          <Upload className="mb-2 h-10 w-10 text-muted-foreground" />
          {isDragActive ? (
            <p className="text-sm text-primary">Déposez les fichiers ici...</p>
          ) : (
            <>
              <p className="text-sm font-medium">Glissez-déposez vos fichiers</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tous types acceptés - L'IA détecte automatiquement le contenu (max 50 Mo)
              </p>
            </>
          )}
        </div>

        {/* Files List */}
        {files.length > 0 && (
          <div className="space-y-3">
            {files.map((file) => {
              const FileIcon = getFileIcon(file.file.name);
              
              return (
                <div
                  key={file.id}
                  className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
                >
                  {file.status === "detecting" && (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  )}
                  {file.status === "ready" && (
                    <Sparkles className="h-5 w-5 text-primary" />
                  )}
                  {file.status === "uploading" && (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  )}
                  {file.status === "processing" && (
                    <Loader2 className="h-5 w-5 animate-spin text-accent" />
                  )}
                  {file.status === "done" && (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  )}
                  {file.status === "error" && (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <FileIcon className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-medium truncate">{file.file.name}</p>
                      <span className="text-xs text-muted-foreground">
                        ({(file.file.size / 1024).toFixed(1)} Ko)
                      </span>
                    </div>
                    
                    {file.status === "detecting" && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        Analyse IA en cours...
                      </p>
                    )}

                    {file.status === "ready" && file.targetDatabase && (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="secondary" className="text-xs flex items-center gap-1">
                          <Database className="h-3 w-3" />
                          {DATABASE_LABELS[file.targetDatabase] || file.targetDatabase}
                        </Badge>
                        {file.confidence < 1 && (
                          <span className="text-xs text-muted-foreground">
                            ({Math.round(file.confidence * 100)}% confiance)
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">|</span>
                        <span className="text-xs text-muted-foreground">Changer:</span>
                        <div className="flex gap-1 flex-wrap">
                          {Object.entries(DATABASE_LABELS).slice(0, 4).map(([key, label]) => (
                            <Button
                              key={key}
                              variant={file.targetDatabase === key ? "default" : "outline"}
                              size="sm"
                              className="h-5 text-xs px-1.5"
                              onClick={() => changeDatabase(file.id, key)}
                            >
                              {label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {file.status === "done" && (
                      <p className="text-xs text-green-600 mt-1">
                        ✓ {file.recordsCreated} enregistrement(s) créé(s)
                      </p>
                    )}

                    {(file.status === "uploading" || file.status === "processing") && (
                      <div className="mt-2">
                        <Progress value={file.progress} className="h-1" />
                        <p className="text-xs text-muted-foreground mt-1">
                          {file.status === "uploading" ? "Envoi..." : "Traitement IA..."}
                        </p>
                      </div>
                    )}

                    {file.error && (
                      <p className="text-xs text-destructive mt-1">{file.error}</p>
                    )}
                  </div>

                  {file.status === "ready" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeFile(file.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Process All Button */}
        {readyFiles.length > 0 && (
          <Button
            onClick={processAllFiles}
            disabled={isProcessingAll}
            className="w-full"
          >
            {isProcessingAll ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Traitement IA en cours...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Traiter {readyFiles.length} fichier{readyFiles.length > 1 ? "s" : ""} avec l'IA
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
