import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PresignRequest {
  case_id: string | null;
  file_type: string;
  filename: string;
  content_type: string;
}

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

    const body: PresignRequest = await req.json();
    const { case_id, file_type, filename, content_type } = body;

    // Validate required fields
    if (!file_type || !filename || !content_type) {
      return new Response(
        JSON.stringify({ error: "file_type, filename, and content_type are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate file type
    const allowedFileTypes = ["facture", "fiche_technique", "certificat", "photo", "autre"];
    if (!allowedFileTypes.includes(file_type)) {
      return new Response(
        JSON.stringify({ error: `Invalid file_type. Allowed: ${allowedFileTypes.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate unique file path
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = case_id 
      ? `${case_id}/${file_type}/${timestamp}-${randomId}-${sanitizedFilename}`
      : `temp/${user.id}/${file_type}/${timestamp}-${randomId}-${sanitizedFilename}`;

    console.log(`Generating presigned URL for: ${filePath}`);

    // Create signed upload URL (valid for 1 hour)
    const { data: signedData, error: signedError } = await supabase.storage
      .from("case-files")
      .createSignedUploadUrl(filePath);

    if (signedError) {
      console.error("Error creating signed URL:", signedError);
      return new Response(
        JSON.stringify({ error: "Failed to generate upload URL" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    console.log(`Presigned URL generated successfully for user ${user.id}`);

    return new Response(
      JSON.stringify({
        upload_url: signedData.signedUrl,
        file_url: signedReadData?.signedUrl || publicUrlData.publicUrl,
        file_path: filePath,
        token: signedData.token,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (err) {
    console.error("Presign error:", err);
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
