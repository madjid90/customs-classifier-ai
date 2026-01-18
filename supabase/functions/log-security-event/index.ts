import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { logger } from "../_shared/logger.ts";

interface SecurityEventPayload {
  event_type: string;
  user_id?: string | null;
  user_phone?: string | null;
  attempted_path: string;
  meta?: Record<string, unknown>;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest(req);
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", "METHOD_NOT_ALLOWED", 405, req);
  }

  try {
    const payload: SecurityEventPayload = await req.json();

    // Validate required fields
    if (!payload.event_type || !payload.attempted_path) {
      return errorResponse(
        "Missing required fields: event_type, attempted_path",
        "VALIDATION_ERROR",
        400,
        req
      );
    }

    // Extract client info from headers
    const userAgent = req.headers.get("user-agent") || null;
    const forwardedFor = req.headers.get("x-forwarded-for");
    const realIp = req.headers.get("x-real-ip");
    const ipAddress = forwardedFor?.split(",")[0]?.trim() || realIp || null;

    // Use service role to insert security log
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { error: insertError } = await supabaseAdmin
      .from("security_logs")
      .insert({
        event_type: payload.event_type,
        user_id: payload.user_id || null,
        user_phone: payload.user_phone || null,
        attempted_path: payload.attempted_path,
        ip_address: ipAddress,
        user_agent: userAgent,
        meta: payload.meta || {},
      });

    if (insertError) {
      logger.error("Failed to insert security log", { error: insertError.message });
      return errorResponse("Failed to log security event", "INSERT_ERROR", 500, req);
    }

    logger.info("Security event logged", {
      event_type: payload.event_type,
      attempted_path: payload.attempted_path,
    });

    return jsonResponse({ success: true }, 200, req);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Error in log-security-event", { error: error.message });
    return errorResponse("Internal server error", "INTERNAL_ERROR", 500, req);
  }
});
