import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// CONDITIONAL LOGGER
// ============================================================================

const IS_PRODUCTION = Deno.env.get("ENVIRONMENT") === "production";

const logger = {
  debug: (...args: unknown[]) => {
    if (!IS_PRODUCTION) console.log("[DEBUG]", ...args);
  },
  info: (...args: unknown[]) => {
    console.log("[INFO]", ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn("[WARN]", ...args);
  },
  error: (...args: unknown[]) => {
    console.error("[ERROR]", ...args);
  },
  metric: (name: string, value: number, tags?: Record<string, string>) => {
    console.log(JSON.stringify({
      type: "metric",
      name,
      value,
      tags,
      timestamp: new Date().toISOString(),
    }));
  },
};

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

// ============================================================================
// CONFIGURATION - Modèles OpenAI depuis les secrets
// ============================================================================

function getOpenAIConfig() {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY non configurée");
  }
  return {
    apiKey,
    modelReasoning: Deno.env.get("OPENAI_MODEL_REASONING") || "gpt-4.1",
  };
}

// ============================================================================
// TYPES
// ============================================================================

interface ExtractionRequest {
  type: "hs_codes" | "dum_records" | "kb_chunks";
  content: string;
  options?: {
    version_label?: string;
    chunk_size?: number;
    language?: string;
  };
}

interface HSCodeExtracted {
  code: string;
  label_fr: string;
  label_ar?: string;
  unit?: string;
}

interface DUMExtracted {
  dum_date: string;
  dum_number?: string;
  product_description: string;
  hs_code: string;
  origin_country: string;
  quantity?: string;
  value?: string;
}

interface KBChunkExtracted {
  doc_id: string;
  ref: string;
  text: string;
  summary?: string;
  keywords?: string[];
}

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

const SYSTEM_PROMPTS = {
  hs_codes: `Tu es un expert en nomenclature douanière. Extrait les codes HS et leurs libellés depuis le texte fourni.

RÈGLES:
- Les codes HS doivent avoir 6-10 chiffres
- Normalise les codes à 10 chiffres (padding avec des 0)
- Extrait le libellé en français
- Si disponible, extrait aussi le libellé arabe et l'unité

RETOURNE un tableau JSON avec la structure:
[{"code": "0101210000", "label_fr": "Chevaux reproducteurs de race pure", "label_ar": "...", "unit": "tête"}]`,

  dum_records: `Tu es un expert en documents douaniers marocains (DUM - Déclaration Unique de Marchandise).

RÈGLES:
- Extrait la date au format YYYY-MM-DD
- Le code HS doit avoir 10 chiffres
- Le pays d'origine en code ISO ou nom complet
- La description du produit doit être claire et complète

RETOURNE un tableau JSON avec la structure:
[{"dum_date": "2024-01-15", "dum_number": "123456", "product_description": "...", "hs_code": "0101210000", "origin_country": "FR", "quantity": "100", "value": "50000"}]`,

  kb_chunks: `Tu es un expert en structuration de documents réglementaires et juridiques.

RÈGLES:
- Découpe le texte en chunks logiques (par section, article, paragraphe)
- Chaque chunk doit être autonome et compréhensible
- Génère une référence unique pour chaque chunk
- Extrait les mots-clés pertinents
- Génère un résumé court (max 100 mots)

RETOURNE un tableau JSON avec la structure:
[{"doc_id": "doc_001", "ref": "Art. 1", "text": "...", "summary": "...", "keywords": ["douane", "import"]}]`
};

// ============================================================================
// OPENAI API CALL (Backend only - No frontend AI)
// ============================================================================

async function callOpenAI(systemPrompt: string, userContent: string): Promise<string> {
  const config = getOpenAIConfig();

  logger.debug(`[extract-data] Calling OpenAI ${config.modelReasoning}...`);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.modelReasoning,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      temperature: 0.1,
      tools: [
        {
          type: "function",
          function: {
            name: "extract_structured_data",
            description: "Extrait les données structurées du document",
            parameters: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              required: ["items"]
            }
          }
        }
      ],
      tool_choice: { type: "function", function: { name: "extract_structured_data" } }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("[extract-data] OpenAI error:", response.status, errorText);
    
    if (response.status === 429) {
      throw new Error("Limite de requêtes OpenAI dépassée. Réessayez plus tard.");
    }
    if (response.status === 401) {
      throw new Error("Clé API OpenAI invalide.");
    }
    if (response.status === 402 || response.status === 403) {
      throw new Error("Quota OpenAI épuisé ou accès refusé.");
    }
    throw new Error(`Erreur OpenAI: ${response.status}`);
  }

  const data = await response.json();
  
  // Extract from tool call
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    return toolCall.function.arguments;
  }
  
  // Fallback to content
  return data.choices?.[0]?.message?.content || "[]";
}

// ============================================================================
// PARSING & NORMALIZATION
// ============================================================================

function parseAIResponse<T>(response: string): T[] {
  try {
    const parsed = JSON.parse(response);
    if (parsed.items && Array.isArray(parsed.items)) {
      return parsed.items;
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (e) {
    logger.error("[extract-data] Parse error:", e);
    // Try to extract JSON array from response
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return [];
      }
    }
    return [];
  }
}

