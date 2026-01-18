import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logger } from "./logger.ts";
import { corsHeaders } from "./cors.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface RateLimitConfig {
  /** Endpoint identifier for rate limiting */
  endpoint: string;
  /** Time window in milliseconds (default: 1 hour) */
  windowMs?: number;
  /** Maximum requests per window for regular users */
  maxRequests: number;
  /** Maximum requests per window for admin users (optional, defaults to maxRequests * 2) */
  adminMaxRequests?: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of remaining requests in the current window */
  remaining: number;
  /** Timestamp when the rate limit resets */
  resetAt: Date;
  /** Current request count in this window */
  current: number;
  /** Maximum allowed requests */
  limit: number;
}

export interface RateLimitError {
  error: string;
  code: string;
  retryAfter: number;
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

export const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export const RATE_LIMIT_PRESETS = {
  /** Standard API endpoint - 100 requests/hour */
  standard: {
    maxRequests: 100,
    adminMaxRequests: 500,
    windowMs: DEFAULT_WINDOW_MS,
  },
  /** Classification endpoint - more restrictive */
  classify: {
    maxRequests: 50,
    adminMaxRequests: 200,
    windowMs: DEFAULT_WINDOW_MS,
  },
  /** OTP sending - very restrictive */
  otp: {
    maxRequests: 5,
    adminMaxRequests: 20,
    windowMs: DEFAULT_WINDOW_MS,
  },
  /** File uploads - moderate */
  upload: {
    maxRequests: 30,
    adminMaxRequests: 100,
    windowMs: DEFAULT_WINDOW_MS,
  },
  /** Admin operations - generous for admins */
  admin: {
    maxRequests: 200,
    adminMaxRequests: 1000,
    windowMs: DEFAULT_WINDOW_MS,
  },
} as const;

// ============================================================================
// RATE LIMIT CHECKER
// ============================================================================

/**
 * Check and update rate limit for a user on a specific endpoint
 * 
 * @param supabase - Supabase client with service role
 * @param userId - User ID to check
 * @param config - Rate limit configuration
 * @param isAdmin - Whether the user is an admin (higher limits)
 * @returns RateLimitResult with allowed status and metadata
 * 
 * @example
 * ```ts
 * const result = await checkRateLimit(supabase, userId, {
 *   endpoint: 'classify',
 *   ...RATE_LIMIT_PRESETS.classify
 * });
 * 
 * if (!result.allowed) {
 *   return rateLimitResponse(result);
 * }
 * ```
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  config: RateLimitConfig,
  isAdmin = false
): Promise<RateLimitResult> {
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = isAdmin 
    ? (config.adminMaxRequests ?? config.maxRequests * 2) 
    : config.maxRequests;
  
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);
  const resetAt = new Date(now.getTime() + windowMs);

  try {
    // Check existing rate limit record
    const { data: existing, error: fetchError } = await supabase
      .from("rate_limits")
      .select("id, request_count, window_start")
      .eq("user_id", userId)
      .eq("endpoint", config.endpoint)
      .gte("window_start", windowStart.toISOString())
      .order("window_start", { ascending: false })
      .limit(1)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      // PGRST116 = no rows found, which is fine
      logger.error(`[rate-limit] Error fetching rate limit:`, fetchError);
      // Allow request on error to avoid blocking users
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetAt,
        current: 1,
        limit: maxRequests,
      };
    }

    if (existing) {
      // Update existing record
      const newCount = existing.request_count + 1;
      const allowed = newCount <= maxRequests;

      if (allowed) {
        await supabase
          .from("rate_limits")
          .update({ request_count: newCount })
          .eq("id", existing.id);
      }

      const existingWindowStart = new Date(existing.window_start);
      const actualResetAt = new Date(existingWindowStart.getTime() + windowMs);

      return {
        allowed,
        remaining: Math.max(0, maxRequests - newCount),
        resetAt: actualResetAt,
        current: newCount,
        limit: maxRequests,
      };
    }

    // Create new rate limit record
    const { error: insertError } = await supabase
      .from("rate_limits")
      .insert({
        user_id: userId,
        endpoint: config.endpoint,
        request_count: 1,
        window_start: now.toISOString(),
      });

    if (insertError) {
      logger.error(`[rate-limit] Error creating rate limit:`, insertError);
    }

    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt,
      current: 1,
      limit: maxRequests,
    };
  } catch (error) {
    logger.error(`[rate-limit] Unexpected error:`, error);
    // Allow request on error
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt,
      current: 1,
      limit: maxRequests,
    };
  }
}

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

/**
 * Generate a 429 Too Many Requests response with proper headers
 */
export function rateLimitResponse(
  result: RateLimitResult,
  customCorsHeaders?: Record<string, string>
): Response {
  const headers = customCorsHeaders || corsHeaders;
  const retryAfter = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);

  return new Response(
    JSON.stringify({
      error: "Trop de requêtes. Veuillez réessayer plus tard.",
      code: "RATE_LIMITED",
      retryAfter,
      resetAt: result.resetAt.toISOString(),
    } as RateLimitError),
    {
      status: 429,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Retry-After": retryAfter.toString(),
        "X-RateLimit-Limit": result.limit.toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": result.resetAt.toISOString(),
      },
    }
  );
}

/**
 * Add rate limit headers to a successful response
 */
export function addRateLimitHeaders(
  response: Response,
  result: RateLimitResult
): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set("X-RateLimit-Limit", result.limit.toString());
  newHeaders.set("X-RateLimit-Remaining", result.remaining.toString());
  newHeaders.set("X-RateLimit-Reset", result.resetAt.toISOString());

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

// ============================================================================
// MIDDLEWARE HELPER
// ============================================================================

/**
 * Rate limit middleware that can be used in edge functions
 * Returns null if allowed, or a Response if rate limited
 * 
 * @example
 * ```ts
 * const rateLimited = await rateLimitMiddleware(supabase, userId, {
 *   endpoint: 'my-endpoint',
 *   ...RATE_LIMIT_PRESETS.standard
 * });
 * 
 * if (rateLimited) {
 *   return rateLimited;
 * }
 * 
 * // Continue with normal processing
 * ```
 */
export async function rateLimitMiddleware(
  supabase: SupabaseClient,
  userId: string,
  config: RateLimitConfig,
  isAdmin = false,
  customCorsHeaders?: Record<string, string>
): Promise<Response | null> {
  const result = await checkRateLimit(supabase, userId, config, isAdmin);

  if (!result.allowed) {
    logger.warn(
      `[rate-limit] Rate limit exceeded for user ${userId} on ${config.endpoint}: ${result.current}/${result.limit}`
    );
    return rateLimitResponse(result, customCorsHeaders);
  }

  logger.debug(
    `[rate-limit] Request allowed for user ${userId} on ${config.endpoint}: ${result.current}/${result.limit}`
  );

  return null;
}

// ============================================================================
// CLEANUP HELPER
// ============================================================================

/**
 * Clean up expired rate limit records
 * Should be called periodically (e.g., by a cron job)
 */
export async function cleanupExpiredRateLimits(
  supabase: SupabaseClient,
  maxAgeMs = 2 * 60 * 60 * 1000 // 2 hours by default
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

  const { data, error } = await supabase
    .from("rate_limits")
    .delete()
    .lt("window_start", cutoff)
    .select("id");

  if (error) {
    logger.error(`[rate-limit] Error cleaning up rate limits:`, error);
    return 0;
  }

  const deletedCount = data?.length ?? 0;
  if (deletedCount > 0) {
    logger.info(`[rate-limit] Cleaned up ${deletedCount} expired rate limit records`);
  }

  return deletedCount;
}
