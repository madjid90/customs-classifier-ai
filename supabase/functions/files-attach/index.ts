import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// Domaines autorisés pour CORS
const ALLOWED_ORIGINS = [
  "https://id-preview--0f81d8ea-a57f-480b-a034-90dd63cc6ea0.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  
  const isAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed) || 
    origin.endsWith(".lovable.app") || 
    origin.includes("localhost");
  
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
  };
}

// ============================================================================
// INPUT VALIDATION (Zod)
// ============================================================================

const AttachFileSchema = z.object({
  file_type: z.enum([
    "tech_sheet", "invoice", "packing_list", "certificate",
    "dum", "photo_product", "photo_label", "photo_plate", "other", "admin_ingestion"
  ], { errorMap: () => ({ message: "Type de fichier invalide" }) }),
  file_url: z.string().url("L'URL du fichier doit être valide"),
  filename: z.string().min(1, "Le nom du fichier est requis").max(255, "Le nom du fichier ne peut pas dépasser 255 caractères"),
  size_bytes: z.number().int().min(0).max(50_000_000, "La taille du fichier ne peut pas dépasser 50MB"),
});

type AttachFileRequest = z.infer<typeof AttachFileSchema>;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify JWT and get user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    console.log(`Attaching file to case: ${caseId} for user: ${user.id}`);

    // Get user's company
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("Profile error:", profileError);
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify case exists and belongs to user's company
    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("id, status, company_id")
      .eq("id", caseId)
      .eq("company_id", profile.company_id)
      .single();

    if (caseError || !caseData) {
      console.error("Case error:", caseError);
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
    
    const { file_type, file_url, filename, size_bytes } = validation.data;
    // Insert file record
    const { data: fileRecord, error: insertError } = await supabase
      .from("case_files")
      .insert({
        case_id: caseId,
        file_type,
        file_url,
        filename,
        size_bytes,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to attach file" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log audit entry
    await supabase.from("audit_logs").insert({
      case_id: caseId,
      user_id: user.id,
      user_phone: user.phone || "unknown",
      action: "FILE_UPLOADED",
      meta: {
        file_id: fileRecord.id,
        filename,
        file_type,
        size_bytes,
      },
    });

    console.log(`File attached successfully: ${fileRecord.id}`);

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
    console.error("Files attach error:", err);
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
