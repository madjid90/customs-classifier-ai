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
  Play
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { IngestionSource, INGESTION_SOURCE_LABELS } from "@/lib/types";

interface DetectedFile {
  id: string;
  file: File;
  detectedType: IngestionSource | null;
  confidence: number;
  status: "pending" | "detecting" | "ready" | "uploading" | "processing" | "done" | "error";
  error?: string;
  progress: number;
}

const SOURCE_PATTERNS: Record<IngestionSource, RegExp[]> = {
  omd: [/omd|sh\s*\d|harmonized|système harmonisé|nomenclature/i],
  maroc: [/maroc|douane|tarif|nomenclature.*maroc/i],
  lois: [/loi|dahir|décret|circulaire|finance|fiscale?/i],
  dum: [/dum|déclaration|unique|marchandise|import.*export/i],
};

function detectFileType(filename: string, content?: string): { type: IngestionSource | null; confidence: number } {
  const text = `${filename} ${content || ""}`.toLowerCase();
  
  for (const [source, patterns] of Object.entries(SOURCE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return { type: source as IngestionSource, confidence: 0.85 };
      }
    }
  }
  
  // Default detection by file extension patterns
  if (/nomenclature|tarif|code/i.test(filename)) {
    return { type: "maroc", confidence: 0.6 };
  }
  
  return { type: null, confidence: 0 };
}

export function SmartFileUpload({ onUploadComplete }: { onUploadComplete?: () => void }) {
  const { toast } = useToast();
  const [files, setFiles] = useState<DetectedFile[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newFiles: DetectedFile[] = acceptedFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      detectedType: null,
      confidence: 0,
      status: "detecting",
      progress: 0,
    }));

    setFiles((prev) => [...prev, ...newFiles]);

    // Detect file types with AI/pattern matching
    for (const fileItem of newFiles) {
      try {
        // Read first part of file for detection
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = (e.target?.result as string)?.slice(0, 2000) || "";
          const detected = detectFileType(fileItem.file.name, content);
          
          setFiles((prev) =>
            prev.map((f) =>
              f.id === fileItem.id
                ? { ...f, detectedType: detected.type, confidence: detected.confidence, status: "ready" }
                : f
            )
          );
        };
        reader.readAsText(fileItem.file.slice(0, 5000));
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileItem.id ? { ...f, status: "ready" } : f
          )
        );
      }
    }
  }, []);

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const changeFileType = (id: string, type: IngestionSource) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, detectedType: type, confidence: 1 } : f))
    );
  };

  const processFile = async (fileItem: DetectedFile) => {
    if (!fileItem.detectedType) {
      toast({
        title: "Type non détecté",
        description: "Veuillez sélectionner un type pour ce fichier.",
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

      // Generate version label from date
      const versionLabel = new Date().toISOString().split("T")[0];

      // 1. Get presigned URL
      const presignRes = await supabase.functions.invoke("files-presign", {
        body: {
          case_id: null,
          file_type: "admin_ingestion",
          filename: fileItem.file.name,
          content_type: fileItem.file.type || "application/octet-stream",
        },
      });

      if (presignRes.error) throw new Error(presignRes.error.message);

      setFiles((prev) =>
        prev.map((f) => (f.id === fileItem.id ? { ...f, progress: 30 } : f))
      );

      // 2. Upload file
      await fetch(presignRes.data.upload_url, {
        method: "PUT",
        headers: { "Content-Type": fileItem.file.type || "application/octet-stream" },
        body: fileItem.file,
      });

      setFiles((prev) =>
        prev.map((f) => (f.id === fileItem.id ? { ...f, progress: 60, status: "processing" } : f))
      );

      // 3. Register and auto-run ingestion
      const adminRes = await supabase.functions.invoke("admin", {
        body: {
          action: "register",
          source: fileItem.detectedType,
          version_label: versionLabel,
          file_url: presignRes.data.file_url,
        },
      });

      if (adminRes.error) throw new Error(adminRes.error.message);

      setFiles((prev) =>
        prev.map((f) => (f.id === fileItem.id ? { ...f, progress: 80 } : f))
      );

      // 4. Auto-run ETL
      await supabase.functions.invoke("admin", {
        body: {
          action: "etl",
          ingestion_id: adminRes.data.id,
        },
      });

      setFiles((prev) =>
        prev.map((f) => (f.id === fileItem.id ? { ...f, status: "done", progress: 100 } : f))
      );

      toast({
        title: "Fichier traité",
        description: `${fileItem.file.name} importé en tant que ${INGESTION_SOURCE_LABELS[fileItem.detectedType]}`,
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
    const readyFiles = files.filter((f) => f.status === "ready" && f.detectedType);
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
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "text/csv": [".csv"],
      "application/json": [".json"],
      "text/plain": [".txt"],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
  });

  const readyFiles = files.filter((f) => f.status === "ready" && f.detectedType);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Dépôt intelligent de fichiers
        </CardTitle>
        <CardDescription>
          Déposez vos fichiers - l'IA détecte automatiquement le type et classe les données
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Dropzone */}
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
                PDF, Excel, CSV, JSON (max 50 Mo)
              </p>
            </>
          )}
        </div>

        {/* Files List */}
        {files.length > 0 && (
          <div className="space-y-3">
            {files.map((file) => (
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
                  <CheckCircle2 className="h-5 w-5 text-success" />
                )}
                {file.status === "error" && (
                  <AlertCircle className="h-5 w-5 text-destructive" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium truncate">{file.file.name}</p>
                  </div>
                  
                  {file.status === "detecting" && (
                    <p className="text-xs text-muted-foreground">Détection du type...</p>
                  )}

                  {file.status === "ready" && file.detectedType && (
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">
                        {INGESTION_SOURCE_LABELS[file.detectedType]}
                      </Badge>
                      {file.confidence < 1 && (
                        <span className="text-xs text-muted-foreground">
                          ({Math.round(file.confidence * 100)}% confiance)
                        </span>
                      )}
                    </div>
                  )}

                  {file.status === "ready" && !file.detectedType && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-warning">Type non détecté - sélectionnez:</span>
                      <div className="flex gap-1">
                        {(["omd", "maroc", "lois", "dum"] as IngestionSource[]).map((type) => (
                          <Button
                            key={type}
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs px-2"
                            onClick={() => changeFileType(file.id, type)}
                          >
                            {INGESTION_SOURCE_LABELS[type]}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(file.status === "uploading" || file.status === "processing") && (
                    <Progress value={file.progress} className="mt-2 h-1" />
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
            ))}
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
                Traitement en cours...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Traiter {readyFiles.length} fichier{readyFiles.length > 1 ? "s" : ""}
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
