import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface DataSource {
  id: string;
  name: string;
  description: string | null;
  source_type: "website" | "api" | "rss" | "pdf_url" | "sitemap";
  url: string;
  base_url: string | null;
  kb_source: "omd" | "maroc" | "lois" | "dum";
  version_label: string;
  scrape_config: ScrapeConfig;
  schedule_cron: string | null;
  last_scrape_at: string | null;
  next_scrape_at: string | null;
  status: "active" | "paused" | "error" | "disabled";
  error_message: string | null;
  error_count: number;
  stats: {
    total_pages?: number;
    total_chunks?: number;
  };
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ScrapeConfig {
  // CSS selectors for content extraction
  selectors?: {
    title?: string;
    content?: string;
    links?: string;
    next_page?: string;
    exclude?: string[];
  };
  // Scraping limits
  max_pages?: number;
  max_depth?: number;
  delay_ms?: number;
  // Link following
  follow_links?: boolean;
  link_pattern?: string; // regex pattern for links to follow
  // Content processing
  min_content_length?: number;
  chunk_size?: number;
  chunk_overlap?: number;
  // Headers & auth
  headers?: Record<string, string>;
  // For API sources
  api_config?: {
    method?: string;
    body?: Record<string, unknown>;
    pagination_param?: string;
    data_path?: string;
  };
}

interface ScrapedPage {
  url: string;
  title: string;
  content: string;
  ref: string;
  links: string[];
  scraped_at: string;
  metadata?: Record<string, unknown>;
}

interface ScrapeResult {
  source_id: string;
  source_name: string;
  pages: ScrapedPage[];
  chunks_created: number;
  errors: Array<{ url: string; error: string }>;
  duration_ms: number;
  status: "success" | "partial" | "error";
}

interface RequestBody {
  source_id?: string;
  run_scheduled?: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return createResponse({ error: message }, status);
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify admin authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Missing authorization header", 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return errorResponse("Invalid or expired token", 401);
    }

    // Check if user is admin
    const { data: userRole, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !userRole) {
      return errorResponse("Admin access required", 403);
    }

    // Parse request body
    let body: RequestBody = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        // Empty body is OK for scheduled runs
      }
    }

    const { source_id, run_scheduled } = body;

    // Fetch data sources based on request type
    let sources: DataSource[] = [];

    if (source_id) {
      // Fetch specific source by ID
      const { data, error } = await supabase
        .from("data_sources")
        .select("*")
        .eq("id", source_id)
        .single();

      if (error || !data) {
        return errorResponse(`Source not found: ${source_id}`, 404);
      }

      sources = [data as DataSource];
    } else if (run_scheduled) {
      // Fetch all active sources that are due for scraping
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("data_sources")
        .select("*")
        .eq("status", "active")
        .not("schedule_cron", "is", null)
        .or(`next_scrape_at.is.null,next_scrape_at.lte.${now}`);

      if (error) {
        return errorResponse(`Failed to fetch scheduled sources: ${error.message}`, 500);
      }

      sources = (data || []) as DataSource[];
    } else {
      return errorResponse("Provide either source_id or run_scheduled=true", 400);
    }

    // Placeholder for scraping results
    const results: ScrapeResult[] = [];

    // TODO: Implement actual scraping logic for each source
    for (const source of sources) {
      console.log(`[auto-scraper] Would scrape source: ${source.name} (${source.url})`);
      
      // Placeholder result
      results.push({
        source_id: source.id,
        source_name: source.name,
        pages: [],
        chunks_created: 0,
        errors: [],
        duration_ms: 0,
        status: "success",
      });
    }

    return createResponse({
      success: true,
      sources_count: sources.length,
      sources: sources.map(s => ({ id: s.id, name: s.name, url: s.url, status: s.status })),
      results,
      message: "Scraping structure ready - logic not yet implemented",
    });

  } catch (error) {
    console.error("[auto-scraper] Error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
});
