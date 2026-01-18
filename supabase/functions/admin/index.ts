import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logger } from "../_shared/logger.ts";
import { corsHeaders, getCorsHeaders } from "../_shared/cors.ts";
import { 
  authenticateRequest, 
  createServiceClient
} from "../_shared/auth.ts";
import {
  validateQueryParams,
  validateRequestBody,
  validatePathParam,
  IngestionListQuerySchema,
  IngestionRegisterSchema,
  EtlRunSchema,
  KBSearchQuerySchema,
  UUIDSchema,
} from "../_shared/validation.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClientAny = SupabaseClient<any, any, any>;

Deno.serve(async (req) => {
  const reqCorsHeaders = getCorsHeaders(req);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: reqCorsHeaders });
  }

  try {
    // Authenticate user with admin role requirement using centralized auth
    const authResult = await authenticateRequest(req, { requireRole: ["admin"] });
    if (!authResult.success) {
      return authResult.error;
    }
    
    const { user } = authResult.data;
    const supabase = createServiceClient();

    // Parse URL path to determine action
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const action = pathParts.slice(1).join("/");
    
    logger.info(`Admin action: ${action}, Method: ${req.method}, User: ${user.id}`);

    // Route to appropriate handler
    if (action === "ingestion/list" && req.method === "GET") {
      return await handleIngestionList(supabase, url, reqCorsHeaders);
    }
    
    if (action === "ingestion/register" && req.method === "POST") {
      return await handleIngestionRegister(supabase, req, user.id, reqCorsHeaders);
    }
    
    if (action === "etl/run" && req.method === "POST") {
      return await handleEtlRun(supabase, req, user.id, reqCorsHeaders);
    }
    
    if (action.startsWith("ingestion/") && action.endsWith("/logs") && req.method === "GET") {
      const ingestionId = pathParts[2];
      return await handleIngestionLogs(supabase, ingestionId, reqCorsHeaders);
    }
    
    if (action.startsWith("ingestion/") && action.endsWith("/retry") && req.method === "POST") {
      const ingestionId = pathParts[2];
      return await handleIngestionRetry(supabase, ingestionId, user.id, reqCorsHeaders);
    }
    
    if (action.startsWith("ingestion/") && action.endsWith("/disable") && req.method === "POST") {
      const ingestionId = pathParts[2];
      return await handleIngestionDisable(supabase, ingestionId, user.id, reqCorsHeaders);
    }
    
    if (action === "kb/search" && req.method === "GET") {
      return await handleKbSearch(supabase, url, reqCorsHeaders);
    }

    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { ...reqCorsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    logger.error("Admin error:", err);
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});

// Handler: List ingestion files
async function handleIngestionList(
  supabase: SupabaseClientAny, 
  url: URL,
  headers: Record<string, string>
) {
  // Validate query params with Zod
  const validation = validateQueryParams(url, IngestionListQuerySchema, headers);
  if (!validation.success) {
    return validation.error;
  }
  
  const { limit, offset, status, source } = validation.data;

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
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ data, total: count, limit, offset }),
    { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
  );
}

// Handler: Register new ingestion
async function handleIngestionRegister(
  supabase: SupabaseClientAny, 
  req: Request, 
  userId: string,
  headers: Record<string, string>
) {
  // Validate request body with Zod
  const validation = await validateRequestBody(req, IngestionRegisterSchema, headers);
  if (!validation.success) {
    return validation.error;
  }

  const { source, version_label, file_url, filename } = validation.data;
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
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  logger.info(`Ingestion registered: ${data.id} by user ${userId}`);

  return new Response(
    JSON.stringify(data),
    { status: 201, headers: { ...headers, "Content-Type": "application/json" } }
  );
}

