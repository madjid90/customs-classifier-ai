import { logger } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { authenticateRequest, createServiceClient } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authResult = await authenticateRequest(req);
    if (!authResult.success) {
      return authResult.error;
    }
    
    const { profile } = authResult.data;
    const supabase = createServiceClient();

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    let body: { case_id?: string; file_id?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { case_id, file_id } = body;

    if (!case_id || !file_id) {
      return new Response(
        JSON.stringify({ error: "case_id and file_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logger.info(`[files-read-url] Getting read URL for file ${file_id} in case ${case_id}`);

    // First verify the case belongs to user's company
    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("id, company_id")
      .eq("id", case_id)
      .eq("company_id", profile.company_id)
      .single();

    if (caseError || !caseData) {
      logger.warn(`[files-read-url] Case not found or access denied: ${case_id}`);
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the file record
    const { data: fileData, error: fileError } = await supabase
      .from("case_files")
      .select("id, case_id, file_url, filename, storage_path")
      .eq("id", file_id)
      .eq("case_id", case_id)
      .single();

    if (fileError || !fileData) {
      logger.warn(`[files-read-url] File not found: ${file_id}`);
      return new Response(
        JSON.stringify({ error: "File not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine the storage path
    const storagePath = fileData.storage_path;
    
    if (!storagePath) {
      // If no storage_path, try to extract from file_url or return the existing URL
      logger.info(`[files-read-url] No storage_path, returning existing file_url`);
      return new Response(
        JSON.stringify({ 
          url: fileData.file_url, 
          expires_in: 0,
          note: "Using cached URL - may be expired" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a fresh signed URL (10 minutes validity)
    const expiresIn = 60 * 10;
    const { data: signedData, error: signedError } = await supabase.storage
      .from("case-files")
      .createSignedUrl(storagePath, expiresIn);

    if (signedError || !signedData?.signedUrl) {
      logger.error(`[files-read-url] Failed to create signed URL:`, signedError);
      return new Response(
        JSON.stringify({ error: "Failed to generate download URL" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logger.info(`[files-read-url] Generated signed URL for file ${file_id}`);

    return new Response(
      JSON.stringify({
        url: signedData.signedUrl,
        expires_in: expiresIn,
        filename: fileData.filename,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    logger.error("[files-read-url] Error:", err);
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
