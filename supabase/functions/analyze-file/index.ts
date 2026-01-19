import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

// Target databases and their detection patterns
const DATABASE_TARGETS = {
  hs_codes: {
    name: "Codes HS / Nomenclature douanière",
    patterns: [
      /tarif|nomenclature|harmonis[ée]|sh\s*\d|code.*douane/i,
      /position.*tarifaire|chapitre.*\d{2}/i,
      /\d{4}\.\d{2}\.\d{2}/,  // Format HS code
    ],
    contentIndicators: ["code", "libellé", "position", "sous-position", "droits", "taxes"],
  },
  kb_chunks_omd: {
    name: "Notes explicatives OMD",
    patterns: [
      /omd|notes?\s+explicative|world\s+customs/i,
      /organisation\s+mondiale\s+douanes/i,
    ],
    contentIndicators: ["note", "classification", "règle", "interprétation"],
    source: "omd",
  },
  kb_chunks_maroc: {
    name: "Réglementation douanière marocaine",
    patterns: [
      /maroc|adii|douane\s+maroc|royaume/i,
      /décision.*douanière|circulaire.*douane/i,
    ],
    contentIndicators: ["adii", "royaume", "marocain", "import", "export"],
    source: "maroc",
  },
  kb_chunks_lois: {
    name: "Lois de finances",
    patterns: [
      /loi\s+de\s+finance|dahir|décret|bulletin\s+officiel/i,
      /fiscalit[ée]|tva|droit.*import|exon[ée]ration/i,
    ],
    contentIndicators: ["article", "loi", "décret", "dahir", "exonération"],
    source: "lois",
  },
  dum_records: {
    name: "Historique DUM",
    patterns: [
      /dum|déclaration.*unique|marchandise|transitaire/i,
      /import.*export.*historique|opération.*douanière/i,
    ],
    contentIndicators: ["déclaration", "opération", "import", "export", "transitaire"],
  },
  finance_law_articles: {
    name: "Articles de lois de finances",
    patterns: [
      /article\s+\d+|loi\s+\d{4}|code\s+général\s+imp[ôo]t/i,
    ],
    contentIndicators: ["article", "alinéa", "paragraphe", "disposition"],
  },
};

interface FileAnalysis {
  detectedType: string;
  targetDatabase: string;
  confidence: number;
  suggestedSource?: string;
  extractedData?: any;
  summary: string;
  contentPreview: string;
}

