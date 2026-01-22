import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticateRequest, createServiceClient } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// Target databases and their detection patterns
const DATABASE_TARGETS = {
  hs_codes: {
    name: "Codes HS / Nomenclature douanière",
    patterns: [
      /tarif|nomenclature|harmonis[ée]|sh\s*\d|code.*douane/i,
      /position.*tarifaire|chapitre.*\d{2}/i,
      /\d{4}\.\d{2}\.\d{2}/,  // Format HS code
      /produits?\s+contr[ôo]l[ée]s|origine|certificat/i, // Controlled products
    ],
    contentIndicators: ["code", "libellé", "position", "sous-position", "droits", "taxes", "origine", "contrôlé"],
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

// Extract text from base64 PDF using Lovable AI Gateway
async function extractTextFromPDF(base64Content: string, filename: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    console.log("[analyze-file] No LOVABLE_API_KEY, cannot process PDF");
    return `[PDF non traité: ${filename}]`;
  }

  try {
    console.log(`[analyze-file] Extracting text from PDF: ${filename}`);
    
    // Use Lovable AI Gateway with Gemini vision model
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extrait et transcris TOUT le texte de ce document PDF. 
                
IMPORTANT:
- Extrait le texte tel quel, sans résumer ni reformuler
- Préserve la structure (tableaux, listes, colonnes)
- Si c'est une liste de codes HS ou de produits, extrait chaque ligne avec son code et son libellé
- Format de sortie: texte brut, un élément par ligne
- Si tu vois des codes numériques (comme 0101.21.00), garde-les exactement

Commence directement l'extraction sans introduction.`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:application/pdf;base64,${base64Content}`
                }
              }
            ]
          }
        ],
        max_tokens: 16000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[analyze-file] Lovable AI error:", response.status, errorText);
      if (response.status === 429) {
        throw new Error("Rate limit exceeded - please try again later");
      }
      if (response.status === 402) {
        throw new Error("Payment required - please add credits to your workspace");
      }
      throw new Error(`Lovable AI error: ${response.status}`);
    }

    const data = await response.json();
    const extractedText = data.choices?.[0]?.message?.content || "";
    
    console.log(`[analyze-file] Extracted ${extractedText.length} chars from PDF`);
    
    return extractedText;
  } catch (e) {
    console.error("[analyze-file] PDF extraction error:", e);
    return `[Erreur extraction PDF: ${filename}]`;
  }
}

// Interface for extracted HS codes with Moroccan 14-digit extension
interface ExtractedHSCode {
  code_10: string;
  code_14?: string;
  label_fr: string;
  unit?: string;
  droit?: number;
}

