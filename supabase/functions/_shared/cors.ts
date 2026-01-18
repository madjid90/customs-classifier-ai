/**
 * Shared CORS configuration for Edge Functions
 * Centralizes allowed origins and CORS headers
 */

// Allowed origins for CORS
export const ALLOWED_ORIGINS = [
  "https://id-preview--0f81d8ea-a57f-480b-a034-90dd63cc6ea0.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

// Default CORS headers
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/**
 * Get dynamic CORS headers based on request origin
 * Allows any *.lovable.app subdomain and localhost
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  
  const isAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed) || 
    origin.endsWith(".lovable.app") || 
    origin.includes("localhost");
  
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
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
