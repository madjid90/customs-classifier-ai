import { logger } from "../_shared/logger.ts";
import { corsHeaders, getCorsHeaders } from "../_shared/cors.ts";
import { 
  authenticateRequest, 
  createServiceClient
} from "../_shared/auth.ts";

interface PresignRequest {
  case_id: string | null;
  file_type: string;
  filename: string;
  content_type: string;
}

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

    const body: PresignRequest = await req.json();
    const { case_id, file_type, filename, content_type } = body;

    // Validate required fields
    if (!file_type || !filename || !content_type) {
      return new Response(
        JSON.stringify({ error: "file_type, filename, and content_type are required" }),
        { status: 400, headers: { ...reqCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate file type - matches case_file_type enum
    const allowedFileTypes = [
      "tech_sheet", "invoice", "packing_list", "certificate", 
      "dum", "photo_product", "photo_label", "photo_plate", 
      "other", "admin_ingestion"
    ];
    if (!allowedFileTypes.includes(file_type)) {
      return new Response(
        JSON.stringify({ error: `Invalid file_type. Allowed: ${allowedFileTypes.join(", ")}` }),
        { status: 400, headers: { ...reqCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate content type
    const allowedContentTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (!allowedContentTypes.includes(content_type)) {
      return new Response(
        JSON.stringify({ error: "Invalid content_type. Allowed: PDF, images, DOCX, XLSX" }),
        { status: 400, headers: { ...reqCorsHeaders, "Content-Type": "application/json" } }
      );
    }

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
