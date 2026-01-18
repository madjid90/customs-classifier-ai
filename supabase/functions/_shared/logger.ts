/**
 * Conditional logger for Edge Functions
 * - debug only logs in non-production
 * - info/warn/error always log
 * - metric logs structured data for monitoring
 */

const IS_PRODUCTION = Deno.env.get("ENVIRONMENT") === "production";

export const logger = {
  debug: (...args: unknown[]) => {
    if (!IS_PRODUCTION) console.log("[DEBUG]", ...args);
  },
  info: (...args: unknown[]) => {
    console.log("[INFO]", ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn("[WARN]", ...args);
  },
  error: (...args: unknown[]) => {
    console.error("[ERROR]", ...args);
  },
  /**
   * Log structured metric for monitoring
   */
  metric: (name: string, value: number, tags?: Record<string, string>) => {
    console.log(JSON.stringify({
      type: "metric",
      name,
      value,
      tags,
      timestamp: new Date().toISOString(),
    }));
  },
};