// Extract HS codes using AI with tool calling for structured output
async function extractHSCodesWithAI(content: string, filename: string): Promise<ExtractedHSCode[]> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    console.log("[analyze-file] No LOVABLE_API_KEY, cannot extract HS codes with AI");
    return [];
  }

  try {
    console.log(`[analyze-file] Extracting HS codes from document: ${filename}`);
    
    // Split content into chunks if too large
    const MAX_CONTENT = 30000;
    const contentToProcess = content.length > MAX_CONTENT ? content.slice(0, MAX_CONTENT) : content;
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            content: `Tu es un expert en nomenclature douanière marocaine. Extrait TOUS les codes HS de ce document.

FORMAT MAROCAIN - La colonne "Codification" contient 5 sous-colonnes formant un code à 14 chiffres:
- Colonne 1: 4 chiffres (position HS internationale, ex: 0101)
- Colonne 2: 2 chiffres (sous-position, ex: 21)
- Colonne 3: 2 chiffres (extension, ex: 00)
- Colonne 4: 2 chiffres (extension nationale, ex: 00)
- Colonne 5: 4 chiffres (extension marocaine, ex: 0000) - OPTIONNEL

RÈGLES:
- Extrait le code COMPLET tel qu'il apparaît (jusqu'à 14 chiffres si disponible)
- Si le code n'a que 10 chiffres, c'est normal (code_14 sera null)
- Retire les points et espaces pour obtenir le code numérique
- Pour chaque code, extrait aussi le libellé, l'unité et le taux de droit si disponible
- Ignore les lignes de titre sans code numérique
- Si un code commence par "EX", retire le EX mais garde le code`
          },
          {
            role: "user",
            content: `Extrait tous les codes HS de ce document tarifaire marocain:\n\n${contentToProcess}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_hs_codes",
              description: "Extrait les codes HS marocains et leurs métadonnées",
              parameters: {
                type: "object",
                properties: {
                  codes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        code_raw: { 
                          type: "string", 
                          description: "Code tel qu'extrait du document (avec ou sans points/espaces)" 
                        },
                        label_fr: { 
                          type: "string", 
                          description: "Désignation ou libellé du produit en français" 
                        },
                        unit: {
                          type: "string",
                          description: "Unité de mesure (u, kg, l, etc.)"
                        },
                        droit: {
                          type: "number",
                          description: "Taux de droit de douane en pourcentage"
                        }
                      },
                      required: ["code_raw", "label_fr"]
                    }
                  }
                },
                required: ["codes"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_hs_codes" } },
        max_tokens: 16000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[analyze-file] Lovable AI error for HS extraction:", response.status, errorText);
      if (response.status === 429) {
        console.error("[analyze-file] Rate limit exceeded");
      }
      if (response.status === 402) {
        console.error("[analyze-file] Payment required");
      }
      return [];
    }

    const data = await response.json();
    
    // Extract from tool call
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        const codes = parsed.codes || [];
        
        // Validate and normalize codes
        const validCodes: ExtractedHSCode[] = codes
          .filter((c: any) => c.code_raw && c.label_fr)
          .map((c: any) => {
            // Remove all non-digits
            const cleanCode = c.code_raw.replace(/\D/g, '');
            
            // Determine code_10 and code_14
            let code_10: string;
            let code_14: string | undefined;
            
            if (cleanCode.length >= 14) {
              // Full 14-digit Moroccan code
              code_14 = cleanCode.slice(0, 14);
              code_10 = cleanCode.slice(0, 10);
            } else if (cleanCode.length > 10) {
              // Between 10 and 14 digits - pad to 14
              code_14 = cleanCode.padEnd(14, '0').slice(0, 14);
              code_10 = cleanCode.slice(0, 10);
            } else if (cleanCode.length >= 6) {
              // Standard code - normalize to 10 digits
              code_10 = cleanCode.padEnd(10, '0').slice(0, 10);
              code_14 = undefined;
            } else {
              // Too short, skip
              return null;
            }
            
            return {
              code_10,
              code_14,
              label_fr: c.label_fr.trim(),
              unit: c.unit?.trim(),
              droit: typeof c.droit === 'number' ? c.droit : undefined
            };
          })
          .filter((c: any) => {
            if (!c) return false;
            // Validate: chapter should be 01-99
            const chapter = parseInt(c.code_10.slice(0, 2), 10);
            return c.code_10.length === 10 && chapter >= 1 && chapter <= 99;
          });
        
        console.log(`[analyze-file] AI extracted ${validCodes.length} valid HS codes (with code_14 support)`);
        return validCodes;
      } catch (e) {
        console.error("[analyze-file] Error parsing HS codes response:", e);
        return [];
      }
    }
    
    return [];
  } catch (e) {
    console.error("[analyze-file] HS extraction error:", e);
    return [];
  }
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
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (bestMatch.confidence < 50 && LOVABLE_API_KEY) {
    try {
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
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
  _userId: string
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
      // Use AI to extract HS codes from the document
      const extractedCodes = await extractHSCodesWithAI(content, filename);
      
      if (extractedCodes.length > 0) {
        // Deduplicate by code_10 (prefer entries with code_14)
        const uniqueCodes = new Map<string, ExtractedHSCode>();
        for (const code of extractedCodes) {
          const existing = uniqueCodes.get(code.code_10);
          // Keep the one with code_14, or the first one if neither has it
          if (!existing || (code.code_14 && !existing.code_14)) {
            uniqueCodes.set(code.code_10, code);
          }
        }
        
        const records = Array.from(uniqueCodes.values()).map(code => ({
          code_10: code.code_10,
          code_14: code.code_14 || null,
          code_6: code.code_10.slice(0, 6),
          // code_4 is a generated column, do not include it
          chapter_2: code.code_10.slice(0, 2),
          label_fr: code.label_fr.slice(0, 500),
          unit: code.unit || null,
          taxes: code.droit ? { droit_import: code.droit } : null,
          active: true,
          active_version_label: versionLabel,
        }));

        const { error } = await supabase
          .from("hs_codes")
          .upsert(records, { onConflict: "code_10" });
        if (error) throw error;
        recordsCreated = records.length;
        console.log(`[analyze-file] Extracted and stored ${recordsCreated} HS codes`);
      } else {
        // Fallback: try regex patterns for HS codes
        const hsCodePattern = /\b(\d{6,10})\b/g;
        const foundCodes = new Set<string>();
        let match;
        
        while ((match = hsCodePattern.exec(content)) !== null) {
          const code = match[1].padEnd(10, '0');
          if (code.length === 10 && !code.startsWith('0000')) {
            foundCodes.add(code);
          }
        }
        
        if (foundCodes.size > 0) {
          const records = Array.from(foundCodes).map(code => ({
            code_10: code,
            code_6: code.slice(0, 6),
            // code_4 is a generated column, do not include it
            chapter_2: code.slice(0, 2),
            label_fr: `Code HS extrait de: ${filename}`,
            active: true,
            active_version_label: versionLabel,
          }));

          const { error } = await supabase
            .from("hs_codes")
            .upsert(records, { onConflict: "code_10" });
          if (error) throw error;
          recordsCreated = records.length;
          console.log(`[analyze-file] Extracted ${recordsCreated} HS codes via regex`);
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
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate with custom JWT
    const authResult = await authenticateRequest(req, { requireRole: ["admin", "manager"] });
    if (!authResult.success) {
      return authResult.error;
    }
    
    const { user } = authResult.data;
    const supabase = createServiceClient();

    const body = await req.json();
    let { action, content, filename, targetDatabase } = body;

    // Check if content is base64-encoded PDF
    let processedContent = content || "";
    if (processedContent.startsWith("[BASE64_FILE:")) {
      const typeMatch = processedContent.match(/\[BASE64_FILE:([^\]]+)\]/);
      const fileType = typeMatch?.[1] || "";
      const base64Data = processedContent.replace(/\[BASE64_FILE:[^\]]+\]/, "");
      
      if (fileType.includes("pdf") || filename?.toLowerCase().endsWith(".pdf")) {
        console.log(`[analyze-file] Processing PDF: ${filename}`);
        processedContent = await extractTextFromPDF(base64Data, filename || "document.pdf");
        console.log(`[analyze-file] PDF extracted, got ${processedContent.length} chars`);
      } else {
        // For other binary files, try to decode base64 as text
        try {
          processedContent = atob(base64Data);
        } catch {
          processedContent = `[Fichier binaire: ${filename}]`;
        }
      }
    }

    // Action: analyze - just detect type
    if (action === "analyze") {
      const analysis = await analyzeWithAI(processedContent, filename || "document");
      
      return new Response(JSON.stringify(analysis), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: process - analyze and store
    if (action === "process") {
      // Allow overriding detected database
      let analysis = await analyzeWithAI(processedContent, filename || "document");
      if (targetDatabase && targetDatabase !== analysis.targetDatabase) {
        analysis.targetDatabase = targetDatabase;
        analysis.confidence = 1;
      }
      
      const result = await processAndStore(supabase, analysis, processedContent, filename || "document", user.id);
      
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
    const corsHeaders = getCorsHeaders(req);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur serveur" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
