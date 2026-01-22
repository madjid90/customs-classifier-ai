import { SignJWT } from "https://deno.land/x/jose@v4.14.4/index.ts";
import { logger } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/jwt-auth.ts";
import { createServiceClient, getUserRole } from "../_shared/auth.ts";

/**
 * Refresh Token Edge Function
 * 
 * Refreshes an existing valid JWT token before it expires.
 * The old token must still be valid (not expired) to get a new one.
 */
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the current token
    const authResult = await authenticateRequest(req);
    
    if (!authResult.success) {
      return authResult.error;
    }

    const { user_id, phone, company_id } = authResult.auth;
    
    logger.info(`[refresh-token] Refreshing token for user: ${user_id}`);

    const supabase = createServiceClient();

    // Verify user still exists and get fresh data
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, user_id, company_id, phone")
      .eq("user_id", user_id)
      .single();

    if (profileError || !profile) {
      logger.warn(`[refresh-token] User profile not found: ${user_id}`);
      return new Response(
        JSON.stringify({ error: "Utilisateur non trouvé", code: "USER_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get fresh role from database
    const userRole = await getUserRole(user_id);

    // Generate new JWT token
    const jwtSecret = Deno.env.get("CUSTOM_JWT_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secretKey = new TextEncoder().encode(jwtSecret);
    
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const expiresAtTimestamp = Math.floor(expiresAt.getTime() / 1000);
    
    const token = await new SignJWT({
      sub: user_id,
      phone: profile.phone,
      company_id: profile.company_id,
      role: userRole,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(expiresAtTimestamp)
      .sign(secretKey);

    logger.info(`[refresh-token] Token refreshed for user: ${user_id}`);

    return new Response(
      JSON.stringify({
        token,
        expires_at: expiresAt.toISOString(),
        user: {
          id: user_id,
          company_id: profile.company_id,
          role: userRole,
          phone: profile.phone,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    logger.error(`[refresh-token] Unexpected error:`, error);
    return new Response(
      JSON.stringify({ error: "Erreur interne", code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
