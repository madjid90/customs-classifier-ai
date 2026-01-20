import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

// Type alias for deno_dom document
type HTMLDocument = ReturnType<DOMParser["parseFromString"]>;

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "CustomsClassifierBot/1.0";

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

interface QueueItem {
  url: string;
  depth: number;
}

// ============================================================================
// WEB SCRAPER CLASS
// ============================================================================

class WebScraper {
  private startUrl: string;
  private baseUrl: string;
  private config: ScrapeConfig;
  private visited: Set<string> = new Set();
  private queue: QueueItem[] = [];
  private pages: ScrapedPage[] = [];
  private errors: Array<{ url: string; error: string }> = [];
  private domainPattern: RegExp;

  constructor(startUrl: string, config: ScrapeConfig, baseUrl?: string) {
    this.startUrl = startUrl;
    this.config = config;
    
    // Determine base URL from start URL or explicit base
    const urlObj = new URL(startUrl);
    this.baseUrl = baseUrl || `${urlObj.protocol}//${urlObj.host}`;
    
    // Create domain pattern for URL validation
    this.domainPattern = new RegExp(`^${this.escapeRegex(this.baseUrl)}`);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Clean text by removing multiple whitespaces and trimming
   */
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim();
  }

  /**
   * Convert relative URL to absolute URL
   */
  private resolveUrl(href: string, base: string): string {
    try {
      // Handle various href formats
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) {
        return "";
      }
      
      const resolved = new URL(href, base);
      // Remove hash and normalize
      resolved.hash = "";
      return resolved.href;
    } catch {
      return "";
    }
  }

  /**
   * Check if URL is on the same domain and should be crawled
   */
  private isAllowedUrl(url: string): boolean {
    if (!url) return false;
    
    // Must be on the same domain
    if (!this.domainPattern.test(url)) {
      return false;
    }

    // Check against link pattern if provided
    if (this.config.link_pattern) {
      try {
        const pattern = new RegExp(this.config.link_pattern);
        if (!pattern.test(url)) {
          return false;
        }
      } catch {
        console.warn(`[WebScraper] Invalid link_pattern: ${this.config.link_pattern}`);
      }
    }

    return true;
  }

  /**
   * Extract a reference identifier from the URL path
   */
  private extractRefFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      // Remove leading/trailing slashes and file extensions
      let ref = path
        .replace(/^\/|\/$/g, "")
        .replace(/\.(html?|php|aspx?)$/i, "")
        .replace(/\//g, "_");
      
      // Add query params if relevant
      if (urlObj.search) {
        const params = new URLSearchParams(urlObj.search);
        const relevantParams = Array.from(params.entries())
          .filter(([key]) => !["utm_source", "utm_medium", "utm_campaign", "ref"].includes(key))
          .map(([key, val]) => `${key}=${val}`)
          .join("_");
        if (relevantParams) {
          ref += `_${relevantParams}`;
        }
      }
      
      return ref || "index";
    } catch {
      return "unknown";
    }
  }

  /**
   * Delay execution for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch and parse a single page
   */
  private async fetchPage(url: string): Promise<{ doc: HTMLDocument | null; html: string } | null> {
    try {
      const headers: HeadersInit = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
        ...this.config.headers,
      };

      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        console.log(`[WebScraper] Skipping non-HTML content: ${contentType}`);
        return null;
      }

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      
      return { doc, html };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.errors.push({ url, error: errMsg });
      console.error(`[WebScraper] Error fetching ${url}: ${errMsg}`);
      return null;
    }
  }

  /**
   * Extract content from a parsed document using configured selectors
   */
  private extractContent(doc: HTMLDocument, url: string): ScrapedPage | null {
    if (!doc) return null;
    
    const selectors = this.config.selectors || {};

    // Extract title
    let title = "";
    if (selectors.title) {
      const titleEl = doc.querySelector(selectors.title);
      title = titleEl?.textContent || "";
    }
    if (!title) {
      const titleEl = doc.querySelector("title");
      title = titleEl?.textContent || "";
    }
    title = this.cleanText(title);

    // Remove excluded elements first
    if (selectors.exclude) {
      for (const excludeSelector of selectors.exclude) {
        const excludeEls = doc.querySelectorAll(excludeSelector);
        for (const el of Array.from(excludeEls)) {
          (el as Element).remove();
        }
      }
    }

    // Extract content
    let content = "";
    if (selectors.content) {
      const contentEls = doc.querySelectorAll(selectors.content);
      content = Array.from(contentEls)
        .map(el => (el as Element).textContent || "")
        .join("\n\n");
    } else {
      // Default: try main, article, or body
      const mainEl = doc.querySelector("main") || 
                     doc.querySelector("article") || 
                     doc.querySelector(".content") ||
                     doc.querySelector("#content") ||
                     doc.body;
      content = mainEl?.textContent || "";
    }
    content = this.cleanText(content);

    // Check minimum content length
    const minLength = this.config.min_content_length || 100;
    if (content.length < minLength) {
      console.log(`[WebScraper] Content too short (${content.length} < ${minLength}): ${url}`);
      return null;
    }

    // Extract links
    const links: string[] = [];
    const linkSelector = selectors.links || "a[href]";
    const linkEls = doc.querySelectorAll(linkSelector);
    for (const linkEl of Array.from(linkEls)) {
      const href = (linkEl as Element).getAttribute("href");
      if (href) {
        const absoluteUrl = this.resolveUrl(href, url);
        if (absoluteUrl && this.isAllowedUrl(absoluteUrl)) {
          links.push(absoluteUrl);
        }
      }
    }

    return {
      url,
      title,
      content,
      ref: this.extractRefFromUrl(url),
      links,
      scraped_at: new Date().toISOString(),
      metadata: {
        content_length: content.length,
        links_count: links.length,
      },
    };
  }

  /**
   * Main scraping method - crawls the website starting from startUrl
   */
  async scrape(): Promise<{ pages: ScrapedPage[]; errors: Array<{ url: string; error: string }> }> {
    const maxPages = this.config.max_pages || 50;
    const maxDepth = this.config.max_depth || 3;
    const delayMs = this.config.delay_ms || 1000;
    const followLinks = this.config.follow_links !== false;

    // Initialize queue with start URL
    this.queue.push({ url: this.startUrl, depth: 0 });

    console.log(`[WebScraper] Starting scrape of ${this.startUrl}`);
    console.log(`[WebScraper] Config: maxPages=${maxPages}, maxDepth=${maxDepth}, delay=${delayMs}ms`);

    while (this.queue.length > 0 && this.pages.length < maxPages) {
      const item = this.queue.shift()!;
      const { url, depth } = item;

      // Skip if already visited
      if (this.visited.has(url)) {
        continue;
      }
      this.visited.add(url);

      console.log(`[WebScraper] Scraping (${this.pages.length + 1}/${maxPages}, depth=${depth}): ${url}`);

      // Fetch and parse page
      const result = await this.fetchPage(url);
      if (!result || !result.doc) {
        continue;
      }

      // Extract content
      const page = this.extractContent(result.doc, url);
      if (page) {
        this.pages.push(page);

        // Add discovered links to queue if following links is enabled
        if (followLinks && depth < maxDepth) {
          for (const link of page.links) {
            if (!this.visited.has(link) && !this.queue.some(q => q.url === link)) {
              this.queue.push({ url: link, depth: depth + 1 });
            }
          }
        }
      }

      // Respect delay between requests
      if (this.queue.length > 0 && delayMs > 0) {
        await this.delay(delayMs);
      }
    }

    console.log(`[WebScraper] Completed: ${this.pages.length} pages scraped, ${this.errors.length} errors`);

    return {
      pages: this.pages,
      errors: this.errors,
    };
  }
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
