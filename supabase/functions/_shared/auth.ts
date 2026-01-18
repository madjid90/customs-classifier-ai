import { createClient, SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2";
import { logger } from "./logger.ts";
import { corsHeaders, getCorsHeaders } from "./cors.ts";

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

export interface AuthenticatedUser {
  user: User;
  profile: UserProfile;
  role: UserRole;
}

export type AuthResult = 
  | { success: true; data: AuthenticatedUser }
  | { success: false; error: Response };

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

function getSupabaseAnonKey(): string {
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!key) throw new Error("SUPABASE_ANON_KEY non configurée");
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

/**
 * Creates a Supabase client with the user's token for authenticated operations
 */
export function createUserClient(token: string): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// ============================================================================
// JWT / USER EXTRACTION
// ============================================================================

/**
 * Extracts and validates user from Authorization header
 * Returns null if token is invalid or missing
 */
export async function getUserFromToken(authHeader: string | null): Promise<User | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.debug("[auth] No valid Authorization header");
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = createUserClient(token);

  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      logger.warn("[auth] Token validation failed:", error?.message);
      return null;
    }
    return user;
  } catch (e) {
    logger.error("[auth] Error validating token:", e);
    return null;
  }
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
 * Complete authentication: validates token, fetches profile and role
 * Returns AuthResult with either authenticated user data or error response
 */
export async function authenticateRequest(
  req: Request,
  options: {
    requireProfile?: boolean;
    requireRole?: UserRole[];
  } = {}
): Promise<AuthResult> {
  const { requireProfile = true, requireRole } = options;
  const corsHeaders = getCorsHeaders(req);

  // Extract token
  const authHeader = req.headers.get("Authorization");
  const user = await getUserFromToken(authHeader);

  if (!user) {
    return {
      success: false,
      error: new Response(
        JSON.stringify({ error: "Non authentifié", code: "UNAUTHENTICATED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      ),
    };
  }

  // Get profile if required
  let profile: UserProfile | null = null;
  if (requireProfile) {
    profile = await getUserProfile(user.id);
    if (!profile) {
      return {
        success: false,
        error: new Response(
          JSON.stringify({ error: "Profil non trouvé", code: "PROFILE_NOT_FOUND" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        ),
      };
    }
  }

  // Get role
  const role = await getUserRole(user.id);

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

  logger.info(`[auth] User authenticated: ${user.id} (role: ${role})`);

  return {
    success: true,
    data: {
      user,
      profile: profile!,
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
