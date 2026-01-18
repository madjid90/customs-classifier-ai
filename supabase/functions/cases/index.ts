import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================================================
// INPUT VALIDATION (Zod)
// ============================================================================

const CreateCaseSchema = z.object({
  product_name: z.string().min(3, "Le nom du produit doit contenir au moins 3 caractères").max(500, "Le nom du produit ne peut pas dépasser 500 caractères"),
  type_import_export: z.enum(["import", "export"], { errorMap: () => ({ message: "type_import_export doit être 'import' ou 'export'" }) }),
  origin_country: z.string().length(2, "Le code pays doit contenir exactement 2 caractères").toUpperCase(),
});

type CreateCaseRequest = z.infer<typeof CreateCaseSchema>;

interface ListCasesParams {
  limit?: number;
  offset?: number;
  status?: string;
  q?: string;
  created_by?: string;
  date_from?: string;
  date_to?: string;
}

// Extract user from JWT token
async function getUserFromToken(authHeader: string | null) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  
  // Create a client with the user's token to validate it
  const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return null;
  }

  return user;
}

// Get user profile with company_id
async function getUserProfile(userId: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) {
    console.error("Error fetching profile:", error);
    return null;
  }

  return profile;
}

// Get user role
async function getUserRole(userId: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const { data: role, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();

  if (error) {
    console.error("Error fetching role:", error);
    return "agent";
  }

  return role?.role || "agent";
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    const user = await getUserFromToken(authHeader);
    
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Non authentifié" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const profile = await getUserProfile(user.id);
    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Profil non trouvé" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userRole = await getUserRole(user.id);

    // Route: POST /cases - Create new case
    if (req.method === "POST" && pathParts.length === 1 && pathParts[0] === "cases") {
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
        console.error("Error creating case:", createError);
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

      console.log("Case created:", newCase.id);

      return new Response(
        JSON.stringify({
          id: newCase.id,
          status: newCase.status,
          created_at: newCase.created_at,
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: GET /cases - List cases
    if (req.method === "GET" && pathParts.length === 1 && pathParts[0] === "cases") {
      const params: ListCasesParams = {
        limit: parseInt(url.searchParams.get("limit") || "20"),
        offset: parseInt(url.searchParams.get("offset") || "0"),
        status: url.searchParams.get("status") || undefined,
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
        console.error("Error listing cases:", listError);
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

    // Route: GET /cases/:id - Get case detail
    if (req.method === "GET" && pathParts.length === 2 && pathParts[0] === "cases") {
      const caseId = pathParts[1];

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

    // Route: POST /cases/:id/validate - Validate case
    if (req.method === "POST" && pathParts.length === 3 && pathParts[0] === "cases" && pathParts[2] === "validate") {
      const caseId = pathParts[1];

      // Check permission (only manager or admin can validate)
      if (userRole !== "admin" && userRole !== "manager") {
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
        console.error("Error validating case:", updateError);
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

      console.log("Case validated:", caseId);

      return new Response(
        JSON.stringify({ success: true, message: "Dossier validé avec succès" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route not found
    return new Response(
      JSON.stringify({ error: "Route non trouvée" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Cases endpoint error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur serveur" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
