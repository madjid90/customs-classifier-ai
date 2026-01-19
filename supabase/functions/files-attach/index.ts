import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { logger } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { 
  authenticateRequest, 
  createServiceClient,
  type UserProfile
} from "../_shared/auth.ts";
import {
  UUIDSchema,
  validateRequestBody,
  validatePathParam,
} from "../_shared/validation.ts";

// ============================================================================
// INPUT VALIDATION (Zod) - File-specific schema
// ============================================================================

const AttachFileSchema = z.object({
  file_type: z.enum([
    "tech_sheet", "invoice", "packing_list", "certificate",
    "dum", "photo_product", "photo_label", "photo_plate", "other", "admin_ingestion"
  ], { errorMap: () => ({ message: "Type de fichier invalide" }) }),
  file_url: z.string().url("L'URL du fichier doit être valide"),
  filename: z.string().min(1, "Le nom du fichier est requis").max(255, "Le nom du fichier ne peut pas dépasser 255 caractères"),
  size_bytes: z.number().int().min(0).max(50_000_000, "La taille du fichier ne peut pas dépasser 50MB"),
  storage_path: z.string().optional(),
});

type AttachFileRequest = z.infer<typeof AttachFileSchema>;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user using centralized auth
    const authResult = await authenticateRequest(req);
    if (!authResult.success) {
      return authResult.error;
    }
    
    const { user, profile } = authResult.data;
    const supabase = createServiceClient();

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract case_id from URL path: /files-attach/:case_id
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const caseId = pathParts.length > 1 ? pathParts[pathParts.length - 1] : null;

    if (!caseId || caseId === "files-attach") {
      return new Response(
        JSON.stringify({ error: "case_id is required in path" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logger.info(`Attaching file to case: ${caseId} for user: ${user.id}`);

    // Verify case exists and belongs to user's company
    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("id, status, company_id")
      .eq("id", caseId)
      .eq("company_id", profile.company_id)
      .single();

    if (caseError || !caseData) {
      logger.error("Case error:", caseError);
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if case is still editable
    if (caseData.status === "VALIDATED") {
      return new Response(
        JSON.stringify({ error: "Cannot attach files to validated cases" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse and validate request body
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Corps de requête JSON invalide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const validation = AttachFileSchema.safeParse(rawBody);
    if (!validation.success) {
      return new Response(
        JSON.stringify({
          error: "Validation error",
          details: validation.error.issues.map(i => ({
            field: i.path.join("."),
            message: i.message,
          })),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const { file_type, file_url, filename, size_bytes, storage_path } = validation.data;
    
    // Insert file record
    const { data: fileRecord, error: insertError } = await supabase
      .from("case_files")
      .insert({
        case_id: caseId,
        file_type,
        file_url,
        filename,
        size_bytes,
        storage_path: storage_path || null,
      })
      .select()
      .single();

    if (insertError) {
      logger.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to attach file" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log audit entry
    await supabase.from("audit_logs").insert({
      case_id: caseId,
      user_id: user.id,
      user_phone: profile.phone,
      action: "FILE_UPLOADED",
      meta: {
        file_id: fileRecord.id,
        filename,
        file_type,
        size_bytes,
      },
    });

    logger.info(`File attached successfully: ${fileRecord.id}`);

    return new Response(
      JSON.stringify({
        id: fileRecord.id,
        case_id: caseId,
        file_type: fileRecord.file_type,
        file_url: fileRecord.file_url,
        filename: fileRecord.filename,
        size_bytes: fileRecord.size_bytes,
        created_at: fileRecord.created_at,
      }),
      { 
        status: 201, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (err) {
    logger.error("Files attach error:", err);
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
