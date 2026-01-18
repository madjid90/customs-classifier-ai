import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// CONFIGURATION
// ============================================================================

function getConfig() {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const embeddingsModel = Deno.env.get("OPENAI_MODEL_EMBEDDINGS") || "text-embedding-3-large";
  
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY non configurée");
  }
  
  return { apiKey, embeddingsModel };
}

// ============================================================================
// TYPES
// ============================================================================

interface EmbeddingRequest {
  mode: "batch" | "single" | "stats";
  batch_size?: number;
  chunk_id?: string;
  text?: string;
}

interface EmbeddingStats {
  total_chunks: number;
  with_embeddings: number;
  without_embeddings: number;
  percentage_complete: number;
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

async function generateEmbedding(text: string, config: { apiKey: string; embeddingsModel: string }): Promise<number[]> {
  // Nettoyer et tronquer le texte (max 8191 tokens ≈ 30000 chars pour text-embedding-3-large)
  const cleanText = text
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 30000);

  if (cleanText.length < 10) {
    throw new Error("Texte trop court pour générer un embedding");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.embeddingsModel,
      input: cleanText,
      dimensions: 3072, // text-embedding-3-large default
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[embeddings] OpenAI error:", response.status, errorText);
    
    if (response.status === 429) {
      throw new Error("RATE_LIMIT: Limite de requêtes OpenAI dépassée");
    }
    if (response.status === 401) {
      throw new Error("AUTH_ERROR: Clé API OpenAI invalide");
    }
    throw new Error(`OPENAI_ERROR: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function generateBatchEmbeddings(
  texts: { id: string; text: string }[],
  config: { apiKey: string; embeddingsModel: string }
): Promise<{ id: string; embedding: number[] }[]> {
  // OpenAI supporte jusqu'à 2048 inputs par requête
  const cleanTexts = texts.map(t => ({
    id: t.id,
    text: t.text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim().substring(0, 30000)
  })).filter(t => t.text.length >= 10);

  if (cleanTexts.length === 0) {
    return [];
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.embeddingsModel,
      input: cleanTexts.map(t => t.text),
      dimensions: 3072,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[embeddings] Batch error:", response.status, errorText);
    throw new Error(`OPENAI_ERROR: ${response.status}`);
  }

  const data = await response.json();
  
  return data.data.map((item: { index: number; embedding: number[] }) => ({
    id: cleanTexts[item.index].id,
    embedding: item.embedding,
  }));
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
        JSON.stringify({ message: "Non authentifié" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ message: "Token invalide" }),
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
        JSON.stringify({ message: "Accès réservé aux administrateurs" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: EmbeddingRequest = await req.json();
    const { mode = "stats", batch_size = 50, chunk_id, text } = body;

    console.log(`[embeddings] Mode: ${mode}, batch_size: ${batch_size}`);

    // Mode stats - retourner les statistiques
    if (mode === "stats") {
      const { count: totalChunks } = await supabase
        .from("kb_chunks")
        .select("*", { count: "exact", head: true });

      const { count: withEmbeddings } = await supabase
        .from("kb_chunks")
        .select("*", { count: "exact", head: true })
        .not("embedding", "is", null);

      const stats: EmbeddingStats = {
        total_chunks: totalChunks || 0,
        with_embeddings: withEmbeddings || 0,
        without_embeddings: (totalChunks || 0) - (withEmbeddings || 0),
        percentage_complete: totalChunks ? Math.round(((withEmbeddings || 0) / totalChunks) * 100) : 100,
      };

      return new Response(
        JSON.stringify({ success: true, stats }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mode single - générer embedding pour un texte spécifique
    if (mode === "single") {
      if (!text) {
        return new Response(
          JSON.stringify({ message: "Texte requis pour le mode single" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const config = getConfig();
      const embedding = await generateEmbedding(text, config);

      // Si chunk_id fourni, sauvegarder dans la DB
      if (chunk_id) {
        const embeddingString = `[${embedding.join(",")}]`;
        const { error: updateError } = await supabase
          .from("kb_chunks")
          .update({ embedding: embeddingString })
          .eq("id", chunk_id);

        if (updateError) {
          console.error("[embeddings] Update error:", updateError);
          return new Response(
            JSON.stringify({ message: updateError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          embedding,
          dimensions: embedding.length,
          saved: !!chunk_id
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mode batch - traiter les chunks sans embeddings
    if (mode === "batch") {
      const config = getConfig();

      // Récupérer les chunks sans embeddings
      const { data: chunks, error: fetchError } = await supabase
        .from("kb_chunks")
        .select("id, text")
        .is("embedding", null)
        .limit(batch_size);

      if (fetchError) {
        console.error("[embeddings] Fetch error:", fetchError);
        return new Response(
          JSON.stringify({ message: fetchError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!chunks || chunks.length === 0) {
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Aucun chunk sans embedding",
            processed: 0
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[embeddings] Processing ${chunks.length} chunks...`);

      // Générer les embeddings en batch
      const embeddings = await generateBatchEmbeddings(chunks, config);

      console.log(`[embeddings] Generated ${embeddings.length} embeddings`);

      // Sauvegarder les embeddings
      let savedCount = 0;
      let errorCount = 0;

      for (const item of embeddings) {
        const embeddingString = `[${item.embedding.join(",")}]`;
        const { error: updateError } = await supabase
          .from("kb_chunks")
          .update({ embedding: embeddingString })
          .eq("id", item.id);

        if (updateError) {
          console.error(`[embeddings] Update error for ${item.id}:`, updateError);
          errorCount++;
        } else {
          savedCount++;
        }
      }

      // Récupérer le nombre de chunks restants
      const { count: remaining } = await supabase
        .from("kb_chunks")
        .select("*", { count: "exact", head: true })
        .is("embedding", null);

      return new Response(
        JSON.stringify({
          success: true,
          processed: chunks.length,
          saved: savedCount,
          errors: errorCount,
          remaining: remaining || 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ message: "Mode invalide. Utilisez: stats, single, ou batch" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[embeddings] Error:", error);
    return new Response(
      JSON.stringify({ 
        message: error instanceof Error ? error.message : "Erreur serveur",
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
