import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { createBackgroundTask, completeTask, failTask, updateTaskProgress } from "../_shared/background-tasks.ts";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// File extensions to detect and download
const DOWNLOADABLE_EXTENSIONS = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".odt", ".ods", ".odp", ".rtf", ".txt", ".csv"
];

interface ScrapeRequest {
  source_id: string;
  options?: {
    max_pages?: number;
    include_paths?: string[];
    exclude_paths?: string[];
    download_files?: boolean;
  };
}

interface ScrapeResult {
  pagesScraped: number;
  chunksCreated: number;
  filesDownloaded: number;
  errors: string[];
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
    const { data: scrapeLog } = await supabase
      .from("scrape_logs")
      .insert({
        source_id: source.id,
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    const result: ScrapeResult = {
      pagesScraped: 0,
      chunksCreated: 0,
      filesDownloaded: 0,
      errors: [],
    };

    try {
      // Determine scrape method based on source type
      if (source.source_type === "pdf_url") {
        // Direct PDF download and processing
        await downloadAndProcessFile(supabase, source.url, source, result);
      } else if (source.source_type === "sitemap") {
        // Use Firecrawl map to get all URLs first
        await scrapeWithMap(supabase, source, options, result);
      } else {
        // Website crawl with file detection
        await scrapeWithCrawl(supabase, source, options, result);
      }

      // Update source stats
      await supabase
        .from("data_sources")
        .update({
          last_scrape_at: new Date().toISOString(),
          status: result.errors.length > 0 && result.pagesScraped === 0 ? "error" : "active",
          error_message: result.errors.length > 0 ? result.errors.slice(0, 3).join("; ") : null,
          error_count: result.errors.length,
          stats: {
            pages_scraped: result.pagesScraped,
            chunks_created: result.chunksCreated,
            files_downloaded: result.filesDownloaded,
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
            pages_scraped: result.pagesScraped,
            chunks_created: result.chunksCreated,
            errors_count: result.errors.length,
            error_message: result.errors.length > 0 ? result.errors.slice(0, 5).join("\n") : null,
            details: { files_downloaded: result.filesDownloaded },
          })
          .eq("id", scrapeLog.id);
      }

      console.log(`[scrape-source] Completed: ${result.pagesScraped} pages, ${result.chunksCreated} chunks, ${result.filesDownloaded} files`);

      // Trigger automatic embedding generation for new chunks
      let embeddingsTriggered = false;
      if (result.chunksCreated > 0) {
        try {
          // Use EdgeRuntime.waitUntil for background processing
          const embeddingPromise = triggerEmbeddingGeneration(supabase, result.chunksCreated);
          
          // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
          if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
            // @ts-ignore
            EdgeRuntime.waitUntil(embeddingPromise);
            embeddingsTriggered = true;
            console.log(`[scrape-source] Embedding generation triggered in background for ${result.chunksCreated} chunks`);
          } else {
            // Fallback: fire and forget
            embeddingPromise.catch(err => console.error("[scrape-source] Embedding trigger error:", err));
            embeddingsTriggered = true;
          }
        } catch (err) {
          console.error("[scrape-source] Failed to trigger embeddings:", err);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          pages_scraped: result.pagesScraped,
          chunks_created: result.chunksCreated,
          files_downloaded: result.filesDownloaded,
          errors: result.errors.length,
          embeddings_triggered: embeddingsTriggered,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("[scrape-source] Scrape error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      
      await supabase
        .from("data_sources")
        .update({
          status: "error",
          error_message: errorMsg,
          error_count: (source.error_count || 0) + 1,
        })
        .eq("id", source.id);

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

// Scrape using sitemap/map
async function scrapeWithMap(
  supabase: any,
  source: any,
  options: any,
  result: ScrapeResult
) {
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
    console.log(`[scrape-source] Found ${mapData.links.length} URLs`);
    
    const fileUrls: string[] = [];
    const pageUrls: string[] = [];
    
    // Separate files from pages
    for (const url of mapData.links) {
      if (isDownloadableFile(url)) {
        fileUrls.push(url);
      } else {
        pageUrls.push(url);
      }
    }
    
    console.log(`[scrape-source] ${pageUrls.length} pages, ${fileUrls.length} files detected`);
    
    // Process pages
    for (const pageUrl of pageUrls.slice(0, options.max_pages || 50)) {
      try {
        const chunks = await scrapeAndStorePage(supabase, pageUrl, source);
        result.pagesScraped++;
        result.chunksCreated += chunks;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${pageUrl}: ${errorMsg}`);
      }
    }
    
    // Download and process files
    if (options.download_files !== false) {
      for (const fileUrl of fileUrls.slice(0, 20)) {
        try {
          await downloadAndProcessFile(supabase, fileUrl, source, result);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          result.errors.push(`File ${fileUrl}: ${errorMsg}`);
        }
      }
    }
  }
}

// Scrape using crawl with file detection
async function scrapeWithCrawl(
  supabase: any,
  source: any,
  options: any,
  result: ScrapeResult
) {
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
        formats: ["markdown", "links"],
        onlyMainContent: true,
      },
    }),
  });

  const crawlData = await crawlResponse.json();
  
  // Handle async crawl
  let pages = crawlData.data || [];
  if (crawlData.id && !crawlData.data) {
    console.log(`[scrape-source] Async crawl started: ${crawlData.id}`);
    pages = await waitForCrawlCompletion(crawlData.id);
  }
  
  console.log(`[scrape-source] Processing ${pages.length} pages`);
  
  const detectedFiles: string[] = [];
  
  for (const page of pages) {
    try {
      // Store page content
      const chunks = await storePageChunks(supabase, page, source);
      result.pagesScraped++;
      result.chunksCreated += chunks;
      
      // Detect file links in the page
      const links = page.links || [];
      for (const link of links) {
        if (isDownloadableFile(link) && !detectedFiles.includes(link)) {
          detectedFiles.push(link);
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Page: ${errorMsg}`);
    }
  }
  
  // Download detected files
  if (options.download_files !== false && detectedFiles.length > 0) {
    console.log(`[scrape-source] Downloading ${detectedFiles.length} files`);
    
    for (const fileUrl of detectedFiles.slice(0, 20)) {
      try {
        await downloadAndProcessFile(supabase, fileUrl, source, result);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`File ${fileUrl}: ${errorMsg}`);
      }
    }
  }
}

// Wait for async crawl to complete
async function waitForCrawlCompletion(crawlId: string): Promise<any[]> {
  let attempts = 0;
  while (attempts < 60) {
    await new Promise(r => setTimeout(r, 2000));
    
    const statusResponse = await fetch(
      `https://api.firecrawl.dev/v1/crawl/${crawlId}`,
      { headers: { "Authorization": `Bearer ${FIRECRAWL_API_KEY}` } }
    );
    
    const statusData = await statusResponse.json();
    
    if (statusData.status === "completed") {
      return statusData.data || [];
    } else if (statusData.status === "failed") {
      throw new Error("Crawl failed");
    }
    
    attempts++;
  }
  
  throw new Error("Crawl timeout");
}

// Check if URL is a downloadable file
function isDownloadableFile(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return DOWNLOADABLE_EXTENSIONS.some(ext => lowerUrl.endsWith(ext));
}

// Get file extension from URL
function getFileExtension(url: string): string {
  const match = url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  return match ? match[1] : "bin";
}

// Download file and process it
async function downloadAndProcessFile(
  supabase: any,
  fileUrl: string,
  source: any,
  result: ScrapeResult
) {
  console.log(`[scrape-source] Downloading: ${fileUrl}`);
  
  // Download file
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  
  const contentType = response.headers.get("content-type") || "";
  const arrayBuffer = await response.arrayBuffer();
  const fileBytes = new Uint8Array(arrayBuffer);
  
  // Generate filename
  const urlPath = new URL(fileUrl).pathname;
  const originalFilename = urlPath.split("/").pop() || "document";
  const extension = getFileExtension(fileUrl);
  const timestamp = Date.now();
  const storagePath = `${source.id}/${timestamp}-${originalFilename}`;
  
  // Upload to storage
  const { error: uploadError } = await supabase.storage
    .from("scraped-files")
    .upload(storagePath, fileBytes, {
      contentType: contentType || `application/${extension}`,
      upsert: true,
    });
  
  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }
  
  // Record in scraped_files table
  await supabase.from("scraped_files").insert({
    source_id: source.id,
    original_url: fileUrl,
    storage_path: storagePath,
    filename: originalFilename,
    file_type: extension,
    file_size_bytes: fileBytes.length,
    content_extracted: false,
    metadata: {
      content_type: contentType,
      downloaded_at: new Date().toISOString(),
    },
  });
  
  result.filesDownloaded++;
  
  // For PDFs, try to extract text using Firecrawl
  if (extension === "pdf") {
    try {
      const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: fileUrl,
          formats: ["markdown"],
        }),
      });
      
      const scrapeData = await scrapeResponse.json();
      const markdown = scrapeData.data?.markdown || scrapeData.markdown;
      
      if (markdown && markdown.trim().length > 100) {
        const chunks = splitIntoChunks(markdown, 1500);
        
        for (let i = 0; i < chunks.length; i++) {
          await supabase.from("kb_chunks").insert({
            source: source.kb_source,
            doc_id: `file-${storagePath.replace(/[^a-zA-Z0-9]/g, "_")}`,
            ref: `${originalFilename} (p${i + 1})`,
            text: chunks[i],
            version_label: source.version_label,
            source_url: fileUrl,
            page_number: i + 1,
            metadata: {
              file_type: extension,
              storage_path: storagePath,
              source_name: source.name,
              source_id: source.id,
            },
          });
        }
        
        result.chunksCreated += chunks.length;
        
        // Mark as extracted
        await supabase
          .from("scraped_files")
          .update({ 
            content_extracted: true, 
            chunks_created: chunks.length,
            processed_at: new Date().toISOString(),
          })
          .eq("storage_path", storagePath);
      }
    } catch (err) {
      console.log(`[scrape-source] PDF extraction failed for ${fileUrl}:`, err);
    }
  }
}

