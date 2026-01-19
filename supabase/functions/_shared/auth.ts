import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtVerify } from "https://deno.land/x/jose@v4.14.4/index.ts";
import { logger } from "./logger.ts";
import { getCorsHeaders } from "./cors.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface UserProfile {
  id: string;
  user_id: string;
  company_id: string;
  phone: string;
  created_at: string;
}

export type UserRole = "admin" | "manager" | "agent";

// User object returned by getUserFromToken (for backward compatibility)
export interface User {
  id: string;
  phone?: string;
  company_id?: string;
  role?: UserRole;
}

export interface AuthenticatedUser {
  user: { id: string };
  profile: UserProfile;
  role: UserRole;
}

export type AuthResult = 
  | { success: true; data: AuthenticatedUser }
  | { success: false; error: Response };

// Custom JWT payload structure
interface CustomJwtPayload {
  sub: string;          // user_id
  phone: string;
  company_id: string;
  role: UserRole;
  iat: number;
  exp: number;
}

// ============================================================================
// ENVIRONMENT HELPERS
// ============================================================================

function getSupabaseUrl(): string {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("SUPABASE_URL non configurée");
  return url;
}

function getSupabaseServiceKey(): string {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY non configurée");
  return key;
}

// ============================================================================
// SUPABASE CLIENT FACTORY
// ============================================================================

/**
 * Creates a Supabase client with service role key for admin operations
 */
export function createServiceClient(): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseServiceKey());
}

// ============================================================================
// CUSTOM JWT VALIDATION
// ============================================================================

/**
 * Validates the custom JWT token from Authorization header
 * Returns the decoded payload if valid
 */
async function validateCustomJwt(authHeader: string | null): Promise<CustomJwtPayload | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.debug("[auth] No valid Authorization header");
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const jwtSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!jwtSecret) {
    logger.error("[auth] SUPABASE_SERVICE_ROLE_KEY not configured");
    return null;
  }

  try {
    const secretKey = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secretKey);
    
    // Validate required fields
    if (!payload.sub || !payload.phone || !payload.company_id) {
      logger.warn("[auth] JWT missing required fields");
      return null;
    }

    return {
      sub: payload.sub as string,
      phone: payload.phone as string,
      company_id: payload.company_id as string,
      role: (payload.role as UserRole) || "agent",
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch (error) {
    logger.warn("[auth] JWT validation failed:", error);
    return null;
  }
}

// ============================================================================
// GET USER FROM TOKEN (for backward compatibility)
// ============================================================================

/**
 * Extracts user from Authorization header (legacy function for backward compatibility)
 * Returns User object if token is valid, null otherwise
 */
export async function getUserFromToken(authHeader: string | null): Promise<User | null> {
  const payload = await validateCustomJwt(authHeader);
  
  if (!payload) {
    return null;
  }

  return {
    id: payload.sub,
    phone: payload.phone,
    company_id: payload.company_id,
    role: payload.role,
  };
}

// ============================================================================
// PROFILE RETRIEVAL
// ============================================================================

/**
 * Fetches user profile from profiles table
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const supabase = createServiceClient();
  
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) {
    logger.error("[auth] Error fetching profile:", error.message);
    return null;
  }

  return profile as UserProfile;
}

// ============================================================================
// ROLE RETRIEVAL
// ============================================================================

/**
 * Fetches user role from user_roles table
 * Defaults to "agent" if no role found
 */
export async function getUserRole(userId: string): Promise<UserRole> {
  const supabase = createServiceClient();
  
  const { data: roleData, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();

  if (error) {
    logger.debug("[auth] No role found for user, defaulting to agent");
    return "agent";
  }

  return (roleData?.role as UserRole) || "agent";
}

// ============================================================================
// FULL AUTHENTICATION FLOW
// ============================================================================

/**
 * Complete authentication: validates custom JWT token, builds profile from token claims
 * Returns AuthResult with either authenticated user data or error response
 */
export async function authenticateRequest(
  req: Request,
  options: {
    requireProfile?: boolean;
    requireRole?: UserRole[];
  } = {}
): Promise<AuthResult> {
  const { requireRole } = options;
  const corsHeaders = getCorsHeaders(req);

  // Extract and validate token
  const authHeader = req.headers.get("Authorization");
  const payload = await validateCustomJwt(authHeader);

  if (!payload) {
    return {
      success: false,
      error: new Response(
        JSON.stringify({ error: "Non authentifié", code: "UNAUTHENTICATED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      ),
    };
  }

  // Build profile from JWT claims (avoids DB lookup for every request)
  const profile: UserProfile = {
    id: payload.sub, // Using user_id as profile id for simplicity
    user_id: payload.sub,
    company_id: payload.company_id,
    phone: payload.phone,
    created_at: new Date().toISOString(), // Not critical for auth
  };

  const role = payload.role;

  // Check role permissions if required
  if (requireRole && !requireRole.includes(role)) {
    logger.warn(`[auth] Role check failed: user has ${role}, needs ${requireRole.join(" or ")}`);
    return {
      success: false,
      error: new Response(
        JSON.stringify({ 
          error: "Accès non autorisé", 
          code: "FORBIDDEN",
          required_role: requireRole,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      ),
    };
  }

  logger.info(`[auth] User authenticated: ${payload.sub} (role: ${role})`);

  return {
    success: true,
    data: {
      user: { id: payload.sub },
      profile,
      role,
    },
  };
}

// ============================================================================
// ROLE CHECK HELPERS
// ============================================================================

/**
 * Check if user has admin role
 */
export function isAdmin(role: UserRole): boolean {
  return role === "admin";
}

/**
 * Check if user has manager role or higher
 */
export function isManagerOrAbove(role: UserRole): boolean {
  return role === "admin" || role === "manager";
}

/**
 * Check if user can access specific company data
 */
export function canAccessCompany(profile: UserProfile, companyId: string): boolean {
  return profile.company_id === companyId;
}

// ============================================================================
// ERROR RESPONSE HELPERS
// ============================================================================

export function unauthorizedResponse(req: Request, message = "Non authentifié"): Response {
  return new Response(
    JSON.stringify({ error: message, code: "UNAUTHENTICATED" }),
    { status: 401, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
  );
}

export function forbiddenResponse(req: Request, message = "Accès non autorisé"): Response {
  return new Response(
    JSON.stringify({ error: message, code: "FORBIDDEN" }),
    { status: 403, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
  );
}

export function notFoundResponse(req: Request, message = "Ressource non trouvée"): Response {
  return new Response(
    JSON.stringify({ error: message, code: "NOT_FOUND" }),
    { status: 404, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
  );
}
