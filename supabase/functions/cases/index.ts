import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { logger } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { 
  authenticateRequest, 
  createServiceClient,
  isManagerOrAbove,
  type UserProfile,
  type UserRole
} from "../_shared/auth.ts";
import {
  CreateCaseSchema,
  UUIDSchema,
  PaginationSchema,
  CaseStatusSchema,
  SafeStringSchema,
  validateRequestBody,
  validatePathParam,
  type ValidationResult,
} from "../_shared/validation.ts";

// ============================================================================
// ADDITIONAL SCHEMAS (specific to cases)
// ============================================================================

const ListCasesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: CaseStatusSchema.optional(),
  q: SafeStringSchema(200).optional(),
  created_by: UUIDSchema.optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
});

type CreateCaseRequest = z.infer<typeof CreateCaseSchema>;
type ListCasesQuery = z.infer<typeof ListCasesQuerySchema>;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    
    // Authenticate user using centralized auth
    const authResult = await authenticateRequest(req);
    if (!authResult.success) {
      return authResult.error;
    }
    
    const { user, profile, role } = authResult.data;
    const supabase = createServiceClient();

    // Route: POST /cases - Create new case
    if (req.method === "POST" && pathParts.length === 1 && pathParts[0] === "cases") {
      return await handleCreateCase(req, supabase, user, profile, corsHeaders);
    }

    // Route: GET /cases - List cases
    if (req.method === "GET" && pathParts.length === 1 && pathParts[0] === "cases") {
      return await handleListCases(url, supabase, profile, corsHeaders);
    }

    // Route: GET /cases/:id - Get case detail
    if (req.method === "GET" && pathParts.length === 2 && pathParts[0] === "cases") {
      const caseId = pathParts[1];
      return await handleGetCase(caseId, supabase, profile, corsHeaders);
    }

    // Route: POST /cases/:id/validate - Validate case
    if (req.method === "POST" && pathParts.length === 3 && pathParts[0] === "cases" && pathParts[2] === "validate") {
      const caseId = pathParts[1];
      return await handleValidateCase(caseId, supabase, user, profile, role, corsHeaders);
    }

    // Route: DELETE /cases/:id - Delete case
    if (req.method === "DELETE" && pathParts.length === 2 && pathParts[0] === "cases") {
      const caseId = pathParts[1];
      return await handleDeleteCase(caseId, supabase, user, profile, corsHeaders);
    }

    // Route not found
    return new Response(
      JSON.stringify({ error: "Route non trouvée" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    logger.error("Cases endpoint error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur serveur" }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});

// ============================================================================
// HANDLERS
// ============================================================================

async function handleCreateCase(
  req: Request,
  supabase: ReturnType<typeof createServiceClient>,
  user: { id: string },
  profile: UserProfile,
  corsHeaders: Record<string, string>
) {
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
  
  const validation = CreateCaseSchema.safeParse(rawBody);
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
  
  const body: CreateCaseRequest = validation.data;

  // Create case
  const { data: newCase, error: createError } = await supabase
    .from("cases")
    .insert({
      company_id: profile.company_id,
      created_by: user.id,
      type_import_export: body.type_import_export,
      origin_country: body.origin_country,
      product_name: body.product_name,
      status: "IN_PROGRESS",
    })
    .select()
    .single();

  if (createError) {
    logger.error("Error creating case:", createError);
    return new Response(
      JSON.stringify({ error: "Impossible de créer le dossier" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Log audit
  await supabase.from("audit_logs").insert({
    case_id: newCase.id,
    action: "created",
    user_id: user.id,
    user_phone: profile.phone,
    meta: { product_name: body.product_name },
  });

  logger.info("Case created:", newCase.id);

  return new Response(
    JSON.stringify({
      id: newCase.id,
      status: newCase.status,
      created_at: newCase.created_at,
    }),
    { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleListCases(
  url: URL,
  supabase: ReturnType<typeof createServiceClient>,
  profile: UserProfile,
  corsHeaders: Record<string, string>
) {
  const params: ListCasesQuery = {
    limit: parseInt(url.searchParams.get("limit") || "20"),
    offset: parseInt(url.searchParams.get("offset") || "0"),
    status: url.searchParams.get("status") as ListCasesQuery["status"] || undefined,
    q: url.searchParams.get("q") || undefined,
    created_by: url.searchParams.get("created_by") || undefined,
    date_from: url.searchParams.get("date_from") || undefined,
    date_to: url.searchParams.get("date_to") || undefined,
  };

  let query = supabase
    .from("cases")
    .select("*", { count: "exact" })
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false });

  // Apply filters
  if (params.status) {
    query = query.eq("status", params.status);
  }
  if (params.q) {
    query = query.ilike("product_name", `%${params.q}%`);
  }
  if (params.created_by) {
    query = query.eq("created_by", params.created_by);
  }
  if (params.date_from) {
    query = query.gte("created_at", params.date_from);
  }
  if (params.date_to) {
    query = query.lte("created_at", params.date_to);
  }

  // Apply pagination
  query = query.range(params.offset!, params.offset! + params.limit! - 1);

  const { data: cases, count, error: listError } = await query;

  if (listError) {
    logger.error("Error listing cases:", listError);
    return new Response(
      JSON.stringify({ error: "Erreur lors de la récupération des dossiers" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      items: cases || [],
      total: count || 0,
      limit: params.limit,
      offset: params.offset,
      has_more: (params.offset! + params.limit!) < (count || 0),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleGetCase(
  caseId: string,
  supabase: ReturnType<typeof createServiceClient>,
  profile: UserProfile,
  corsHeaders: Record<string, string>
) {
  // Get case
  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .eq("company_id", profile.company_id)
    .single();

  if (caseError || !caseData) {
    return new Response(
      JSON.stringify({ error: "Dossier non trouvé" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get files
  const { data: files } = await supabase
    .from("case_files")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  // Get last classification result
  const { data: results } = await supabase
    .from("classification_results")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(1);

  // Get audit logs
  const { data: audit } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  const lastResult = results && results.length > 0 ? results[0] : null;

  return new Response(
    JSON.stringify({
      case: caseData,
      files: files || [],
      last_result: lastResult ? {
        status: lastResult.status,
        recommended_code: lastResult.recommended_code,
        confidence: lastResult.confidence,
        confidence_level: lastResult.confidence_level,
        justification_short: lastResult.justification_short,
        alternatives: lastResult.alternatives,
        evidence: lastResult.evidence,
        next_question: lastResult.next_question,
        error_message: lastResult.error_message,
      } : null,
      audit: audit || [],
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleValidateCase(
  caseId: string,
  supabase: ReturnType<typeof createServiceClient>,
  user: { id: string },
  profile: UserProfile,
  role: UserRole,
  corsHeaders: Record<string, string>
) {
  // Check permission (only manager or admin can validate)
  if (!isManagerOrAbove(role)) {
    return new Response(
      JSON.stringify({ error: "Accès non autorisé. Seuls les managers et admins peuvent valider." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get case
  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .eq("company_id", profile.company_id)
    .single();

  if (caseError || !caseData) {
    return new Response(
      JSON.stringify({ error: "Dossier non trouvé" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (caseData.status === "VALIDATED") {
    return new Response(
      JSON.stringify({ error: "Le dossier est déjà validé" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (caseData.status !== "RESULT_READY") {
    return new Response(
      JSON.stringify({ error: "Le dossier doit avoir un résultat avant validation" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Update case status
  const { error: updateError } = await supabase
    .from("cases")
    .update({
      status: "VALIDATED",
      validated_by: user.id,
      validated_at: new Date().toISOString(),
    })
    .eq("id", caseId);

  if (updateError) {
    logger.error("Error validating case:", updateError);
    return new Response(
      JSON.stringify({ error: "Impossible de valider le dossier" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Log audit
  await supabase.from("audit_logs").insert({
    case_id: caseId,
    action: "validated",
    user_id: user.id,
    user_phone: profile.phone,
    meta: {},
  });

  logger.info("Case validated:", caseId);

  return new Response(
    JSON.stringify({ success: true, message: "Dossier validé avec succès" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleDeleteCase(
  caseId: string,
  supabase: ReturnType<typeof createServiceClient>,
  user: { id: string },
  profile: UserProfile,
  corsHeaders: Record<string, string>
) {
  // Get case and verify ownership
  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .eq("company_id", profile.company_id)
    .single();

  if (caseError || !caseData) {
    return new Response(
      JSON.stringify({ error: "Dossier non trouvé" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Only allow deletion by the creator or if the case is not yet validated
  if (caseData.created_by !== user.id && caseData.status === "VALIDATED") {
    return new Response(
      JSON.stringify({ error: "Impossible de supprimer un dossier validé par un autre utilisateur" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Delete related records in order (respecting foreign key constraints)
  // 1. Delete classification feedback
  await supabase
    .from("classification_feedback")
    .delete()
    .eq("case_id", caseId);

  // 2. Delete classification results
  await supabase
    .from("classification_results")
    .delete()
    .eq("case_id", caseId);

  // 3. Delete case files (also delete from storage)
  const { data: files } = await supabase
    .from("case_files")
    .select("storage_path")
    .eq("case_id", caseId);

  if (files && files.length > 0) {
    const storagePaths = files
      .map(f => f.storage_path)
      .filter((p): p is string => !!p);
    
    if (storagePaths.length > 0) {
      await supabase.storage
        .from("case-files")
        .remove(storagePaths);
    }
  }

  await supabase
    .from("case_files")
    .delete()
    .eq("case_id", caseId);

  // 4. Delete audit logs
  await supabase
    .from("audit_logs")
    .delete()
    .eq("case_id", caseId);

  // 5. Finally delete the case
  const { error: deleteError } = await supabase
    .from("cases")
    .delete()
    .eq("id", caseId);

  if (deleteError) {
    logger.error("Error deleting case:", deleteError);
    return new Response(
      JSON.stringify({ error: "Impossible de supprimer le dossier" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  logger.info("Case deleted:", caseId);

  return new Response(
    JSON.stringify({ success: true, message: "Dossier supprimé avec succès" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
