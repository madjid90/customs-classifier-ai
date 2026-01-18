import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { logger } from "../_shared/logger.ts";
import { corsHeaders } from "../_shared/cors.ts";

// ============================================================================
// CONFIGURATION
// ============================================================================

const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_TEXT_LENGTH = 8000;
const RATE_LIMIT_DELAY_MS = 100;

function getConfig() {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY non configurée. Veuillez l'ajouter dans les secrets Supabase.");
  }
  
  return { apiKey };
}

// ============================================================================
// INPUT VALIDATION (Zod)
// ============================================================================

const EmbeddingRequestSchema = z.object({
  mode: z.enum(["stats", "batch"]),
  target: z.enum(["hs", "kb"]).optional(),
  batch_size: z.number().int().min(1).max(200).default(50),
});

type EmbeddingRequest = z.infer<typeof EmbeddingRequestSchema>;

interface StatsResponse {
  hs_codes: {
    total: number;
    with_embedding: number;
  };
  kb_chunks: {
    total: number;
    with_embedding: number;
  };
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  // Nettoyer et tronquer le texte
  const cleanText = text
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, MAX_TEXT_LENGTH);

  if (cleanText.length < 10) {
    throw new Error("Texte trop court pour générer un embedding");
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
    console.error("[embeddings] OpenAI error:", response.status, errorText);
    
    if (response.status === 429) {
      throw new Error("RATE_LIMIT: Limite de requêtes OpenAI dépassée. Réessayez dans quelques secondes.");
    }
    if (response.status === 401) {
      throw new Error("AUTH_ERROR: Clé API OpenAI invalide ou expirée.");
    }
    throw new Error(`OPENAI_ERROR: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// TEXT BUILDERS
// ============================================================================

function buildKBChunkText(chunk: { ref: string; text: string; metadata?: { summary?: string } }): string {
  let combined = chunk.ref || "";
  if (chunk.text) {
    combined += " " + chunk.text;
  }
  if (chunk.metadata?.summary) {
    combined += " " + chunk.metadata.summary;
  }
  return combined.trim();
}

function buildHSCodeText(code: {
  code_10: string;
  label_fr: string;
  label_ar?: string;
  enrichment?: {
    keywords_fr?: string[];
    typical_products?: string[];
  };
}): string {
  let combined = `Code ${code.code_10}: ${code.label_fr}`;
  
  if (code.label_ar) {
    combined += ` ${code.label_ar}`;
  }
  
  if (code.enrichment?.keywords_fr?.length) {
    combined += ` Mots-clés: ${code.enrichment.keywords_fr.join(", ")}`;
  }
  
  if (code.enrichment?.typical_products?.length) {
    combined += ` Produits typiques: ${code.enrichment.typical_products.join(", ")}`;
  }
  
  return combined.trim();
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Vérifier auth (admin requis)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Non authentifié" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Token invalide" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Vérifier rôle admin
    const { data: hasAdmin } = await supabase.rpc("has_role", { 
      _user_id: user.id, 
      _role: "admin" 
    });

    if (!hasAdmin) {
      return new Response(
        JSON.stringify({ error: "Accès réservé aux administrateurs" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse and validate request body
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Corps de requête JSON invalide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const validation = EmbeddingRequestSchema.safeParse(rawBody);
    if (!validation.success) {
      return new Response(
        JSON.stringify({
          error: "Validation error",
          details: validation.error.issues.map(i => ({
            field: i.path.join("."),
            message: i.message,
          })),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const { mode, target, batch_size } = validation.data;

    console.log(`[embeddings] Mode: ${mode}, target: ${target}, batch_size: ${batch_size}`);

    // ========================================
    // MODE: stats
    // ========================================
    if (mode === "stats") {
      // Stats HS codes
      const { count: hsTotal } = await supabase
        .from("hs_codes")
        .select("*", { count: "exact", head: true })
        .eq("active", true);

      const { count: hsWithEmbedding } = await supabase
        .from("hs_codes")
        .select("*", { count: "exact", head: true })
        .eq("active", true)
        .not("embedding", "is", null);

      // Stats KB chunks
      const { count: kbTotal } = await supabase
        .from("kb_chunks")
        .select("*", { count: "exact", head: true });

      const { count: kbWithEmbedding } = await supabase
        .from("kb_chunks")
        .select("*", { count: "exact", head: true })
        .not("embedding", "is", null);

      const stats: StatsResponse = {
        hs_codes: {
          total: hsTotal || 0,
          with_embedding: hsWithEmbedding || 0,
        },
        kb_chunks: {
          total: kbTotal || 0,
          with_embedding: kbWithEmbedding || 0,
        },
      };

      return new Response(
        JSON.stringify({ success: true, stats }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================
    // MODE: batch
    // ========================================
    if (mode === "batch") {
      if (!target || !["hs", "kb"].includes(target)) {
        return new Response(
          JSON.stringify({ error: 'Paramètre "target" requis: "hs" ou "kb"' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const config = getConfig();

      // ----------------------------------------
      // TARGET: kb
      // ----------------------------------------
      if (target === "kb") {
        // Récupérer les chunks sans embeddings
        const { data: chunks, error: fetchError } = await supabase
          .from("kb_chunks")
          .select("id, ref, text, metadata")
          .is("embedding", null)
          .limit(batch_size);

        if (fetchError) {
          console.error("[embeddings] Fetch error:", fetchError);
          return new Response(
            JSON.stringify({ error: fetchError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!chunks || chunks.length === 0) {
          const { count: remaining } = await supabase
            .from("kb_chunks")
            .select("*", { count: "exact", head: true })
            .is("embedding", null);

          return new Response(
            JSON.stringify({ 
              success: true, 
              processed: 0,
              remaining: remaining || 0,
              message: "Aucun chunk KB sans embedding"
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`[embeddings] Processing ${chunks.length} KB chunks...`);

        let processed = 0;
        const errors: string[] = [];

        for (const chunk of chunks) {
          try {
            const text = buildKBChunkText(chunk);
            const embedding = await generateEmbedding(text, config.apiKey);
            
            // Format as string for vector column
            const embeddingString = `[${embedding.join(",")}]`;
            
            const { error: updateError } = await supabase
              .from("kb_chunks")
              .update({ embedding: embeddingString })
              .eq("id", chunk.id);

            if (updateError) {
              console.error(`[embeddings] Update error for chunk ${chunk.id}:`, updateError);
              errors.push(`${chunk.id}: ${updateError.message}`);
            } else {
              processed++;
            }

            // Rate limiting
            await sleep(RATE_LIMIT_DELAY_MS);
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            console.error(`[embeddings] Error for chunk ${chunk.id}:`, errorMsg);
            errors.push(`${chunk.id}: ${errorMsg}`);
          }
        }

        // Compter les chunks restants
        const { count: remaining } = await supabase
          .from("kb_chunks")
          .select("*", { count: "exact", head: true })
          .is("embedding", null);

        return new Response(
          JSON.stringify({
            success: true,
            processed,
            remaining: remaining || 0,
            errors: errors.length > 0 ? errors : undefined
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ----------------------------------------
      // TARGET: hs
      // ----------------------------------------
      if (target === "hs") {
        // Récupérer les codes HS sans embeddings
        const { data: codes, error: fetchError } = await supabase
          .from("hs_codes")
          .select("code_10, label_fr, label_ar, enrichment")
          .eq("active", true)
          .is("embedding", null)
          .limit(batch_size);

        if (fetchError) {
          console.error("[embeddings] Fetch error:", fetchError);
          return new Response(
            JSON.stringify({ error: fetchError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!codes || codes.length === 0) {
          const { count: remaining } = await supabase
            .from("hs_codes")
            .select("*", { count: "exact", head: true })
            .eq("active", true)
            .is("embedding", null);

          return new Response(
            JSON.stringify({ 
              success: true, 
              processed: 0,
              remaining: remaining || 0,
              message: "Aucun code HS sans embedding"
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`[embeddings] Processing ${codes.length} HS codes...`);

        let processed = 0;
        const errors: string[] = [];

        for (const code of codes) {
          try {
            const text = buildHSCodeText(code);
            const embedding = await generateEmbedding(text, config.apiKey);
            
            // Format as string for vector column
            const embeddingString = `[${embedding.join(",")}]`;
            
            const { error: updateError } = await supabase
              .from("hs_codes")
              .update({ embedding: embeddingString })
              .eq("code_10", code.code_10);

            if (updateError) {
              console.error(`[embeddings] Update error for code ${code.code_10}:`, updateError);
              errors.push(`${code.code_10}: ${updateError.message}`);
            } else {
              processed++;
            }

            // Rate limiting
            await sleep(RATE_LIMIT_DELAY_MS);
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            console.error(`[embeddings] Error for code ${code.code_10}:`, errorMsg);
            errors.push(`${code.code_10}: ${errorMsg}`);
          }
        }

        // Compter les codes restants
        const { count: remaining } = await supabase
          .from("hs_codes")
          .select("*", { count: "exact", head: true })
          .eq("active", true)
          .is("embedding", null);

        return new Response(
          JSON.stringify({
            success: true,
            processed,
            remaining: remaining || 0,
            errors: errors.length > 0 ? errors : undefined
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: 'Mode invalide. Utilisez: "stats" ou "batch"' }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[embeddings] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erreur serveur",
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