// Scrape a single page
async function scrapeAndStorePage(
  supabase: any,
  url: string,
  source: any
): Promise<number> {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "links"],
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

// Store chunks from a crawled page
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

// Split text into chunks
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

// ============================================================================
// AUTOMATIC EMBEDDING GENERATION
// ============================================================================

const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_TEXT_LENGTH = 8000;
const RATE_LIMIT_DELAY_MS = 150;

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const cleanText = text
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, MAX_TEXT_LENGTH);

  if (cleanText.length < 10) {
    throw new Error("Text too short for embedding");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: cleanText,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429) {
      throw new Error("RATE_LIMIT");
    }
    throw new Error(`OpenAI error: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function triggerEmbeddingGeneration(supabase: any, expectedChunks: number): Promise<void> {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  
  if (!OPENAI_API_KEY) {
    console.log("[scrape-source] Skipping embeddings: OPENAI_API_KEY not configured");
    return;
  }

  // Wait a bit for chunks to be fully committed
  await new Promise(r => setTimeout(r, 2000));

  // Get chunks without embeddings (limit to recent ones)
  const { data: chunks, error } = await supabase
    .from("kb_chunks")
    .select("id, ref, text, metadata")
    .is("embedding", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(expectedChunks + 10, 100));

  if (error || !chunks || chunks.length === 0) {
    console.log("[scrape-source] No chunks without embeddings found");
    return;
  }

  console.log(`[scrape-source] Generating embeddings for ${chunks.length} chunks...`);

  // Create background task for tracking
  const taskId = await createBackgroundTask(supabase, "embeddings_kb", {
    itemsTotal: chunks.length,
  });

  let processed = 0;
  let errors = 0;

  for (const chunk of chunks) {
    try {
      // Build text for embedding
      let text = chunk.ref || "";
      if (chunk.text) text += " " + chunk.text;
      if (chunk.metadata?.summary) text += " " + chunk.metadata.summary;
      text = text.trim();

      if (text.length < 20) {
        continue;
      }

      const embedding = await generateEmbedding(text, OPENAI_API_KEY);
      const embeddingString = `[${embedding.join(",")}]`;

      const { error: updateError } = await supabase
        .from("kb_chunks")
        .update({ embedding: embeddingString })
        .eq("id", chunk.id);

      if (!updateError) {
        processed++;
        if (taskId && processed % 10 === 0) {
          await updateTaskProgress(supabase, taskId, processed, chunks.length);
        }
      } else {
        errors++;
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scrape-source] Embedding error for chunk ${chunk.id}:`, msg);
      
      // If rate limited, wait longer
      if (msg === "RATE_LIMIT") {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  // Complete task
  if (taskId) {
    if (processed === 0 && errors > 0) {
      await failTask(supabase, taskId, `Failed to generate embeddings: ${errors} errors`);
    } else {
      await completeTask(supabase, taskId, processed, chunks.length);
    }
  }

  console.log(`[scrape-source] Embeddings complete: ${processed}/${chunks.length} processed, ${errors} errors`);
}