async function analyzeWithAI(content: string, filename: string): Promise<FileAnalysis> {
  // First do pattern-based detection
  let bestMatch = { type: "unknown", database: "kb_chunks", confidence: 0, source: undefined as string | undefined };
  
  for (const [dbKey, config] of Object.entries(DATABASE_TARGETS)) {
    let score = 0;
    
    // Check filename patterns
    for (const pattern of config.patterns) {
      if (pattern.test(filename)) score += 30;
      if (pattern.test(content)) score += 20;
    }
    
    // Check content indicators
    const lowerContent = content.toLowerCase();
    for (const indicator of config.contentIndicators) {
      if (lowerContent.includes(indicator.toLowerCase())) score += 10;
    }
    
    if (score > bestMatch.confidence) {
      bestMatch = {
        type: config.name,
        database: dbKey,
        confidence: Math.min(score, 100),
        source: (config as any).source,
      };
    }
  }

  // If confidence is low, use AI for deeper analysis
  if (bestMatch.confidence < 50 && LOVABLE_API_KEY) {
    try {
      const aiResponse = await fetch("https://api.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Tu es un expert en classification de documents douaniers et commerciaux.
              
Types de documents possibles:
1. hs_codes - Nomenclature douanière, codes SH, tarifs
2. kb_chunks_omd - Notes explicatives de l'OMD
3. kb_chunks_maroc - Réglementation douanière marocaine
4. kb_chunks_lois - Lois de finances, dahirs, décrets
5. dum_records - Historique des DUM (déclarations douanières)
6. finance_law_articles - Articles de lois de finances

Réponds en JSON: {"type": "nom du type", "database": "clé", "confidence": 0-100, "source": "omd|maroc|lois|dum|null", "summary": "résumé court"}`
            },
            {
              role: "user",
              content: `Fichier: ${filename}\n\nContenu (extrait):\n${content.slice(0, 3000)}`
            }
          ],
          max_tokens: 500,
          temperature: 0.2,
        }),
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const aiText = aiData.choices?.[0]?.message?.content || "";
        
        // Parse AI response
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.confidence > bestMatch.confidence) {
            bestMatch = {
              type: parsed.type || bestMatch.type,
              database: parsed.database || bestMatch.database,
              confidence: parsed.confidence || bestMatch.confidence,
              source: parsed.source || bestMatch.source,
            };
          }
        }
      }
    } catch (e) {
      console.error("[analyze-file] AI analysis error:", e);
    }
  }

  return {
    detectedType: bestMatch.type,
    targetDatabase: bestMatch.database,
    confidence: bestMatch.confidence / 100,
    suggestedSource: bestMatch.source,
    summary: `Document classé comme "${bestMatch.type}" avec ${bestMatch.confidence}% de confiance`,
    contentPreview: content.slice(0, 500),
  };
}

async function processAndStore(
  supabase: any,
  analysis: FileAnalysis,
  content: string,
  filename: string,
  userId: string
): Promise<{ success: boolean; recordsCreated: number; error?: string }> {
  const versionLabel = new Date().toISOString().split("T")[0];
  let recordsCreated = 0;

  try {
    // For kb_chunks sources
    if (analysis.targetDatabase.startsWith("kb_chunks")) {
      const source = analysis.suggestedSource || "maroc";
      
      // Chunk the content
      const chunks = chunkText(content, filename, 1000, 200);
      
      if (chunks.length > 0) {
        const records = chunks.map((chunk, idx) => ({
          source,
          doc_id: filename,
          ref: `${filename} [${idx + 1}]`,
          text: chunk,
          version_label: versionLabel,
        }));

        const { error } = await supabase.from("kb_chunks").insert(records);
        if (error) throw error;
        
        recordsCreated = chunks.length;
      }
    }
    // For HS codes (requires specific format)
    else if (analysis.targetDatabase === "hs_codes") {
      // Try to extract HS codes from content
      const hsCodePattern = /(\d{4}[\.\s]?\d{2}[\.\s]?\d{2}[\.\s]?\d{2})\s*[-–:]\s*(.+?)(?=\n\d{4}|$)/gs;
      let match;
      const records = [];
      
      while ((match = hsCodePattern.exec(content)) !== null) {
        const code10 = match[1].replace(/[\.\s]/g, '').padEnd(10, '0');
        const label = match[2].trim();
        
        records.push({
          code_10: code10,
          code_6: code10.slice(0, 6),
          code_4: code10.slice(0, 4),
          chapter_2: code10.slice(0, 2),
          label_fr: label.slice(0, 500),
          active: true,
          active_version_label: versionLabel,
        });
      }

      if (records.length > 0) {
        const { error } = await supabase
          .from("hs_codes")
          .upsert(records, { onConflict: "code_10" });
        if (error) throw error;
        recordsCreated = records.length;
      } else {
        // If no structured data, store as kb_chunk
        const chunks = chunkText(content, filename, 1000, 200);
        const kbRecords = chunks.map((chunk, idx) => ({
          source: "maroc",
          doc_id: filename,
          ref: `${filename} [${idx + 1}]`,
          text: chunk,
          version_label: versionLabel,
        }));
        
        const { error } = await supabase.from("kb_chunks").insert(kbRecords);
        if (error) throw error;
        recordsCreated = chunks.length;
      }
    }
    // For finance law articles
    else if (analysis.targetDatabase === "finance_law_articles") {
      // Extract articles
      const articlePattern = /Article\s+(\d+[\.\-]?\d*)\s*[:\-]?\s*([\s\S]*?)(?=Article\s+\d|$)/gi;
      let match;
      const records = [];
      
      while ((match = articlePattern.exec(content)) !== null) {
        records.push({
          ref: `Article ${match[1]}`,
          title: `Article ${match[1]}`,
          text: match[2].trim().slice(0, 10000),
          version_label: versionLabel,
        });
      }

      if (records.length > 0) {
        const { error } = await supabase.from("finance_law_articles").insert(records);
        if (error) throw error;
        recordsCreated = records.length;
      } else {
        // Store as kb_chunk with lois source
        const chunks = chunkText(content, filename, 1000, 200);
        const kbRecords = chunks.map((chunk, idx) => ({
          source: "lois",
          doc_id: filename,
          ref: `${filename} [${idx + 1}]`,
          text: chunk,
          version_label: versionLabel,
        }));
        
        const { error } = await supabase.from("kb_chunks").insert(kbRecords);
        if (error) throw error;
        recordsCreated = chunks.length;
      }
    }
    // Default: store as kb_chunk
    else {
      const source = analysis.suggestedSource || "maroc";
      const chunks = chunkText(content, filename, 1000, 200);
      
      const records = chunks.map((chunk, idx) => ({
        source,
        doc_id: filename,
        ref: `${filename} [${idx + 1}]`,
        text: chunk,
        version_label: versionLabel,
      }));

      const { error } = await supabase.from("kb_chunks").insert(records);
      if (error) throw error;
      recordsCreated = chunks.length;
    }

    // Trigger embedding generation
    try {
      await supabase.functions.invoke("generate-embeddings", {
        body: { batch_size: 50 },
      });
    } catch (e) {
      console.log("[analyze-file] Embeddings will be generated later");
    }

    return { success: true, recordsCreated };
  } catch (e) {
    console.error("[analyze-file] Storage error:", e);
    return { 
      success: false, 
      recordsCreated: 0, 
      error: e instanceof Error ? e.message : "Erreur de stockage" 
    };
  }
}

function chunkText(content: string, docId: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const cleanContent = content.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  
  if (cleanContent.length <= chunkSize) {
    return [cleanContent];
  }

  let start = 0;
  while (start < cleanContent.length) {
    let end = start + chunkSize;
    
    // Find natural break point
    if (end < cleanContent.length) {
      const lastPeriod = cleanContent.lastIndexOf(".", end);
      const lastNewline = cleanContent.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      
      if (breakPoint > start + chunkSize / 2) {
        end = breakPoint + 1;
      }
    }
    
    chunks.push(cleanContent.slice(start, end).trim());
    start = end - overlap;
  }
  
  return chunks.filter(c => c.length > 50);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Token invalide" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "manager"])
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Accès refusé" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, content, filename, file_url } = body;

    // Action: analyze - just detect type
    if (action === "analyze") {
      const analysis = await analyzeWithAI(content || "", filename || "document");
      
      return new Response(JSON.stringify(analysis), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: process - analyze and store
    if (action === "process") {
      const analysis = await analyzeWithAI(content || "", filename || "document");
      const result = await processAndStore(supabase, analysis, content || "", filename || "document", user.id);
      
      return new Response(JSON.stringify({
        ...analysis,
        ...result,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Action non supportée" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[analyze-file] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur serveur" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
