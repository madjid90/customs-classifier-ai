import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { logger } from "../_shared/logger.ts";
import { corsHeaders } from "../_shared/cors.ts";

const RATE_LIMIT_DELAY_MS = 200;

// ============================================================================
// INPUT VALIDATION (Zod)
// ============================================================================

const EnrichRequestSchema = z.object({
  batch_size: z.number().int().min(1).max(100).default(20),
});

type RequestBody = z.infer<typeof EnrichRequestSchema>;

interface EnrichmentData {
  keywords_fr: string[];
  keywords_en: string[];
  typical_products: string[];
  materials: string[];
  exclusions: string[];
  similar_codes: string[];
  classification_hints: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callOpenAI(
  code_10: string,
  label_fr: string,
  chapter_2: string,
  apiKey: string
): Promise<EnrichmentData> {
  const prompt = `Tu es un expert en classification douanière.

Pour ce code HS marocain, génère des informations d'enrichissement :

CODE: ${code_10}
LIBELLÉ: ${label_fr}
CHAPITRE: ${chapter_2}

Réponds UNIQUEMENT en JSON valide, sans markdown :
{
  "keywords_fr": ["5-10 mots-clés français incluant synonymes courants"],
  "keywords_en": ["5-10 keywords anglais"],
  "typical_products": ["3-5 exemples de produits concrets avec marques si pertinent"],
  "materials": ["matériaux/matières typiques"],
  "exclusions": ["ce qui NE va PAS dans ce code - important pour éviter confusion"],
  "similar_codes": ["codes 4-6 digits similaires à ne pas confondre"],
  "classification_hints": "1-2 phrases: comment distinguer ce code des codes similaires"
}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Tu es un assistant expert en douane. Réponds toujours en JSON valide uniquement, sans markdown ni explication."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error("OpenAI error:", response.status, error);
    
    if (response.status === 429) {
      throw new Error("RATE_LIMIT: Limite OpenAI dépassée");
    }
    if (response.status === 401) {
      throw new Error("AUTH_ERROR: Clé API OpenAI invalide");
    }
    throw new Error(`OPENAI_ERROR: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error("No content in OpenAI response");
  }

  // Parse JSON (handle markdown code blocks if present)
  let jsonStr = content.trim();
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3);
  }
  jsonStr = jsonStr.trim();

  try {
    return JSON.parse(jsonStr) as EnrichmentData;
  } catch (e) {
    console.error("[enrich] JSON parse error:", e);
    console.error("[enrich] Content:", jsonStr.substring(0, 500));
    throw new Error("Failed to parse enrichment JSON");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Vérifier auth
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

    // Vérifier clé OpenAI
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY non configurée" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse and validate body
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Corps de requête JSON invalide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const validation = EnrichRequestSchema.safeParse(rawBody);
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
    
    const { batch_size } = validation.data;

    console.log(`[enrich] Starting enrichment, batch_size: ${batch_size}`);

    // Récupérer les codes sans enrichment
    const { data: codes, error: fetchError } = await supabase
      .from("hs_codes")
      .select("code_10, label_fr, chapter_2")
      .eq("active", true)
      .or("enrichment.is.null,enrichment.eq.{}")
      .limit(batch_size);

    if (fetchError) {
      console.error("[enrich] Fetch error:", fetchError);
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
        .or("enrichment.is.null,enrichment.eq.{}");

      return new Response(
        JSON.stringify({ 
          success: true, 
          processed: 0,
          remaining: remaining || 0,
          message: "Aucun code HS à enrichir"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[enrich] Processing ${codes.length} HS codes...`);

    let processed = 0;
    const errors: string[] = [];

    for (const code of codes) {
      try {
        console.log(`[enrich] Enriching ${code.code_10}...`);
        
        const enrichment = await callOpenAI(
          code.code_10,
          code.label_fr,
          code.chapter_2,
          openaiKey
        );

        const { error: updateError } = await supabase
          .from("hs_codes")
          .update({ 
            enrichment,
            updated_at: new Date().toISOString()
          })
          .eq("code_10", code.code_10);

        if (updateError) {
          console.error(`[enrich] Update error for ${code.code_10}:`, updateError);
          errors.push(`${code.code_10}: ${updateError.message}`);
        } else {
          processed++;
          console.log(`[enrich] ✓ Enriched ${code.code_10}`);
        }

        // Rate limiting
        await sleep(RATE_LIMIT_DELAY_MS);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error(`[enrich] Error for ${code.code_10}:`, errorMsg);
        errors.push(`${code.code_10}: ${errorMsg}`);
        
        // Si rate limit, attendre plus longtemps
        if (errorMsg.includes("RATE_LIMIT")) {
          console.log("[enrich] Rate limited, waiting 5 seconds...");
          await sleep(5000);
        }
      }
    }

    // Compter les codes restants
    const { count: remaining } = await supabase
      .from("hs_codes")
      .select("*", { count: "exact", head: true })
      .eq("active", true)
      .or("enrichment.is.null,enrichment.eq.{}");

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        remaining: remaining || 0,
        errors: errors.length > 0 ? errors : undefined
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[enrich] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erreur serveur",
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
