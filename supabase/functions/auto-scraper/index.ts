import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";
import { authenticateRequest, createServiceClient } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

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
  // Firecrawl for JavaScript-heavy sites
  use_firecrawl?: boolean;
  // PDF handling
  extract_pdfs?: boolean;
  pdf_link_pattern?: string; // regex pattern for PDF links (default: \.pdf$)
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
// FIRECRAWL SCRAPER CLASS
// ============================================================================

class FirecrawlScraper {
  private startUrl: string;
  private config: ScrapeConfig;
  private baseUrl: string;

  constructor(startUrl: string, config: ScrapeConfig, baseUrl?: string) {
    this.startUrl = startUrl;
    this.config = config;
    const urlObj = new URL(startUrl);
    this.baseUrl = baseUrl || `${urlObj.protocol}//${urlObj.host}`;
  }

  private extractRefFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      let ref = path
        .replace(/^\/|\/$/g, "")
        .replace(/\.(html?|php|aspx?|jsf?|pdf)$/i, "")
        .replace(/\//g, "_");
      return ref || "index";
    } catch {
      return "unknown";
    }
  }

  private isPdfUrl(url: string): boolean {
    const pdfPattern = this.config.pdf_link_pattern || "\\.pdf($|\\?)";
    try {
      return new RegExp(pdfPattern, "i").test(url);
    } catch {
      return url.toLowerCase().includes(".pdf");
    }
  }

  private async scrapePdf(pdfUrl: string): Promise<ScrapedPage | null> {
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) return null;

    console.log(`[FirecrawlScraper] Scraping PDF: ${pdfUrl}`);

    try {
      const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: pdfUrl,
          formats: ["markdown"],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[FirecrawlScraper] PDF scrape failed for ${pdfUrl}: ${errorText}`);
        return null;
      }

      const data = await response.json();
      const content = data.data?.markdown || data.markdown || "";

      if (content && content.length > 50) {
        // Extract filename from URL for title
        const urlObj = new URL(pdfUrl);
        const filename = urlObj.pathname.split("/").pop() || "document.pdf";
        const title = data.data?.metadata?.title || filename.replace(".pdf", "");

        return {
          url: pdfUrl,
          title: title,
          content: content,
          ref: this.extractRefFromUrl(pdfUrl),
          links: [],
          scraped_at: new Date().toISOString(),
          metadata: {
            ...data.data?.metadata,
            type: "pdf",
            filename: filename,
          },
        };
      }
    } catch (error) {
      console.error(`[FirecrawlScraper] Error scraping PDF ${pdfUrl}:`, error);
    }

    return null;
  }

  async scrape(): Promise<{ pages: ScrapedPage[]; errors: Array<{ url: string; error: string }> }> {
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      console.error("[FirecrawlScraper] FIRECRAWL_API_KEY not configured");
      return {
        pages: [],
        errors: [{ url: this.startUrl, error: "Firecrawl API key not configured" }],
      };
    }

    const maxPages = this.config.max_pages || 50;
    const maxDepth = this.config.max_depth || 3;
    const extractPdfs = this.config.extract_pdfs !== false; // Default to true
    const pages: ScrapedPage[] = [];
    const errors: Array<{ url: string; error: string }> = [];
    const discoveredPdfUrls: Set<string> = new Set();

    console.log(`[FirecrawlScraper] Starting crawl of ${this.startUrl} with Firecrawl`);
    console.log(`[FirecrawlScraper] PDF extraction: ${extractPdfs ? 'enabled' : 'disabled'}`);

    try {
      // First, use Map to discover all URLs on the site (including PDFs)
      console.log(`[FirecrawlScraper] Step 1: Mapping site to discover URLs...`);
      
      const mapResponse = await fetch("https://api.firecrawl.dev/v1/map", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: this.startUrl,
          limit: maxPages * 2, // Get more URLs to find PDFs
          includeSubdomains: false,
        }),
      });

      if (mapResponse.ok) {
        const mapData = await mapResponse.json();
        const allLinks = mapData.links || mapData.data?.links || [];
        
        console.log(`[FirecrawlScraper] Found ${allLinks.length} URLs on site`);

        // Filter PDF URLs
        if (extractPdfs) {
          for (const link of allLinks) {
            if (this.isPdfUrl(link)) {
              discoveredPdfUrls.add(link);
            }
          }
          console.log(`[FirecrawlScraper] Found ${discoveredPdfUrls.size} PDF files`);
        }
      } else {
        console.warn(`[FirecrawlScraper] Map request failed, continuing with crawl only`);
      }

      // Step 2: Crawl HTML pages
      console.log(`[FirecrawlScraper] Step 2: Crawling HTML pages...`);
      
      const crawlResponse = await fetch("https://api.firecrawl.dev/v1/crawl", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: this.startUrl,
          limit: maxPages,
          maxDepth: maxDepth,
          scrapeOptions: {
            formats: ["markdown", "links"],
            onlyMainContent: true,
          },
          includePaths: this.config.link_pattern ? [this.config.link_pattern] : undefined,
          excludePaths: extractPdfs ? undefined : ["*.pdf"], // Exclude PDFs from crawl if not extracting
        }),
      });

      if (!crawlResponse.ok) {
        const errorData = await crawlResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Firecrawl API error: ${crawlResponse.status}`);
      }

      const crawlData = await crawlResponse.json();
      
      // Poll for crawl completion
      if (crawlData.id) {
        console.log(`[FirecrawlScraper] Crawl job started: ${crawlData.id}`);
        
        const maxWait = 5 * 60 * 1000;
        const pollInterval = 5000;
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWait) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          
          const statusResponse = await fetch(`https://api.firecrawl.dev/v1/crawl/${crawlData.id}`, {
            headers: {
              "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
            },
          });
          
          if (!statusResponse.ok) {
            throw new Error(`Failed to check crawl status: ${statusResponse.status}`);
          }
          
          const statusData = await statusResponse.json();
          console.log(`[FirecrawlScraper] Crawl status: ${statusData.status}, completed: ${statusData.completed}/${statusData.total}`);
          
          if (statusData.status === "completed" || statusData.status === "failed") {
            if (statusData.data && Array.isArray(statusData.data)) {
              for (const page of statusData.data) {
                const pageUrl = page.metadata?.sourceURL || page.url || this.startUrl;
                
                // Collect PDF links from page content
                if (extractPdfs && page.links) {
                  for (const link of page.links) {
                    if (this.isPdfUrl(link)) {
                      discoveredPdfUrls.add(link);
                    }
                  }
                }
                
                // Skip PDF pages in HTML crawl (we'll handle them separately)
                if (this.isPdfUrl(pageUrl)) continue;
                
                pages.push({
                  url: pageUrl,
                  title: page.metadata?.title || page.title || "",
                  content: page.markdown || page.content || "",
                  ref: this.extractRefFromUrl(pageUrl),
                  links: page.links || [],
                  scraped_at: new Date().toISOString(),
                  metadata: page.metadata,
                });
              }
            }
            
            if (statusData.status === "failed") {
              errors.push({ url: this.startUrl, error: statusData.error || "Crawl failed" });
            }
            break;
          }
        }
      }

      // Step 3: Scrape discovered PDFs
      if (extractPdfs && discoveredPdfUrls.size > 0) {
        console.log(`[FirecrawlScraper] Step 3: Extracting ${discoveredPdfUrls.size} PDF files...`);
        
        const pdfUrls = Array.from(discoveredPdfUrls).slice(0, maxPages); // Limit PDFs
        let pdfCount = 0;
        
        for (const pdfUrl of pdfUrls) {
          // Add small delay between PDF requests
          if (pdfCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          const pdfPage = await this.scrapePdf(pdfUrl);
          if (pdfPage) {
            pages.push(pdfPage);
            pdfCount++;
            console.log(`[FirecrawlScraper] Extracted PDF ${pdfCount}/${pdfUrls.length}: ${pdfUrl}`);
          } else {
            errors.push({ url: pdfUrl, error: "Failed to extract PDF content" });
          }
        }
        
        console.log(`[FirecrawlScraper] Successfully extracted ${pdfCount} PDF files`);
      }

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[FirecrawlScraper] Error: ${errMsg}`);
      errors.push({ url: this.startUrl, error: errMsg });
      
      // Fallback: try single page scrape with links extraction
      console.log(`[FirecrawlScraper] Attempting single page scrape fallback...`);
      try {
        const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: this.startUrl,
            formats: ["markdown", "links"],
            onlyMainContent: true,
          }),
        });

        if (scrapeResponse.ok) {
          const scrapeData = await scrapeResponse.json();
          const data = scrapeData.data || scrapeData;
          
          if (data.markdown) {
            pages.push({
              url: this.startUrl,
              title: data.metadata?.title || "",
              content: data.markdown,
              ref: this.extractRefFromUrl(this.startUrl),
              links: data.links || [],
              scraped_at: new Date().toISOString(),
              metadata: data.metadata,
            });
            errors.pop();
          }
          
          // Try to scrape PDFs from links
          if (extractPdfs && data.links) {
            const pdfLinks = (data.links as string[]).filter(l => this.isPdfUrl(l));
            console.log(`[FirecrawlScraper] Found ${pdfLinks.length} PDFs in fallback mode`);
            
            for (const pdfUrl of pdfLinks.slice(0, 10)) { // Limit to 10 in fallback
              const pdfPage = await this.scrapePdf(pdfUrl);
              if (pdfPage) {
                pages.push(pdfPage);
              }
            }
          }
        }
      } catch (fallbackError) {
        console.error(`[FirecrawlScraper] Fallback scrape also failed:`, fallbackError);
      }
    }

    console.log(`[FirecrawlScraper] Completed: ${pages.length} pages scraped (incl. PDFs), ${errors.length} errors`);

    return { pages, errors };
  }
}

// ============================================================================
// WEB SCRAPER CLASS (Basic HTML)
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
// TEXT CHUNKING (from import-kb)
// ============================================================================

interface Chunk {
  text: string;
  ref: string;
  start_char: number;
  end_char: number;
}

function chunkText(
  content: string,
  docId: string,
  refPrefix: string,
  chunkSize = 1000,
  chunkOverlap = 200
): Chunk[] {
  const chunks: Chunk[] = [];
  
  // Clean content
  const cleanContent = content
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/ +/g, " ")
    .trim();

  if (cleanContent.length === 0) {
    return [];
  }

  // Section patterns for intelligent chunking
  const sectionPatterns = [
    /^(#{1,3}\s+.+)$/gm,
    /^(Article\s+\d+[\.\-]?\s*.*)$/gim,
    /^(Chapitre\s+[IVXLCDM\d]+[\.\-]?\s*.*)$/gim,
    /^(Section\s+[IVXLCDM\d]+[\.\-]?\s*.*)$/gim,
    /^(\d{2}[\.\d]*\s+.+)$/gm,
    /^(Note\s+\d+[\.\-]?\s*.*)$/gim,
  ];

  interface Section {
    title: string;
    content: string;
    startIndex: number;
  }

  const sections: Section[] = [];
  let lastIndex = 0;
  let currentTitle = refPrefix || docId;

  const allMatches: { index: number; title: string }[] = [];
  
  for (const pattern of sectionPatterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(cleanContent)) !== null) {
      allMatches.push({ index: match.index, title: match[1].trim() });
    }
  }

  allMatches.sort((a, b) => a.index - b.index);

  for (let i = 0; i < allMatches.length; i++) {
    const match = allMatches[i];
    const nextIndex = allMatches[i + 1]?.index ?? cleanContent.length;
    
    if (match.index > lastIndex) {
      sections.push({
        title: currentTitle,
        content: cleanContent.slice(lastIndex, match.index).trim(),
        startIndex: lastIndex,
      });
    }
    
    currentTitle = `${refPrefix ? refPrefix + " > " : ""}${match.title}`;
    lastIndex = match.index;
  }

  if (lastIndex < cleanContent.length) {
    sections.push({
      title: currentTitle,
      content: cleanContent.slice(lastIndex).trim(),
      startIndex: lastIndex,
    });
  }

  if (sections.length === 0) {
    sections.push({
      title: refPrefix || docId,
      content: cleanContent,
      startIndex: 0,
    });
  }

  let chunkIndex = 0;
  
  for (const section of sections) {
    if (section.content.length === 0) continue;

    if (section.content.length <= chunkSize) {
      chunks.push({
        text: section.content,
        ref: section.title,
        start_char: section.startIndex,
        end_char: section.startIndex + section.content.length,
      });
      chunkIndex++;
    } else {
      const paragraphs = section.content.split(/\n\n+/);
      let currentChunk = "";
      let chunkStart = section.startIndex;
      let localOffset = 0;

      for (const para of paragraphs) {
        if (currentChunk.length + para.length + 2 <= chunkSize) {
          currentChunk += (currentChunk ? "\n\n" : "") + para;
        } else {
          if (currentChunk.length > 0) {
            chunks.push({
              text: currentChunk,
              ref: `${section.title} [${chunkIndex + 1}]`,
              start_char: chunkStart,
              end_char: chunkStart + currentChunk.length,
            });
            chunkIndex++;
          }
          
          if (para.length > chunkSize) {
            const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
            currentChunk = "";
            
            for (const sentence of sentences) {
              if (currentChunk.length + sentence.length <= chunkSize) {
                currentChunk += sentence;
              } else {
                if (currentChunk.length > 0) {
                  chunks.push({
                    text: currentChunk,
                    ref: `${section.title} [${chunkIndex + 1}]`,
                    start_char: section.startIndex + localOffset,
                    end_char: section.startIndex + localOffset + currentChunk.length,
                  });
                  chunkIndex++;
                  localOffset += currentChunk.length;
                }
                currentChunk = sentence;
              }
            }
          } else {
            currentChunk = para;
            chunkStart = section.startIndex + localOffset;
          }
        }
        localOffset += para.length + 2;
      }

      if (currentChunk.length > 0) {
        chunks.push({
          text: currentChunk,
          ref: `${section.title} [${chunkIndex + 1}]`,
          start_char: chunkStart,
          end_char: chunkStart + currentChunk.length,
        });
        chunkIndex++;
      }
    }
  }

  // Add overlap
  if (chunkOverlap > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1];
      const overlapText = prevChunk.text.slice(-chunkOverlap);
      if (overlapText.length > 50) {
        const lastSpace = overlapText.lastIndexOf(" ");
        const overlap = lastSpace > 0 ? overlapText.slice(lastSpace + 1) : overlapText;
        chunks[i].text = `...${overlap} ${chunks[i].text}`;
      }
    }
  }

  return chunks;
}

// ============================================================================
// CRON PARSING
// ============================================================================

function calculateNextRunFromCron(cronExpr: string): Date | null {
  // Simple cron parser for common patterns
  // Format: minute hour day month weekday
  try {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    
    const [minute, hour] = parts;
    const now = new Date();
    const next = new Date(now);
    
    // Set time based on cron
    if (hour !== "*") {
      next.setHours(parseInt(hour, 10));
    }
    if (minute !== "*") {
      next.setMinutes(parseInt(minute, 10));
    }
    next.setSeconds(0);
    next.setMilliseconds(0);
    
    // If next time is in the past, add 1 day
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    
    return next;
  } catch {
    return null;
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

function generateDocId(url: string, sourceName: string): string {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname.replace(/\//g, "_").replace(/^_|_$/g, "");
    return `${sourceName.toLowerCase().replace(/\s+/g, "_")}_${path || "index"}`;
  } catch {
    return `${sourceName.toLowerCase().replace(/\s+/g, "_")}_${Date.now()}`;
  }
}

// ============================================================================
// SCRAPE SOURCE FUNCTION
// ============================================================================

async function scrapeSource(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  source: DataSource
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const result: ScrapeResult = {
    source_id: source.id,
    source_name: source.name,
    pages: [],
    chunks_created: 0,
    errors: [],
    duration_ms: 0,
    status: "success",
  };

  // Create scrape log entry (scrape_logs table may not be in generated types yet)
  const { data: scrapeLog, error: logError } = await supabase
    .from("scrape_logs")
    .insert({
      source_id: source.id,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (logError) {
    console.error(`[auto-scraper] Failed to create scrape log:`, logError);
  }

  const scrapeLogId = (scrapeLog as { id?: string } | null)?.id;

  try {
    console.log(`[auto-scraper] Starting scrape for ${source.name} (${source.url})`);
    console.log(`[auto-scraper] Using ${source.scrape_config.use_firecrawl ? 'Firecrawl' : 'basic HTML'} scraper`);

    // Choose scraper based on config
    let scrapeResult: { pages: ScrapedPage[]; errors: Array<{ url: string; error: string }> };
    
    if (source.scrape_config.use_firecrawl) {
      // Use Firecrawl for JavaScript-heavy sites
      const firecrawlScraper = new FirecrawlScraper(
        source.url,
        source.scrape_config,
        source.base_url || undefined
      );
      scrapeResult = await firecrawlScraper.scrape();
    } else {
      // Use basic HTML scraper
      const scraper = new WebScraper(
        source.url,
        source.scrape_config,
        source.base_url || undefined
      );
      scrapeResult = await scraper.scrape();
    }
    result.pages = scrapeResult.pages;
    result.errors = scrapeResult.errors;

    console.log(`[auto-scraper] Scraped ${scrapeResult.pages.length} pages from ${source.name}`);

    // Process each page: chunk and insert into kb_chunks
    const chunkSize = source.scrape_config.chunk_size || 1000;
    const chunkOverlap = source.scrape_config.chunk_overlap || 200;
    const chunkRecords: Array<{
      source: string;
      doc_id: string;
      ref: string;
      text: string;
      version_label: string;
      source_url: string;
      metadata: Record<string, unknown>;
    }> = [];

    for (const page of scrapeResult.pages) {
      const docId = generateDocId(page.url, source.name);
      const chunks = chunkText(page.content, docId, page.title || page.ref, chunkSize, chunkOverlap);

      for (const chunk of chunks) {
        chunkRecords.push({
          source: source.kb_source,
          doc_id: docId,
          ref: chunk.ref,
          text: chunk.text,
          version_label: source.version_label,
          source_url: page.url,
          metadata: {
            title: page.title,
            scraped_at: page.scraped_at,
            source_name: source.name,
            page_ref: page.ref,
          },
        });
      }
    }

    // Batch insert chunks (in batches of 100)
    if (chunkRecords.length > 0) {
      console.log(`[auto-scraper] Inserting ${chunkRecords.length} chunks for ${source.name}`);
      
      const batchSize = 100;
      for (let i = 0; i < chunkRecords.length; i += batchSize) {
        const batch = chunkRecords.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from("kb_chunks")
          .insert(batch);

        if (insertError) {
          console.error(`[auto-scraper] Error inserting chunks batch:`, insertError);
          result.errors.push({ url: "batch_insert", error: insertError.message });
        } else {
          result.chunks_created += batch.length;
        }
      }
    }

    // Determine final status
    if (scrapeResult.pages.length === 0) {
      result.status = "error";
    } else if (scrapeResult.errors.length > 0) {
      result.status = "partial";
    } else {
      result.status = "success";
    }

    // Calculate next run time if cron is set
    let nextScrapeAt: string | null = null;
    if (source.schedule_cron) {
      const nextRun = calculateNextRunFromCron(source.schedule_cron);
      if (nextRun) {
        nextScrapeAt = nextRun.toISOString();
      }
    }

    // Update data_sources with results
    const { error: updateError } = await supabase
      .from("data_sources")
      .update({
        last_scrape_at: new Date().toISOString(),
        next_scrape_at: nextScrapeAt,
        status: result.status === "error" ? "error" : "active",
        error_message: result.status === "error" ? "No pages scraped" : null,
        error_count: result.status === "error" ? source.error_count + 1 : 0,
        stats: {
          total_pages: scrapeResult.pages.length,
          total_chunks: result.chunks_created,
          last_scrape_errors: scrapeResult.errors.length,
        },
      })
      .eq("id", source.id);

    if (updateError) {
      console.error(`[auto-scraper] Error updating data_source:`, updateError);
    }

    // Update scrape log
    if (scrapeLogId) {
      await supabase
        .from("scrape_logs")
        .update({
          completed_at: new Date().toISOString(),
          status: result.status,
          pages_scraped: scrapeResult.pages.length,
          chunks_created: result.chunks_created,
          errors_count: scrapeResult.errors.length,
          details: {
            errors: scrapeResult.errors.slice(0, 20), // Limit stored errors
            pages_urls: scrapeResult.pages.map(p => p.url).slice(0, 100),
          },
        })
        .eq("id", scrapeLogId);
    }

    // Trigger embedding generation in background (fire and forget)
    if (result.chunks_created > 0) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      
      fetch(`${supabaseUrl}/functions/v1/generate-embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ batch_size: 50 }),
      }).catch(err => {
        console.error(`[auto-scraper] Failed to trigger embeddings:`, err);
      });
      
      console.log(`[auto-scraper] Triggered embedding generation for new chunks`);
    }

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[auto-scraper] Error scraping ${source.name}:`, errMsg);
    
    result.status = "error";
    result.errors.push({ url: source.url, error: errMsg });

    // Update scrape log with error
    if (scrapeLogId) {
      await supabase
        .from("scrape_logs")
        .update({
          completed_at: new Date().toISOString(),
          status: "error",
          error_message: errMsg,
        })
        .eq("id", scrapeLogId);
    }

    // Update data_source error count
    await supabase
      .from("data_sources")
      .update({
        status: "error",
        error_message: errMsg,
        error_count: source.error_count + 1,
      })
      .eq("id", source.id);
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate using custom JWT (admin required)
    const authResult = await authenticateRequest(req, { requireRole: ["admin"] });
    if (!authResult.success) {
      return authResult.error;
    }

    // Initialize Supabase client with service role
    const supabase = createServiceClient();

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

    if (sources.length === 0) {
      return createResponse({
        success: true,
        message: "No sources to scrape",
        sources_count: 0,
        results: [],
      });
    }

    // Scrape each source
    const results: ScrapeResult[] = [];
    let totalPages = 0;
    let totalChunks = 0;
    let totalErrors = 0;

    for (const source of sources) {
      console.log(`[auto-scraper] Processing source: ${source.name}`);
      
      const result = await scrapeSource(supabase, source);
      results.push(result);
      
      totalPages += result.pages.length;
      totalChunks += result.chunks_created;
      totalErrors += result.errors.length;
    }

    return createResponse({
      success: true,
      sources_count: sources.length,
      total_pages: totalPages,
      total_chunks: totalChunks,
      total_errors: totalErrors,
      results: results.map(r => ({
        source_id: r.source_id,
        source_name: r.source_name,
        status: r.status,
        pages_count: r.pages.length,
        chunks_created: r.chunks_created,
        errors_count: r.errors.length,
        duration_ms: r.duration_ms,
      })),
    });

  } catch (error) {
    console.error("[auto-scraper] Error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
});
