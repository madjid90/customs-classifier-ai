import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { CaseFileType, FILE_TYPE_LABELS, CaseFile } from "@/lib/types";
import { uploadAndAttachFile } from "@/lib/api-client";
import { 
  Upload, 
  X, 
  FileText, 
  Image, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  File
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface FileUploadZoneProps {
  caseId: string;
  existingFiles: CaseFile[];
  onFileUploaded: (file: CaseFile) => void;
}

interface UploadingFile {
  id: string;
  file: File;
  fileType: CaseFileType;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
}

const FILE_TYPE_OPTIONS: CaseFileType[] = [
  "tech_sheet",
  "invoice",
  "packing_list",
  "certificate",
  "dum",
  "photo_product",
  "photo_label",
  "photo_plate",
  "other",
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ACCEPTED_FILE_TYPES = {
  "application/pdf": [".pdf"],
  "image/*": [".jpg", ".jpeg", ".png", ".webp", ".gif"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
};

export function FileUploadZone({ caseId, existingFiles, onFileUploaded }: FileUploadZoneProps) {
  const { toast } = useToast();
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [selectedFileType, setSelectedFileType] = useState<CaseFileType>("tech_sheet");

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: UploadingFile[] = acceptedFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      fileType: selectedFileType,
      progress: 0,
      status: "pending",
    }));

    setUploadingFiles((prev) => [...prev, ...newFiles]);

    // Start uploading each file
    newFiles.forEach((uploadFile) => {
      handleUpload(uploadFile);
    });
  }, [selectedFileType, caseId]);

  const handleUpload = async (uploadFile: UploadingFile) => {
    setUploadingFiles((prev) =>
      prev.map((f) =>
        f.id === uploadFile.id ? { ...f, status: "uploading", progress: 10 } : f
      )
    );

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.id === uploadFile.id && f.progress < 90
              ? { ...f, progress: f.progress + 10 }
              : f
          )
        );
      }, 200);

      const result = await uploadAndAttachFile(caseId, uploadFile.file, uploadFile.fileType);

      clearInterval(progressInterval);

      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id ? { ...f, status: "success", progress: 100 } : f
        )
      );

      // Notify parent
      onFileUploaded({
        id: result.attach_id,
        case_id: caseId,
        file_type: uploadFile.fileType,
        file_url: result.file_url,
        filename: uploadFile.file.name,
        size_bytes: uploadFile.file.size,
        created_at: new Date().toISOString(),
      });

      // Remove from uploading list after a delay
      setTimeout(() => {
        setUploadingFiles((prev) => prev.filter((f) => f.id !== uploadFile.id));
      }, 2000);
    } catch (error) {
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id
            ? { ...f, status: "error", error: error instanceof Error ? error.message : "Erreur" }
            : f
        )
      );
      toast({
        title: "Erreur de telechargement",
        description: error instanceof Error ? error.message : "Impossible de telecharger le fichier.",
        variant: "destructive",
      });
    }
  };

  const removeUploadingFile = (id: string) => {
    setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxSize: MAX_FILE_SIZE,
    onDropRejected: (rejections) => {
      rejections.forEach((rejection) => {
        const errors = rejection.errors.map((e) => e.message).join(", ");
        toast({
          title: "Fichier rejete",
          description: `${rejection.file.name}: ${errors}`,
          variant: "destructive",
        });
      });
    },
  });

  const getFileIcon = (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext || "")) {
      return <Image className="h-4 w-4" />;
    }
    return <FileText className="h-4 w-4" />;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="h-5 w-5 text-accent" />
          Documents
        </CardTitle>
        <CardDescription>
          Ajoutez les documents necessaires a la classification
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* File Type Selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Type de document:</span>
          <Select value={selectedFileType} onValueChange={(v) => setSelectedFileType(v as CaseFileType)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILE_TYPE_OPTIONS.map((type) => (
                <SelectItem key={type} value={type}>
                  {FILE_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
          <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
          {isDragActive ? (
            <p className="text-sm text-primary">Deposez les fichiers ici...</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Glissez-deposez ou cliquez pour selectionner
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                PDF, images, Word, Excel (max 20 Mo)
              </p>
            </>
          )}
        </div>

        {/* Uploading Files */}
        {uploadingFiles.length > 0 && (
          <div className="space-y-2">
            {uploadingFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
              >
                {file.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {file.status === "success" && <CheckCircle2 className="h-4 w-4 text-success" />}
                {file.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
                {file.status === "pending" && <File className="h-4 w-4 text-muted-foreground" />}
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {FILE_TYPE_LABELS[file.fileType]}
                  </p>
                  {file.status === "uploading" && (
                    <Progress value={file.progress} className="mt-1 h-1" />
                  )}
                  {file.error && (
                    <p className="text-xs text-destructive">{file.error}</p>
                  )}
                </div>

                {(file.status === "error" || file.status === "pending") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => removeUploadingFile(file.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Existing Files */}
        {existingFiles.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              Fichiers attaches ({existingFiles.length})
            </p>
            {existingFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                {getFileIcon(file.filename)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {FILE_TYPE_LABELS[file.file_type]} - {(file.size_bytes / 1024).toFixed(1)} Ko
                  </p>
                </div>
                <CheckCircle2 className="h-4 w-4 text-success" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