// Handler: Run ETL
async function handleEtlRun(
  supabase: SupabaseClientAny, 
  req: Request,
  userId: string,
  headers: Record<string, string>
) {
  // Validate request body with Zod
  const validation = await validateRequestBody(req, EtlRunSchema, headers);
  if (!validation.success) {
    return validation.error;
  }

  const { ingestion_id } = validation.data;

  const { data: ingestion, error: fetchError } = await supabase
    .from("ingestion_files")
    .select("*")
    .eq("id", ingestion_id)
    .single();

  if (fetchError || !ingestion) {
    return new Response(
      JSON.stringify({ error: "Ingestion file not found" }),
      { status: 404, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  if (ingestion.status === "PROCESSING") {
    return new Response(
      JSON.stringify({ error: "ETL is already running for this ingestion" }),
      { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
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
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  await supabase.from("ingestion_logs").insert({
    ingestion_id,
    step: "extract",
    level: "info",
    message: `ETL started by admin ${userId}`,
  });

  logger.info(`ETL started for ingestion: ${ingestion_id} by user ${userId}`);

  return new Response(
    JSON.stringify({ 
      message: "ETL process started",
      ingestion_id,
      status: "PROCESSING"
    }),
    { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
  );
}

// Handler: Get ingestion logs
async function handleIngestionLogs(
  supabase: SupabaseClientAny, 
  ingestionId: string,
  headers: Record<string, string>
) {
  // Validate path param with Zod
  const validation = validatePathParam(ingestionId, "ingestion_id", UUIDSchema, headers);
  if (!validation.success) {
    return validation.error;
  }

  const { data, error } = await supabase
    .from("ingestion_logs")
    .select("*")
    .eq("ingestion_id", validation.data)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("Get logs error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to get logs" }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ data }),
    { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
  );
}

// Handler: Retry ingestion
async function handleIngestionRetry(
  supabase: SupabaseClientAny, 
  ingestionId: string,
  userId: string,
  headers: Record<string, string>
) {
  // Validate path param with Zod
  const validation = validatePathParam(ingestionId, "ingestion_id", UUIDSchema, headers);
  if (!validation.success) {
    return validation.error;
  }

  const validId = validation.data;

  const { data: ingestion, error: fetchError } = await supabase
    .from("ingestion_files")
    .select("*")
    .eq("id", validId)
    .single();

  if (fetchError || !ingestion) {
    return new Response(
      JSON.stringify({ error: "Ingestion file not found" }),
      { status: 404, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  if (ingestion.status !== "ERROR") {
    return new Response(
      JSON.stringify({ error: "Can only retry failed ingestions" }),
      { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
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
    .eq("id", validId);

  if (updateError) {
    logger.error("Retry error:", updateError);
    return new Response(
      JSON.stringify({ error: "Failed to retry ingestion" }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  await supabase.from("ingestion_logs").insert({
    ingestion_id: validId,
    step: "extract",
    level: "info",
    message: `Ingestion reset for retry by admin ${userId}`,
  });

  logger.info(`Ingestion retried: ${validId} by user ${userId}`);

  return new Response(
    JSON.stringify({ 
      message: "Ingestion reset for retry",
      ingestion_id: validId,
      status: "NEW"
    }),
    { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
  );
}

// Handler: Disable ingestion
async function handleIngestionDisable(
  supabase: SupabaseClientAny, 
  ingestionId: string,
  userId: string,
  headers: Record<string, string>
) {
  // Validate path param with Zod
  const validation = validatePathParam(ingestionId, "ingestion_id", UUIDSchema, headers);
  if (!validation.success) {
    return validation.error;
  }

  const validId = validation.data;

  const { data: ingestion, error: fetchError } = await supabase
    .from("ingestion_files")
    .select("*")
    .eq("id", validId)
    .single();

  if (fetchError || !ingestion) {
    return new Response(
      JSON.stringify({ error: "Ingestion file not found" }),
      { status: 404, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  const { error: updateError } = await supabase
    .from("ingestion_files")
    .update({ 
      status: "DISABLED",
      updated_at: new Date().toISOString()
    })
    .eq("id", validId);

  if (updateError) {
    logger.error("Disable error:", updateError);
    return new Response(
      JSON.stringify({ error: "Failed to disable ingestion" }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  await supabase.from("ingestion_logs").insert({
    ingestion_id: validId,
    step: "index",
    level: "warning",
    message: `Ingestion disabled by admin ${userId}`,
  });

  logger.info(`Ingestion disabled: ${validId} by user ${userId}`);

  return new Response(
    JSON.stringify({ 
      message: "Ingestion disabled",
      ingestion_id: validId,
      status: "DISABLED"
    }),
    { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
  );
}

// Handler: Search KB chunks
async function handleKbSearch(
  supabase: SupabaseClientAny, 
  url: URL,
  headers: Record<string, string>
) {
  // Validate query params with Zod
  const validation = validateQueryParams(url, KBSearchQuerySchema, headers);
  if (!validation.success) {
    return validation.error;
  }

  const { q, limit, source } = validation.data;

  // Use ilike search for simplicity
  let dbQuery = supabase
    .from("kb_chunks")
    .select("id, doc_id, ref, source, text, version_label, created_at")
    .ilike("text", `%${q}%`)
    .limit(limit);

  if (source) {
    dbQuery = dbQuery.eq("source", source);
  }

  const { data, error } = await dbQuery;

  if (error) {
    logger.error("KB search error:", error);
    return new Response(
      JSON.stringify({ error: "Search failed" }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ data, query: q, total: data?.length || 0 }),
    { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
  );
}
