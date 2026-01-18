import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type SecurityEventType = "unauthorized_access" | "forbidden_access" | "session_expired" | "invalid_token";

interface SecurityLogData {
  eventType: SecurityEventType;
  attemptedPath: string;
  meta?: Record<string, unknown>;
}

/**
 * Hook for logging security events like unauthorized access attempts.
 * Logs are stored in the security_logs table and viewable only by admins.
 */
export function useSecurityLog() {
  const { user } = useAuth();

  const logSecurityEvent = useCallback(async (data: SecurityLogData) => {
    try {
      const { error } = await supabase.functions.invoke("log-security-event", {
        body: {
          event_type: data.eventType,
          user_id: user?.id || null,
          user_phone: user?.phone || null,
          attempted_path: data.attemptedPath,
          meta: data.meta || {},
        },
      });

      if (error) {
        console.error("[SecurityLog] Failed to log event:", error.message);
      }
    } catch (err) {
      // Silently fail - security logging should not break the app
      console.error("[SecurityLog] Error:", err);
    }
  }, [user]);

  const logUnauthorizedAccess = useCallback((path: string, reason?: string) => {
    return logSecurityEvent({
      eventType: "unauthorized_access",
      attemptedPath: path,
      meta: { reason: reason || "not_authenticated" },
    });
  }, [logSecurityEvent]);

  const logForbiddenAccess = useCallback((path: string, requiredRoles?: string[]) => {
    return logSecurityEvent({
      eventType: "forbidden_access",
      attemptedPath: path,
      meta: { required_roles: requiredRoles },
    });
  }, [logSecurityEvent]);

  return {
    logSecurityEvent,
    logUnauthorizedAccess,
    logForbiddenAccess,
  };
}
