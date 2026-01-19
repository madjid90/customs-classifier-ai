import { jwtVerify } from "https://deno.land/x/jose@v4.14.4/index.ts";
import { logger } from "./logger.ts";
import { corsHeaders, getCorsHeaders } from "./cors.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface JwtPayload {
  sub: string;          // user_id
  phone: string;
  company_id: string;
  role: "admin" | "manager" | "agent";
  iat: number;
  exp: number;
}

export type UserRole = "admin" | "manager" | "agent";

export interface AuthContext {
  user_id: string;
  phone: string;
  company_id: string;
  role: UserRole;
}

export type AuthResult = 
  | { success: true; auth: AuthContext }
  | { success: false; error: Response };

// ============================================================================
// JWT VALIDATION
// ============================================================================

/**
 * Validates the custom JWT token from Authorization header
 * Returns the decoded payload if valid
 */
export async function validateCustomJwt(authHeader: string | null): Promise<JwtPayload | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.debug("[jwt-auth] No valid Authorization header");
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const jwtSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!jwtSecret) {
    logger.error("[jwt-auth] SUPABASE_SERVICE_ROLE_KEY not configured");
    return null;
  }

  try {
    const secretKey = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secretKey);
    
    // Validate required fields
    if (!payload.sub || !payload.phone || !payload.company_id) {
      logger.warn("[jwt-auth] JWT missing required fields");
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
    logger.warn("[jwt-auth] JWT validation failed:", error);
    return null;
  }
}

// ============================================================================
// REQUEST AUTHENTICATION
// ============================================================================

/**
 * Authenticates a request using the custom JWT token
 * Returns AuthResult with either auth context or error response
 */
export async function authenticateRequest(
  req: Request,
  options: {
    requireRole?: UserRole[];
  } = {}
): Promise<AuthResult> {
  const { requireRole } = options;
  const headers = getCorsHeaders(req);

  const authHeader = req.headers.get("Authorization");
  const payload = await validateCustomJwt(authHeader);

  if (!payload) {
    return {
      success: false,
      error: new Response(
        JSON.stringify({ error: "Non authentifié", code: "UNAUTHENTICATED" }),
        { status: 401, headers: { ...headers, "Content-Type": "application/json" } }
      ),
    };
  }

  // Check role if required
  if (requireRole && !requireRole.includes(payload.role)) {
    logger.warn(`[jwt-auth] Role check failed: user has ${payload.role}, needs ${requireRole.join(" or ")}`);
    return {
      success: false,
      error: new Response(
        JSON.stringify({ 
          error: "Accès non autorisé", 
          code: "FORBIDDEN",
          required_role: requireRole,
        }),
        { status: 403, headers: { ...headers, "Content-Type": "application/json" } }
      ),
    };
  }

  logger.info(`[jwt-auth] User authenticated: ${payload.sub} (role: ${payload.role})`);

  return {
    success: true,
    auth: {
      user_id: payload.sub,
      phone: payload.phone,
      company_id: payload.company_id,
      role: payload.role,
    },
  };
}

// ============================================================================
// ROLE CHECK HELPERS
// ============================================================================

export function isAdmin(role: UserRole): boolean {
  return role === "admin";
}

export function isManagerOrAbove(role: UserRole): boolean {
  return role === "admin" || role === "manager";
}

// ============================================================================
// ERROR RESPONSES
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
