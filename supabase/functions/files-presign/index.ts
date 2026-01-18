import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { logger } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { 
  authenticateRequest, 
  createServiceClient
} from "../_shared/auth.ts";
import {
  UUIDSchema,
  validateRequestBody,
} from "../_shared/validation.ts";

// ============================================================================
// INPUT VALIDATION (Zod) - Presign-specific schema
// ============================================================================

const FileTypeSchema = z.enum([
  "tech_sheet", "invoice", "packing_list", "certificate", 
  "dum", "photo_product", "photo_label", "photo_plate", 
  "other", "admin_ingestion"
], { errorMap: () => ({ message: "Type de fichier invalide" }) });

const ContentTypeSchema = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
], { errorMap: () => ({ message: "Type de contenu invalide. Autorisé: PDF, images, DOCX, XLSX" }) });

const PresignRequestSchema = z.object({
  case_id: UUIDSchema.nullable().optional(),
  file_type: FileTypeSchema,
  filename: z.string().min(1, "Nom de fichier requis").max(255, "Nom de fichier trop long"),
  content_type: ContentTypeSchema,
});

type PresignRequest = z.infer<typeof PresignRequestSchema>;

Deno.serve(async (req) => {
  const reqCorsHeaders = getCorsHeaders(req);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: reqCorsHeaders });
  }

  try {
    // Authenticate user using centralized auth
    const authResult = await authenticateRequest(req);
    if (!authResult.success) {
      return authResult.error;
    }
    
    const { user } = authResult.data;
    const supabase = createServiceClient();

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...reqCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate request body using centralized validation
    const validation = await validateRequestBody(req, PresignRequestSchema, reqCorsHeaders);
    if (!validation.success) {
      return validation.error;
    }
    
    const { case_id, file_type, filename, content_type } = validation.data;

    // Generate unique file path
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = case_id 
      ? `${case_id}/${file_type}/${timestamp}-${randomId}-${sanitizedFilename}`
      : `temp/${user.id}/${file_type}/${timestamp}-${randomId}-${sanitizedFilename}`;

    logger.info(`Generating presigned URL for: ${filePath}`);

    // Create signed upload URL (valid for 1 hour)
    const { data: signedData, error: signedError } = await supabase.storage
      .from("case-files")
      .createSignedUploadUrl(filePath);

    if (signedError) {
      logger.error("Error creating signed URL:", signedError);
      return new Response(
        JSON.stringify({ error: "Failed to generate upload URL" }),
        { status: 500, headers: { ...reqCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate public URL for accessing the file after upload
    const { data: publicUrlData } = supabase.storage
      .from("case-files")
      .getPublicUrl(filePath);

    // For private buckets, generate a signed URL for reading
    const { data: signedReadData } = await supabase.storage
      .from("case-files")
      .createSignedUrl(filePath, 60 * 60 * 24 * 7); // 7 days validity

    logger.info(`Presigned URL generated successfully for user ${user.id}`);

    return new Response(
      JSON.stringify({
        upload_url: signedData.signedUrl,
        file_url: signedReadData?.signedUrl || publicUrlData.publicUrl,
        file_path: filePath,
        token: signedData.token,
      }),
      { 
        status: 200, 
        headers: { ...reqCorsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (err) {
    logger.error("Presign error:", err);
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
