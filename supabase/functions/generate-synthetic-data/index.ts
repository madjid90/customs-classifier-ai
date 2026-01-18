import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Domaines autorisés pour CORS
const ALLOWED_ORIGINS = [
  "https://id-preview--0f81d8ea-a57f-480b-a034-90dd63cc6ea0.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  
  const isAllowed = ALLOWED_ORIGINS.some(allowed => origin === allowed) || 
    origin.endsWith(".lovable.app") || 
    origin.includes("localhost");
  
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
  };
}

interface RequestBody {
  mode: "stats" | "hs_sample" | "kb_sample" | "dum_sample";
  count?: number;
  company_id?: string;
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

interface DUMRecordGenerated {
  hs_code_10: string;
  product_description: string;
  origin_country: string;
  quantity: number;
  unit: string;
  value_mad: number;
  date: string;
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
  const corsHeaders = getCorsHeaders(req);
  
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

    // ========================================
    // MODE: dum_sample
    // ========================================
    if (mode === "dum_sample") {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) {
        return new Response(
          JSON.stringify({ error: "OPENAI_API_KEY is not configured. Please add it in Supabase secrets." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate count parameter
      const recordCount = Math.min(Math.max(count || 100, 10), 500);
      console.log(`[dum_sample] Generating ${recordCount} DUM records`);

      // Get existing HS codes to use
      const { data: hsCodes, error: hsError } = await supabase
        .from("hs_codes")
        .select("code_10, label_fr")
        .eq("active", true)
        .limit(50);

      if (hsError) {
        console.error("[dum_sample] Error fetching HS codes:", hsError);
        throw new Error(`Failed to fetch HS codes: ${hsError.message}`);
      }

      if (!hsCodes || hsCodes.length < 10) {
        return new Response(
          JSON.stringify({ 
            error: "Minimum 10 codes HS requis dans la base de données pour générer des DUM synthétiques",
            available: hsCodes?.length || 0
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[dum_sample] Using ${hsCodes.length} existing HS codes`);

      // Determine company_id - use provided one or get from user profile
      let targetCompanyId = body.company_id;
      
      if (!targetCompanyId) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("company_id")
          .eq("user_id", user.id)
          .single();

        if (profileError || !profile?.company_id) {
          return new Response(
            JSON.stringify({ error: "Impossible de déterminer l'entreprise de l'utilisateur" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        targetCompanyId = profile.company_id;
      }

      console.log(`[dum_sample] Target company: ${targetCompanyId}`);

      // Build HS codes list for prompt
      const hsCodesList = hsCodes
        .map(c => `${c.code_10}: ${c.label_fr}`)
        .join("\n");

      const prompt = `Tu es un expert en commerce international marocain.
Génère ${recordCount} enregistrements DUM (Déclaration Unique de Marchandise) RÉALISTES.

Utilise UNIQUEMENT ces codes HS existants :
${hsCodesList}

Pour chaque DUM, génère :
- Un code HS de la liste ci-dessus (OBLIGATOIRE)
- Une description produit réaliste et détaillée (100-300 caractères)
- Un pays d'origine (codes ISO 2 lettres : CN, FR, ES, DE, IT, US, TR, IN, etc.)
- Une quantité réaliste (1-10000)
- Une unité (u, kg, l, m, m2, paire)
- Une valeur en MAD (100-1000000)
- Une date dans les 2 dernières années (format YYYY-MM-DD)

Les descriptions doivent être variées et réalistes (marques, modèles, spécifications techniques).

FORMAT JSON STRICT :
{
  "records": [
    {
      "hs_code_10": "8517130000",
      "product_description": "Smartphones Samsung Galaxy A54 5G 128GB noir",
      "origin_country": "CN",
      "quantity": 500,
      "unit": "u",
      "value_mad": 1500000,
      "date": "2024-06-15"
    }
  ]
}`;

      const content = await callOpenAI(prompt, openaiKey);
      let parsed: any;
      let records: DUMRecordGenerated[] = [];
      
      try {
        parsed = parseJSONResponse(content);
        records = parsed.records || parsed;
      } catch (parseError) {
        console.error("[dum_sample] JSON parse error:", parseError);
        return new Response(
          JSON.stringify({ 
            error: "Échec du parsing de la réponse OpenAI",
            details: parseError instanceof Error ? parseError.message : String(parseError)
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[dum_sample] Generated ${records.length} records from OpenAI`);

      // Create a set of valid HS codes for validation
      const validHsCodes = new Set(hsCodes.map(c => c.code_10));

      let inserted = 0;
      let skipped = 0;
      const errors: string[] = [];

      // Insert in batches with rate limiting
      const batchSize = 20;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const validRecords = [];

        for (const record of batch) {
          // Validate HS code exists
          if (!record.hs_code_10 || !validHsCodes.has(record.hs_code_10)) {
            console.log(`[dum_sample] Skipping invalid HS code: ${record.hs_code_10}`);
            skipped++;
            continue;
          }

          // Validate other required fields
          if (!record.product_description || record.product_description.length < 10) {
            skipped++;
            continue;
          }

          if (!record.origin_country || record.origin_country.length !== 2) {
            skipped++;
            continue;
          }

          // Prepare DUM record for insertion
          const dumRecord = {
            company_id: targetCompanyId,
            hs_code_10: record.hs_code_10,
            product_description: record.product_description.substring(0, 2000),
            origin_country: record.origin_country.toUpperCase(),
            destination_country: "MA",
            quantity: Math.max(1, Math.min(record.quantity || 1, 999999)),
            unit: record.unit || "u",
            value_mad: Math.max(100, Math.min(record.value_mad || 1000, 99999999)),
            dum_date: record.date || new Date().toISOString().split("T")[0],
            validated: false,
            reliability_score: 60, // Synthetic data = reduced reliability
            source: "synthetic"
          };

          validRecords.push(dumRecord);
        }

        if (validRecords.length > 0) {
          const { error: insertError } = await supabase
            .from("dum_records")
            .insert(validRecords);

          if (insertError) {
            console.error(`[dum_sample] Batch insert error:`, insertError);
            errors.push(`Batch ${i / batchSize + 1}: ${insertError.message}`);
          } else {
            inserted += validRecords.length;
          }
        }

        // Rate limiting: 200ms between batches
        if (i + batchSize < records.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      console.log(`[dum_sample] Complete: ${inserted} inserted, ${skipped} skipped`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          generated: records.length,
          inserted,
          skipped,
          message: `${inserted} DUM synthétiques générées`,
          errors: errors.length > 0 ? errors : undefined
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Invalid mode
    return new Response(
      JSON.stringify({ error: `Invalid mode: ${mode}. Use "stats", "hs_sample", "kb_sample", or "dum_sample"` }),
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
