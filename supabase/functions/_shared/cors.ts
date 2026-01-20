/**
 * Shared CORS configuration for Edge Functions
 * Centralizes allowed origins and CORS headers
 * 
 * Security:
 * - In development: allows localhost origins
 * - In production: only allows explicitly listed domains
 */

// ============================================================================
// ENVIRONMENT DETECTION
// ============================================================================

const isDevelopment = Deno.env.get("ENVIRONMENT") === "development";

// ============================================================================
// ALLOWED ORIGINS CONFIGURATION
// ============================================================================

// Production origins - explicitly allowed domains
const PRODUCTION_ORIGINS = [
  "https://id-preview--0f81d8ea-a57f-480b-a034-90dd63cc6ea0.lovable.app",
  // Add additional production origins from environment variable
  ...(Deno.env.get("ALLOWED_ORIGINS")?.split(",").map(o => o.trim()).filter(Boolean) || []),
];

// Development origins - only used when ENVIRONMENT=development
const DEVELOPMENT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:8080",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
];

// Combined allowed origins based on environment
export const ALLOWED_ORIGINS = isDevelopment 
  ? [...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS]
  : PRODUCTION_ORIGINS;

// ============================================================================
// SECURITY HEADERS
// ============================================================================

/**
 * Security headers to protect against common web vulnerabilities:
 * - X-Content-Type-Options: Prevents MIME type sniffing
 * - X-Frame-Options: Prevents clickjacking attacks
 * - X-XSS-Protection: Enables browser XSS filtering
 * - Referrer-Policy: Controls referrer information sent with requests
 * - Content-Security-Policy: Restricts resource loading (API responses)
 */
export const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

// ============================================================================
// CORS HEADERS
// ============================================================================

// Default CORS headers (includes security headers)
export const corsHeaders: Record<string, string> = {
  ...securityHeaders,
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0] || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// ============================================================================
// ORIGIN VALIDATION
// ============================================================================

/**
 * Check if an origin is allowed
 * In development: allows localhost and lovable domains
 * In production: only allows explicitly listed origins and *.lovable.app subdomains
 */
function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;

  // Always allow explicitly listed origins
  if (ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }

  // Allow *.lovable.app and *.lovableproject.com subdomains (for Lovable platform)
  if (origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com")) {
    return true;
  }

  // In development mode only: allow localhost origins
  if (isDevelopment) {
    try {
      const url = new URL(origin);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        return true;
      }
    } catch {
      // Invalid URL, not allowed
    }
  }

  return false;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get dynamic CORS headers based on request origin
 * Only allows origins that pass the security check
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  
  const isAllowed = isOriginAllowed(origin);
  
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0] || "",
  };
}

/**
 * Handle CORS preflight OPTIONS request
 * Returns a Response with appropriate CORS headers
 */
export function handleCorsPreflightRequest(req: Request): Response {
  return new Response(null, { headers: getCorsHeaders(req) });
}

/**
 * Create a JSON response with CORS headers
 */
export function jsonResponse(
  data: unknown, 
  status: number = 200, 
  req?: Request
): Response {
  const headers = req ? getCorsHeaders(req) : corsHeaders;
  return new Response(
    JSON.stringify(data),
    { 
      status, 
      headers: { ...headers, "Content-Type": "application/json" } 
    }
  );
}

/**
 * Create an error response with CORS headers
 */
export function errorResponse(
  message: string, 
  code: string, 
  status: number = 400, 
  req?: Request
): Response {
  return jsonResponse({ message, code }, status, req);
}
