import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  mode: "stats" | "hs_sample" | "kb_sample";
  count?: number;
}

interface HSCodeGenerated {
  code_10: string;
  label_fr: string;
  label_ar?: string;
  chapter_2: string;
  unit?: string;
  duty_rate?: number;
  vat_rate?: number;
}

interface KBChunkGenerated {
  source: string;
  ref: string;
  text: string;
  hs_codes?: string[];
  keywords?: string[];
}

async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  console.log("Calling OpenAI API...");
  
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
          content: "Tu es un assistant qui génère des données JSON valides. Retourne UNIQUEMENT du JSON valide, sans markdown ni explication."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("OpenAI API error:", error);
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  
  if (!content) {
    throw new Error("No content in OpenAI response");
  }

  console.log("OpenAI response received, length:", content.length);
  return content;
}

function parseJSONResponse(content: string): any {
  // Try to extract JSON from markdown code blocks if present
  let jsonStr = content.trim();
  
  // Remove markdown code blocks
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
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("JSON parse error:", e);
    console.error("Content to parse:", jsonStr.substring(0, 500));
    const errorMessage = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse JSON response: ${errorMessage}`);
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is admin
    const { data: hasRole } = await supabase.rpc("has_role", { 
      _user_id: user.id, 
      _role: "admin" 
    });

    if (!hasRole) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body: RequestBody = await req.json();
    const { mode, count = 50 } = body;

    console.log(`Processing mode: ${mode}, count: ${count}`);

    // ========================================
    // MODE: stats
    // ========================================
    if (mode === "stats") {
      const { data: stats, error: statsError } = await supabase.rpc("get_ingestion_stats");
      
      if (statsError) {
        console.error("Stats error:", statsError);
        throw new Error(`Failed to get stats: ${statsError.message}`);
      }

      return new Response(
        JSON.stringify({ success: true, stats }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================
    // MODE: hs_sample
    // ========================================
    if (mode === "hs_sample") {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) {
        return new Response(
          JSON.stringify({ error: "OPENAI_API_KEY is not configured. Please add it in Supabase secrets." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const prompt = `Tu es un expert en nomenclature douanière. Génère ${count} codes HS RÉALISTES format Maroc (10 chiffres) avec leurs libellés. 
      
Couvre différents chapitres:
- Textile (61-63): vêtements, tissus
- Électronique (84-85): machines, appareils
- Alimentaire (01-24): viandes, fruits, légumes, céréales
- Chimie (28-38): produits chimiques, cosmétiques
- Véhicules (87): voitures, pièces

Retourne un tableau JSON avec exactement ces champs pour chaque code:
{
  "codes": [
    {
      "code_10": "8517120000",
      "label_fr": "Téléphones portables",
      "label_ar": "هواتف محمولة",
      "chapter_2": "85",
      "unit": "u",
      "duty_rate": 2.5,
      "vat_rate": 20
    }
  ]
}

Les codes doivent être valides et cohérents (les 2 premiers chiffres = chapter_2).`;

      const content = await callOpenAI(prompt, openaiKey);
      const parsed = parseJSONResponse(content);
      const codes: HSCodeGenerated[] = parsed.codes || parsed;

      console.log(`Generated ${codes.length} HS codes`);

      let inserted = 0;
      const errors: string[] = [];

      for (const code of codes) {
        // Validate code format
        if (!code.code_10 || code.code_10.length !== 10) {
          errors.push(`Invalid code: ${code.code_10}`);
          continue;
        }

        const hsCodeRow = {
          code_10: code.code_10,
          code_6: code.code_10.substring(0, 6),
          chapter_2: code.code_10.substring(0, 2),
          label_fr: code.label_fr,
          label_ar: code.label_ar || null,
          unit: code.unit || "u",
          taxes: {
            duty_rate: code.duty_rate || 0,
            vat_rate: code.vat_rate || 20
          },
          active: true,
          active_version_label: "synthetic-v1"
        };

        const { error: upsertError } = await supabase
          .from("hs_codes")
          .upsert(hsCodeRow, { onConflict: "code_10" });

        if (upsertError) {
          console.error(`Error inserting ${code.code_10}:`, upsertError);
          errors.push(`${code.code_10}: ${upsertError.message}`);
        } else {
          inserted++;
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          generated: codes.length, 
          inserted,
          errors: errors.length > 0 ? errors : undefined
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================
    // MODE: kb_sample
    // ========================================
    if (mode === "kb_sample") {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) {
        return new Response(
          JSON.stringify({ error: "OPENAI_API_KEY is not configured. Please add it in Supabase secrets." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const prompt = `Tu es un expert en réglementation douanière marocaine et internationale. 
      
Génère ${count} extraits de documentation douanière RÉALISTES couvrant:
- Notes explicatives OMD (Organisation Mondiale des Douanes)
- Règles générales d'interprétation du Système harmonisé
- Notes de section et de chapitre
- Articles de loi de finances marocaine
- Circulaires douanières marocaines

Chaque chunk doit avoir 200-400 mots et être technique et précis.

Retourne un tableau JSON:
{
  "chunks": [
    {
      "source": "omd",
      "ref": "Note explicative 85.17",
      "text": "Les appareils de cette position comprennent...",
      "hs_codes": ["8517", "851712"],
      "keywords": ["téléphone", "communication", "mobile"]
    }
  ]
}

Sources possibles: "omd", "maroc", "lois"
Assure-toi que les références sont réalistes (ex: "Note 85.17", "Article 3 LF 2024", "Circulaire 5426").`;

      const content = await callOpenAI(prompt, openaiKey);
      const parsed = parseJSONResponse(content);
      const chunks: KBChunkGenerated[] = parsed.chunks || parsed;

      console.log(`Generated ${chunks.length} KB chunks`);

      let inserted = 0;
      const errors: string[] = [];

      for (const chunk of chunks) {
        // Validate source
        const validSources = ["omd", "maroc", "lois"];
        const source = validSources.includes(chunk.source) ? chunk.source : "omd";

        const kbChunkRow = {
          source: source,
          doc_id: `synthetic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          ref: chunk.ref || "Unknown reference",
          text: chunk.text,
          version_label: "synthetic-v1",
          metadata: {
            hs_codes: chunk.hs_codes || [],
            keywords: chunk.keywords || [],
            synthetic: true
          }
        };

        const { error: insertError } = await supabase
          .from("kb_chunks")
          .insert(kbChunkRow);

        if (insertError) {
          console.error(`Error inserting chunk:`, insertError);
          errors.push(`${chunk.ref}: ${insertError.message}`);
        } else {
          inserted++;
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          generated: chunks.length, 
          inserted,
          errors: errors.length > 0 ? errors : undefined
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Invalid mode
    return new Response(
      JSON.stringify({ error: `Invalid mode: ${mode}. Use "stats", "hs_sample", or "kb_sample"` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
