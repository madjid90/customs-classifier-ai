import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// CONDITIONAL LOGGER
// ============================================================================

const IS_PRODUCTION = Deno.env.get("ENVIRONMENT") === "production";

const logger = {
  debug: (...args: unknown[]) => {
    if (!IS_PRODUCTION) console.log("[DEBUG]", ...args);
  },
  info: (...args: unknown[]) => {
    console.log("[INFO]", ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn("[WARN]", ...args);
  },
  error: (...args: unknown[]) => {
    console.error("[ERROR]", ...args);
  },
  metric: (name: string, value: number, tags?: Record<string, string>) => {
    console.log(JSON.stringify({
      type: "metric",
      name,
      value,
      tags,
      timestamp: new Date().toISOString(),
    }));
  },
};

// Domaines autorisés pour CORS
const ALLOWED_ORIGINS = [
  "https://id-preview--0f81d8ea-a57f-480b-a034-90dd63cc6ea0.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

// Headers par défaut pour les fonctions helpers
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

// deno-lint-ignore no-explicit-any
type SupabaseClientAny = SupabaseClient<any, any, any>;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
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
      logger.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user has admin role
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (roleError || !roleData) {
      logger.warn("Admin check failed:", roleError);
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse URL path to determine action
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const action = pathParts.slice(1).join("/");
    
    logger.info(`Admin action: ${action}, Method: ${req.method}, User: ${user.id}`);

    // Route to appropriate handler
    if (action === "ingestion/list" && req.method === "GET") {
      return await handleIngestionList(supabase, url);
    }
    
    if (action === "ingestion/register" && req.method === "POST") {
      return await handleIngestionRegister(supabase, req, user.id);
    }
    
    if (action === "etl/run" && req.method === "POST") {
      return await handleEtlRun(supabase, req, user.id);
    }
    
    if (action.startsWith("ingestion/") && action.endsWith("/logs") && req.method === "GET") {
      const ingestionId = pathParts[2];
      return await handleIngestionLogs(supabase, ingestionId);
    }
    
    if (action.startsWith("ingestion/") && action.endsWith("/retry") && req.method === "POST") {
      const ingestionId = pathParts[2];
      return await handleIngestionRetry(supabase, ingestionId, user.id);
    }
    
    if (action.startsWith("ingestion/") && action.endsWith("/disable") && req.method === "POST") {
      const ingestionId = pathParts[2];
      return await handleIngestionDisable(supabase, ingestionId, user.id);
    }
    
    if (action === "kb/search" && req.method === "GET") {
      return await handleKbSearch(supabase, url);
    }

    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    logger.error("Admin error:", err);
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Handler: List ingestion files
async function handleIngestionList(supabase: SupabaseClientAny, url: URL) {
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const status = url.searchParams.get("status");
  const source = url.searchParams.get("source");

  let query = supabase
    .from("ingestion_files")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }
  if (source) {
    query = query.eq("source", source);
  }

  const { data, error, count } = await query;

  if (error) {
    logger.error("List ingestion error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to list ingestion files" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ data, total: count, limit, offset }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handler: Register new ingestion
async function handleIngestionRegister(
  supabase: SupabaseClientAny, 
  req: Request, 
  userId: string
) {
  const body = await req.json();
  const { source, version_label, file_url, filename } = body;

  if (!source || !version_label || !file_url) {
    return new Response(
      JSON.stringify({ error: "source, version_label, and file_url are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const allowedSources = ["DOUANE_TARIF", "RGC", "NOTES_EXPLICATIVES", "MANUAL"];
  if (!allowedSources.includes(source)) {
    return new Response(
      JSON.stringify({ error: `Invalid source. Allowed: ${allowedSources.join(", ")}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const finalFilename = filename || file_url.split("/").pop() || `ingestion-${Date.now()}`;

  const { data, error } = await supabase
    .from("ingestion_files")
    .insert({
      source,
      version_label,
      file_url,
      filename: finalFilename,
      status: "NEW",
      progress_percent: 0,
    })
    .select()
    .single();

  if (error) {
    logger.error("Register ingestion error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to register ingestion" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  logger.info(`Ingestion registered: ${data.id} by user ${userId}`);

  return new Response(
    JSON.stringify(data),
    { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handler: Run ETL
async function handleEtlRun(
  supabase: SupabaseClientAny, 
  req: Request,
  userId: string
) {
  const body = await req.json();
  const { ingestion_id } = body;

  if (!ingestion_id) {
    return new Response(
      JSON.stringify({ error: "ingestion_id is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: ingestion, error: fetchError } = await supabase
    .from("ingestion_files")
    .select("*")
    .eq("id", ingestion_id)
    .single();

  if (fetchError || !ingestion) {
    return new Response(
      JSON.stringify({ error: "Ingestion file not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (ingestion.status === "PROCESSING") {
    return new Response(
      JSON.stringify({ error: "ETL is already running for this ingestion" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { error: updateError } = await supabase
    .from("ingestion_files")
    .update({ 
      status: "PROCESSING", 
      progress_percent: 0,
      error_message: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", ingestion_id);

  if (updateError) {
    logger.error("Update status error:", updateError);
    return new Response(
      JSON.stringify({ error: "Failed to start ETL" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  await supabase.from("ingestion_logs").insert({
    ingestion_id,
    step: "EXTRACT",
    level: "INFO",
    message: `ETL started by admin ${userId}`,
  });

  logger.info(`ETL started for ingestion: ${ingestion_id} by user ${userId}`);

  return new Response(
    JSON.stringify({ 
      message: "ETL process started",
      ingestion_id,
      status: "PROCESSING"
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handler: Get ingestion logs
async function handleIngestionLogs(
  supabase: SupabaseClientAny, 
  ingestionId: string
) {
  if (!ingestionId) {
    return new Response(
      JSON.stringify({ error: "Ingestion ID required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data, error } = await supabase
    .from("ingestion_logs")
    .select("*")
    .eq("ingestion_id", ingestionId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("Get logs error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to get logs" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ data }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handler: Retry ingestion
async function handleIngestionRetry(
  supabase: SupabaseClientAny, 
  ingestionId: string,
  userId: string
) {
  if (!ingestionId) {
    return new Response(
      JSON.stringify({ error: "Ingestion ID required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: ingestion, error: fetchError } = await supabase
    .from("ingestion_files")
    .select("*")
    .eq("id", ingestionId)
    .single();

  if (fetchError || !ingestion) {
    return new Response(
      JSON.stringify({ error: "Ingestion file not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (ingestion.status !== "FAILED") {
    return new Response(
      JSON.stringify({ error: "Can only retry failed ingestions" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { error: updateError } = await supabase
    .from("ingestion_files")
    .update({ 
      status: "NEW", 
      progress_percent: 0,
      error_message: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", ingestionId);

  if (updateError) {
    logger.error("Retry error:", updateError);
    return new Response(
      JSON.stringify({ error: "Failed to retry ingestion" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  await supabase.from("ingestion_logs").insert({
    ingestion_id: ingestionId,
    step: "EXTRACT",
    level: "INFO",
    message: `Ingestion reset for retry by admin ${userId}`,
  });

  logger.info(`Ingestion retried: ${ingestionId} by user ${userId}`);

  return new Response(
    JSON.stringify({ 
      message: "Ingestion reset for retry",
      ingestion_id: ingestionId,
      status: "NEW"
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handler: Disable ingestion
async function handleIngestionDisable(
  supabase: SupabaseClientAny, 
  ingestionId: string,
  userId: string
) {
  if (!ingestionId) {
    return new Response(
      JSON.stringify({ error: "Ingestion ID required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: ingestion, error: fetchError } = await supabase
    .from("ingestion_files")
    .select("*")
    .eq("id", ingestionId)
    .single();

  if (fetchError || !ingestion) {
    return new Response(
      JSON.stringify({ error: "Ingestion file not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { error: updateError } = await supabase
    .from("ingestion_files")
    .update({ 
      status: "DISABLED",
      updated_at: new Date().toISOString()
    })
    .eq("id", ingestionId);

  if (updateError) {
    logger.error("Disable error:", updateError);
    return new Response(
      JSON.stringify({ error: "Failed to disable ingestion" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  await supabase.from("ingestion_logs").insert({
    ingestion_id: ingestionId,
    step: "LOAD",
    level: "WARN",
    message: `Ingestion disabled by admin ${userId}`,
  });

  logger.info(`Ingestion disabled: ${ingestionId} by user ${userId}`);

  return new Response(
    JSON.stringify({ 
      message: "Ingestion disabled",
      ingestion_id: ingestionId,
      status: "DISABLED"
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handler: Search KB chunks
async function handleKbSearch(supabase: SupabaseClientAny, url: URL) {
  const query = url.searchParams.get("q");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const source = url.searchParams.get("source");

  if (!query) {
    return new Response(
      JSON.stringify({ error: "Search query 'q' is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Use ilike search for simplicity
  let dbQuery = supabase
    .from("kb_chunks")
    .select("id, doc_id, ref, source, text, version_label, created_at")
    .ilike("text", `%${query}%`)
    .limit(limit);

  if (source) {
    dbQuery = dbQuery.eq("source", source);
  }

  const { data, error } = await dbQuery;

  if (error) {
    logger.error("KB search error:", error);
    return new Response(
      JSON.stringify({ error: "Search failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ data, query, total: data?.length || 0 }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
