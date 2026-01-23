import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ScrapeRequest {
  source_id: string;
  options?: {
    max_pages?: number;
    include_paths?: string[];
    exclude_paths?: string[];
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body: ScrapeRequest = await req.json();
    const { source_id, options = {} } = body;

    if (!source_id) {
      return new Response(
        JSON.stringify({ success: false, error: "source_id requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!FIRECRAWL_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl non configuré. Connectez le connecteur Firecrawl." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get source info
    const { data: source, error: sourceError } = await supabase
      .from("data_sources")
      .select("*")
      .eq("id", source_id)
      .single();

    if (sourceError || !source) {
      return new Response(
        JSON.stringify({ success: false, error: "Source non trouvée" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[scrape-source] Starting scrape for: ${source.name} (${source.url})`);

    // Create scrape log entry
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
      console.error("Error creating scrape log:", logError);
    }

    let pagesScraped = 0;
    let chunksCreated = 0;
    let errors: string[] = [];

    try {
      // Determine scrape method based on source type
      if (source.source_type === "sitemap") {
        // Use Firecrawl map to get all URLs first
        const mapResponse = await fetch("https://api.firecrawl.dev/v1/map", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: source.url,
            limit: options.max_pages || 100,
            includeSubdomains: false,
          }),
        });

        const mapData = await mapResponse.json();
        
        if (mapData.success && mapData.links) {
          console.log(`[scrape-source] Found ${mapData.links.length} URLs to scrape`);
          
          // Scrape each URL
          for (const pageUrl of mapData.links.slice(0, options.max_pages || 50)) {
            try {
              const result = await scrapeAndStore(
                supabase,
                pageUrl,
                source,
                FIRECRAWL_API_KEY
              );
              if (result.success) {
                pagesScraped++;
                chunksCreated += result.chunks;
              }
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              errors.push(`${pageUrl}: ${errorMsg}`);
            }
          }
        }
      } else if (source.source_type === "website") {
        // Use Firecrawl crawl for recursive scraping
        const crawlResponse = await fetch("https://api.firecrawl.dev/v1/crawl", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: source.url,
            limit: options.max_pages || 25,
            maxDepth: 3,
            includePaths: options.include_paths,
            excludePaths: options.exclude_paths || [
              "/login", "/signup", "/admin", "/cart", "/account"
            ],
            scrapeOptions: {
              formats: ["markdown"],
              onlyMainContent: true,
            },
          }),
        });

        const crawlData = await crawlResponse.json();
        
        if (crawlData.success && crawlData.data) {
          console.log(`[scrape-source] Crawled ${crawlData.data.length} pages`);
          
          for (const page of crawlData.data) {
            try {
              const chunks = await storePageChunks(
                supabase,
                page,
                source
              );
              pagesScraped++;
              chunksCreated += chunks;
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              errors.push(`Page: ${errorMsg}`);
            }
          }
        } else if (crawlData.id) {
          // Async crawl - wait for completion
          console.log(`[scrape-source] Crawl started with ID: ${crawlData.id}`);
          
          // Poll for results
          let attempts = 0;
          while (attempts < 30) {
            await new Promise(r => setTimeout(r, 2000));
            
            const statusResponse = await fetch(
              `https://api.firecrawl.dev/v1/crawl/${crawlData.id}`,
              {
                headers: { "Authorization": `Bearer ${FIRECRAWL_API_KEY}` },
              }
            );
            
            const statusData = await statusResponse.json();
            
            if (statusData.status === "completed") {
              for (const page of statusData.data || []) {
                try {
                  const chunks = await storePageChunks(supabase, page, source);
                  pagesScraped++;
                  chunksCreated += chunks;
                } catch (err) {
                  const errorMsg = err instanceof Error ? err.message : String(err);
                  errors.push(`Page: ${errorMsg}`);
                }
              }
              break;
            } else if (statusData.status === "failed") {
              throw new Error("Crawl failed");
            }
            
            attempts++;
          }
        }
      } else {
        // Single page scrape for pdf_url, rss, api
        const result = await scrapeAndStore(
          supabase,
          source.url,
          source,
          FIRECRAWL_API_KEY
        );
        if (result.success) {
          pagesScraped = 1;
          chunksCreated = result.chunks;
        }
      }

      // Update source stats
      await supabase
        .from("data_sources")
        .update({
          last_scrape_at: new Date().toISOString(),
          status: errors.length > 0 && pagesScraped === 0 ? "error" : "active",
          error_message: errors.length > 0 ? errors.slice(0, 3).join("; ") : null,
          error_count: errors.length,
          stats: {
            pages_scraped: pagesScraped,
            chunks_created: chunksCreated,
            last_run: new Date().toISOString(),
          },
        })
        .eq("id", source.id);

      // Update scrape log
      if (scrapeLog) {
        await supabase
          .from("scrape_logs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            pages_scraped: pagesScraped,
            chunks_created: chunksCreated,
            errors_count: errors.length,
            error_message: errors.length > 0 ? errors.slice(0, 5).join("\n") : null,
          })
          .eq("id", scrapeLog.id);
      }

      console.log(`[scrape-source] Completed: ${pagesScraped} pages, ${chunksCreated} chunks`);

      return new Response(
        JSON.stringify({
          success: true,
          pages_scraped: pagesScraped,
          chunks_created: chunksCreated,
          errors: errors.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("[scrape-source] Scrape error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      
      // Update source with error
      await supabase
        .from("data_sources")
        .update({
          status: "error",
          error_message: errorMsg,
          error_count: (source.error_count || 0) + 1,
        })
        .eq("id", source.id);

      // Update scrape log
      if (scrapeLog) {
        await supabase
          .from("scrape_logs")
          .update({
            status: "error",
            completed_at: new Date().toISOString(),
            error_message: errorMsg,
          })
          .eq("id", scrapeLog.id);
      }

      throw err;
    }
  } catch (err) {
    console.error("[scrape-source] Error:", err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ success: false, error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function scrapeAndStore(
  supabase: any,
  url: string,
  source: any,
  apiKey: string
): Promise<{ success: boolean; chunks: number }> {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });

  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error || "Scrape failed");
  }

  const markdown = data.data?.markdown || data.markdown;
  const metadata = data.data?.metadata || data.metadata || {};

  if (!markdown || markdown.trim().length < 100) {
    return { success: true, chunks: 0 };
  }

  // Split into chunks
  const chunks = splitIntoChunks(markdown, 1500);
  
  // Store chunks
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    await supabase.from("kb_chunks").insert({
      source: source.kb_source,
      doc_id: `${source.id}-${url.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50)}`,
      ref: metadata.title || url,
      text: chunk,
      version_label: source.version_label,
      source_url: url,
      page_number: i + 1,
      metadata: {
        scraped_at: new Date().toISOString(),
        source_name: source.name,
        source_id: source.id,
        page_title: metadata.title,
        original_url: url,
      },
    });
  }

  return { success: true, chunks: chunks.length };
}

async function storePageChunks(
  supabase: any,
  page: any,
  source: any
): Promise<number> {
  const markdown = page.markdown;
  const metadata = page.metadata || {};
  const url = metadata.sourceURL || source.url;

  if (!markdown || markdown.trim().length < 100) {
    return 0;
  }

  const chunks = splitIntoChunks(markdown, 1500);
  
  for (let i = 0; i < chunks.length; i++) {
    await supabase.from("kb_chunks").insert({
      source: source.kb_source,
      doc_id: `${source.id}-${url.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50)}`,
      ref: metadata.title || url,
      text: chunks[i],
      version_label: source.version_label,
      source_url: url,
      page_number: i + 1,
      metadata: {
        scraped_at: new Date().toISOString(),
        source_name: source.name,
        source_id: source.id,
        page_title: metadata.title,
        original_url: url,
      },
    });
  }

  return chunks.length;
}

function splitIntoChunks(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = "";

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxLength) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = para;
    } else {
      currentChunk += "\n\n" + para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