function normalizeHSCode(code: string): string | null {
  const cleaned = code.replace(/\D/g, '');
  if (cleaned.length < 6) return null;
  return cleaned.padEnd(10, '0').substring(0, 10);
}

function normalizeDate(dateStr: string): string | null {
  if (!dateStr) return null;
  
  // ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 10);
  }
  
  // European DD/MM/YYYY or DD-MM-YYYY
  const euroMatch = dateStr.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (euroMatch) {
    const [_, day, month, year] = euroMatch;
    return `${year}-${month}-${day}`;
  }
  
  return null;
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

    // Verify auth
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

    // Check role (admin or manager)
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "manager"])
      .single();

    if (!roleData) {
      return new Response(
        JSON.stringify({ message: "Accès réservé aux administrateurs" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { type, content, options = {} } = await req.json() as ExtractionRequest;

    if (!type || !content) {
      return new Response(
        JSON.stringify({ message: "Type et contenu requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logger.info(`[extract-data] Processing ${type} extraction, content length: ${content.length}`);

    // Split content into chunks if too large (max ~15000 chars per request)
    const MAX_CHUNK_SIZE = 15000;
    const contentChunks: string[] = [];
    
    if (content.length > MAX_CHUNK_SIZE) {
      // Split by lines to avoid breaking in middle of data
      const lines = content.split('\n');
      let currentChunk = '';
      
      for (const line of lines) {
        if ((currentChunk + line).length > MAX_CHUNK_SIZE && currentChunk.length > 0) {
          contentChunks.push(currentChunk);
          currentChunk = line;
        } else {
          currentChunk += (currentChunk ? '\n' : '') + line;
        }
      }
      if (currentChunk) {
        contentChunks.push(currentChunk);
      }
    } else {
      contentChunks.push(content);
    }

    logger.debug(`[extract-data] Split into ${contentChunks.length} chunks`);

    const systemPrompt = SYSTEM_PROMPTS[type];
    let allResults: any[] = [];
    const errors: string[] = [];

    // Process each chunk
    for (let i = 0; i < contentChunks.length; i++) {
      try {
        logger.debug(`[extract-data] Processing chunk ${i + 1}/${contentChunks.length}`);
        
        const aiResponse = await callOpenAI(systemPrompt, contentChunks[i]);
        const chunkResults = parseAIResponse(aiResponse);
        
        logger.debug(`[extract-data] Chunk ${i + 1} extracted ${chunkResults.length} items`);
        allResults = allResults.concat(chunkResults);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "Erreur inconnue";
        logger.error(`[extract-data] Chunk ${i + 1} error:`, errorMsg);
        errors.push(`Chunk ${i + 1}: ${errorMsg}`);
      }
    }

    // Post-process based on type
    let processedResults: any[] = [];
    let validCount = 0;
    let invalidCount = 0;

    if (type === "hs_codes") {
      for (const item of allResults as HSCodeExtracted[]) {
        const code10 = normalizeHSCode(item.code);
        if (code10 && item.label_fr) {
          processedResults.push({
            code_10: code10,
            code_6: code10.substring(0, 6),
            chapter_2: code10.substring(0, 2),
            label_fr: item.label_fr.substring(0, 1000),
            label_ar: item.label_ar,
            unit: item.unit,
            active_version_label: options.version_label || "AI_EXTRACT"
          });
          validCount++;
        } else {
          invalidCount++;
        }
      }
    } else if (type === "dum_records") {
      // Get user's company
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("user_id", user.id)
        .single();

      if (!profile?.company_id) {
        return new Response(
          JSON.stringify({ message: "Profil utilisateur non trouvé" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      for (const item of allResults as DUMExtracted[]) {
        const date = normalizeDate(item.dum_date);
        const code10 = normalizeHSCode(item.hs_code);
        
        if (date && code10 && item.product_description && item.origin_country) {
          processedResults.push({
            dum_date: date,
            dum_number: item.dum_number,
            product_description: item.product_description.substring(0, 2000),
            hs_code_10: code10,
            origin_country: item.origin_country.substring(0, 100),
            company_id: profile.company_id,
            reliability_score: 0
          });
          validCount++;
        } else {
          invalidCount++;
        }
      }
    } else if (type === "kb_chunks") {
      for (const item of allResults as KBChunkExtracted[]) {
        if (item.text && item.text.length > 10) {
          processedResults.push({
            source: "ai_extract",
            doc_id: item.doc_id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            ref: item.ref || "AI Extract",
            text: item.text,
            version_label: options.version_label || "AI_EXTRACT"
          });
          validCount++;
        } else {
          invalidCount++;
        }
      }
    }

    logger.info(`[extract-data] Extraction complete: ${validCount} valid, ${invalidCount} invalid`);

    return new Response(
      JSON.stringify({
        success: true,
        type,
        extracted: processedResults,
        stats: {
          total_extracted: allResults.length,
          valid: validCount,
          invalid: invalidCount,
          chunks_processed: contentChunks.length
        },
        errors: errors.length > 0 ? errors : undefined
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    logger.error("[extract-data] Error:", error);
    return new Response(
      JSON.stringify({ 
        message: error instanceof Error ? error.message : "Erreur serveur",
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
