import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticateRequest, createServiceClient } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { 
  extractPDFMultiPage, 
  extractTextFromPDF,
  validateHSCode,
  deduplicateHSCodes,
  type ExtractedHSCode,
  type PDFExtractionResult,
  type HSCodeValidation,
} from "../_shared/pdf-ocr.ts";

// ============================================================================
// TARGET DATABASES AND DETECTION PATTERNS
// ============================================================================

const DATABASE_TARGETS = {
  hs_codes: {
    name: "Codes HS / Nomenclature douanière",
    patterns: [
      /tarif|nomenclature|harmonis[ée]|sh\s*\d|code.*douane/i,
      /position.*tarifaire|chapitre.*\d{2}/i,
      /\d{4}\.\d{2}\.\d{2}/,
      /produits?\s+contr[ôo]l[ée]s|origine|certificat/i,
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

// ============================================================================
// TYPES
// ============================================================================

interface FileAnalysis {
  detectedType: string;
  targetDatabase: string;
  confidence: number;
  suggestedSource?: string;
  extractedData?: any;
  summary: string;
  contentPreview: string;
  pdfExtractionStats?: {
    total_pages: number;
    pages_processed: number;
    pages_failed: number;
    codes_extracted: number;
    extraction_quality: number;
    processing_time_ms: number;
  };
}

// ============================================================================
// PDF PROCESSING - Now uses shared pdf-ocr module
// ============================================================================

// Fallback text extraction when no PDF OCR result available
async function extractHSCodesFromTextContent(content: string, _filename: string): Promise<ExtractedHSCode[]> {
  const codes: ExtractedHSCode[] = [];
  const hsCodePattern = /(\d{4}[\.\s]?\d{2}[\.\s]?\d{2}[\.\s]?\d{2}[\.\s]?\d{0,4})\s*[|\-:]\s*([^|\n]{10,200})/g;
  
  let match;
  while ((match = hsCodePattern.exec(content)) !== null) {
    const cleanCode = match[1].replace(/\D/g, '');
    if (cleanCode.length >= 6) {
      const code_10 = cleanCode.padEnd(10, '0').slice(0, 10);
      const chapter = parseInt(code_10.slice(0, 2), 10);
      
      if (chapter >= 1 && chapter <= 99) {
        const hsCode: ExtractedHSCode = {
          code_10,
          code_14: cleanCode.length >= 14 ? cleanCode.slice(0, 14) : undefined,
          label_fr: match[2].trim(),
        };
        
        const validation = validateHSCode(hsCode);
        if (validation.isValid) {
          codes.push(hsCode);
        }
      }
    }
  }
  
  return deduplicateHSCodes(codes);
}

// Store last PDF extraction result for use in processAndStore
let lastPDFExtractionResult: PDFExtractionResult | null = null;

async function processPDFWithMultiPageOCR(
  base64Content: string, 
  filename: string
): Promise<{ pages: string[]; fullText: string; extractionResult: PDFExtractionResult }> {
  console.log(`[analyze-file] Starting multi-page PDF extraction: ${filename}`);
  
  const extractionResult = await extractPDFMultiPage(base64Content, filename);
  
  // Store for later use in processAndStore
  lastPDFExtractionResult = extractionResult;
  
  // Log extraction stats
  console.log(`[analyze-file] PDF extraction complete:`);
  console.log(`  - Pages: ${extractionResult.pages_processed}/${extractionResult.total_pages}`);
  console.log(`  - HS codes: ${extractionResult.unique_hs_codes.length} unique (${extractionResult.all_hs_codes.length} total)`);
  console.log(`  - Quality: ${extractionResult.extraction_quality.estimated_accuracy * 100}%`);
  console.log(`  - Time: ${extractionResult.processing_time_ms}ms`);
  
  // Split text by page markers
  const pages = extractionResult.page_results
    .filter(p => p.success)
    .map(p => p.text);
  
  return {
    pages,
    fullText: extractionResult.full_text,
    extractionResult,
  };
}

// Extract HS codes from a single page/chunk with retry logic
async function extractHSCodesFromChunk(
  content: string, 
  filename: string, 
  chunkIndex: number,
  retryCount: number = 0
): Promise<ExtractedHSCode[]> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    return [];
  }

  const MAX_RETRIES = 2;
  const MAX_CONTENT = 40000; // Increased chunk size
  const contentToProcess = content.length > MAX_CONTENT ? content.slice(0, MAX_CONTENT) : content;

  try {
    console.log(`[analyze-file] Extracting HS codes from chunk ${chunkIndex + 1} (retry: ${retryCount})`);
    
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

FORMAT MAROCAIN - La colonne "Codification" contient 5 sous-colonnes formant un code jusqu'à 14 chiffres:
- Position: 4 chiffres (ex: 0101)
- Sous-position: 2 chiffres (ex: 21)
- Extension: 2 chiffres (ex: 00)
- Extension nationale: 2 chiffres (ex: 10)
- Extension marocaine: 4 chiffres (ex: 0000) - OPTIONNEL

RÈGLES CRITIQUES:
1. Extrait TOUS les codes, même ceux avec tirets "- - -"
2. Le code COMPLET peut avoir 6, 8, 10 ou 14 chiffres
3. Retire points/espaces pour le code numérique
4. "EX" = préfixe d'exception, retire-le
5. Ignore les lignes SANS code numérique (titres)
6. Les libellés avec tirets sont des sous-catégories valides
7. Extrait l'unité: u, kg, l, m, m2, m3, etc.
8. Extrait le taux de droit (pourcentage)
9. Les notes (a), (b), (1) sont des restrictions à capturer

VALIDATION:
- Chapitre (2 premiers chiffres): 01 à 99
- Sous-position (6 premiers chiffres): doit être logique
- Si un code semble incorrect, vérifie le contexte

IMPORTANT: Ne rate AUCUN code. Mieux vaut extraire un code douteux que de le manquer.`
          },
          {
            role: "user",
            content: `Extrait tous les codes HS de cette section (partie ${chunkIndex + 1}):\n\n${contentToProcess}`
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
                          description: "Code tel qu'extrait (avec ou sans points/espaces)" 
                        },
                        label_fr: { 
                          type: "string", 
                          description: "Désignation du produit en français (inclure les tirets de sous-catégorie)" 
                        },
                        unit: {
                          type: "string",
                          description: "Unité de mesure (u, kg, l, m, m2, etc.)"
                        },
                        droit: {
                          type: "number",
                          description: "Taux de droit de douane en pourcentage"
                        },
                        notes: {
                          type: "string",
                          description: "Notes de restriction ou références (a), (b), (1), etc."
                        }
                      },
                      required: ["code_raw", "label_fr"]
                    }
                  },
                  extraction_quality: {
                    type: "object",
                    properties: {
                      total_lines_analyzed: { type: "number" },
                      codes_found: { type: "number" },
                      potential_missed: { type: "number" },
                      notes: { type: "string" }
                    }
                  }
                },
                required: ["codes"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_hs_codes" } },
        max_tokens: 32000,
        temperature: 0.05,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[analyze-file] Lovable AI error for HS extraction:", response.status, errorText);
      
      if (response.status === 429 && retryCount < MAX_RETRIES) {
        // Wait and retry on rate limit
        await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
        return extractHSCodesFromChunk(content, filename, chunkIndex, retryCount + 1);
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
        const quality = parsed.extraction_quality;
        
        if (quality) {
          console.log(`[analyze-file] Chunk ${chunkIndex + 1} quality: ${quality.codes_found}/${quality.total_lines_analyzed} codes, potential missed: ${quality.potential_missed || 0}`);
        }
        
        // Process and validate codes
        const processedCodes: ExtractedHSCode[] = [];
        
        for (const c of codes) {
          if (!c.code_raw || !c.label_fr) continue;
          
          // Clean and normalize code
          const cleanCode = c.code_raw.replace(/\D/g, '');
          
          // Skip if too short
          if (cleanCode.length < 6) continue;
          
          // Determine code_10 and code_14
          let code_10: string;
          let code_14: string | undefined;
          
          if (cleanCode.length >= 14) {
            code_14 = cleanCode.slice(0, 14);
            code_10 = cleanCode.slice(0, 10);
          } else if (cleanCode.length > 10) {
            code_14 = cleanCode.padEnd(14, '0').slice(0, 14);
            code_10 = cleanCode.slice(0, 10);
          } else if (cleanCode.length >= 6) {
            code_10 = cleanCode.padEnd(10, '0').slice(0, 10);
            code_14 = undefined;
          } else {
            continue;
          }
          
          const hsCode: ExtractedHSCode = {
            code_10,
            code_14,
            label_fr: c.label_fr.trim(),
            unit: c.unit?.trim(),
            droit: typeof c.droit === 'number' ? c.droit : undefined,
            notes: c.notes?.trim()
          };
          
          // Validate
          const validation = validateHSCode(hsCode);
          
          if (validation.isValid) {
            processedCodes.push(hsCode);
          } else {
            console.log(`[analyze-file] Skipping invalid code ${code_10}: ${validation.errors.join(', ')}`);
          }
          
          if (validation.warnings.length > 0) {
            console.log(`[analyze-file] Warnings for ${code_10}: ${validation.warnings.join(', ')}`);
          }
        }
        
        console.log(`[analyze-file] Chunk ${chunkIndex + 1}: ${processedCodes.length} valid codes extracted`);
        
        // Retry if few codes found and content seems substantial
        if (processedCodes.length < 3 && content.length > 1000 && retryCount < MAX_RETRIES) {
          console.log(`[analyze-file] Few codes found, retrying chunk ${chunkIndex + 1}`);
          const retryResult = await extractHSCodesFromChunk(content, filename, chunkIndex, retryCount + 1);
          if (retryResult.length > processedCodes.length) {
            return retryResult;
          }
        }
        
        return processedCodes;
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

// Main extraction function with multi-page support
async function extractHSCodesWithAI(content: string, filename: string): Promise<ExtractedHSCode[]> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    console.log("[analyze-file] No LOVABLE_API_KEY, cannot extract HS codes with AI");
    return [];
  }

  try {
    console.log(`[analyze-file] Starting HS code extraction: ${filename}`);
    
    // Split content into chunks for better processing
    const CHUNK_SIZE = 35000; // Characters per chunk
    const OVERLAP = 2000; // Overlap between chunks to catch codes at boundaries
    
    const chunks: string[] = [];
    
    if (content.length <= CHUNK_SIZE) {
      chunks.push(content);
    } else {
      let start = 0;
      while (start < content.length) {
        let end = Math.min(start + CHUNK_SIZE, content.length);
        
        // Try to find a natural break point
        if (end < content.length) {
          const lastNewline = content.lastIndexOf('\n', end);
          const lastPipe = content.lastIndexOf('|', end);
          const breakPoint = Math.max(lastNewline, lastPipe);
          
          if (breakPoint > start + CHUNK_SIZE / 2) {
            end = breakPoint + 1;
          }
        }
        
        chunks.push(content.slice(start, end));
        start = end - OVERLAP;
      }
    }
    
    console.log(`[analyze-file] Processing ${chunks.length} chunk(s)`);
    
    // Process chunks in parallel with concurrency limit
    const CONCURRENCY = 3;
    const allCodes: ExtractedHSCode[] = [];
    
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((chunk, idx) => extractHSCodesFromChunk(chunk, filename, i + idx))
      );
      
      for (const codes of results) {
        allCodes.push(...codes);
      }
      
      // Small delay between batches to avoid rate limits
      if (i + CONCURRENCY < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Deduplicate by code_10 (prefer entries with code_14 and more metadata)
    const uniqueCodes = new Map<string, ExtractedHSCode>();
    
    for (const code of allCodes) {
      const existing = uniqueCodes.get(code.code_10);
      
      if (!existing) {
        uniqueCodes.set(code.code_10, code);
      } else {
        // Keep the one with more metadata
        let existingScore = 0;
        let newScore = 0;
        
        if (existing.code_14) existingScore += 2;
        if (existing.unit) existingScore += 1;
        if (existing.droit !== undefined) existingScore += 1;
        if (existing.notes) existingScore += 1;
        if (existing.label_fr.length > 20) existingScore += 1;
        
        if (code.code_14) newScore += 2;
        if (code.unit) newScore += 1;
        if (code.droit !== undefined) newScore += 1;
        if (code.notes) newScore += 1;
        if (code.label_fr.length > 20) newScore += 1;
        
        if (newScore > existingScore) {
          uniqueCodes.set(code.code_10, code);
        }
      }
    }
    
    const finalCodes = Array.from(uniqueCodes.values());
    console.log(`[analyze-file] Total: ${allCodes.length} codes extracted, ${finalCodes.length} unique after deduplication`);
    
    return finalCodes;
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
  _userId: string,
  pdfExtractionResult?: PDFExtractionResult
): Promise<{ success: boolean; recordsCreated: number; error?: string; validationStats?: any }> {
  const versionLabel = new Date().toISOString().split("T")[0];
  let recordsCreated = 0;
  let validationStats = { valid: 0, invalid: 0, warnings: 0 };

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
    // For HS codes - use pre-extracted codes from PDF if available
    else if (analysis.targetDatabase === "hs_codes") {
      let extractedCodes: ExtractedHSCode[] = [];
      
      // Use pre-extracted codes from PDF multi-page OCR if available
      if (pdfExtractionResult && pdfExtractionResult.unique_hs_codes.length > 0) {
        extractedCodes = pdfExtractionResult.unique_hs_codes;
        console.log(`[analyze-file] Using ${extractedCodes.length} pre-extracted HS codes from PDF OCR`);
        
        // Log extraction quality
        const quality = pdfExtractionResult.extraction_quality;
        console.log(`[analyze-file] Extraction quality: ${quality.estimated_accuracy * 100}%, ${quality.codes_per_page} codes/page`);
      } else {
        // Fallback: extract from text content
        console.log(`[analyze-file] No pre-extracted codes, falling back to text extraction`);
        extractedCodes = await extractHSCodesFromTextContent(content, filename);
      }
      
      if (extractedCodes.length > 0) {
        // Build records for insertion
        const records = extractedCodes.map(code => ({
          code_10: code.code_10,
          code_14: code.code_14 || null,
          code_6: code.code_10.slice(0, 6),
          chapter_2: code.code_10.slice(0, 2),
          label_fr: code.label_fr.slice(0, 500),
          unit: code.unit || null,
          taxes: code.droit !== undefined ? { droit_import: code.droit } : null,
          restrictions: code.notes ? [code.notes] : null,
          active: true,
          active_version_label: versionLabel,
        }));

        const { error } = await supabase
          .from("hs_codes")
          .upsert(records, { onConflict: "code_10" });
        if (error) throw error;
        
        recordsCreated = records.length;
        validationStats.valid = records.length;
        
        console.log(`[analyze-file] Stored ${recordsCreated} HS codes with enhanced multi-page extraction`);
      } else {
        // Fallback: try regex patterns for HS codes
        const hsCodePattern = /\b(\d{6,14})\b/g;
        const foundCodes = new Set<string>();
        let match;
        
        while ((match = hsCodePattern.exec(content)) !== null) {
          const code = match[1].padEnd(10, '0').slice(0, 10);
          const chapter = parseInt(code.slice(0, 2), 10);
          if (code.length === 10 && chapter >= 1 && chapter <= 99) {
            foundCodes.add(code);
          }
        }
        
        if (foundCodes.size > 0) {
          const records = Array.from(foundCodes).map(code => ({
            code_10: code,
            code_6: code.slice(0, 6),
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
          console.log(`[analyze-file] Extracted ${recordsCreated} HS codes via regex fallback`);
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

    return { success: true, recordsCreated, validationStats };
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
    const body = await req.json();
    
    // Allow test mode for development (no auth required for action=test-ocr)
    const isTestMode = body.action === "test-ocr";
    
    let user = { id: "test-user" };
    
    if (!isTestMode) {
      // Authenticate with custom JWT for production endpoints
      const authResult = await authenticateRequest(req, { requireRole: ["admin", "manager"] });
      if (!authResult.success) {
        return authResult.error;
      }
      user = authResult.data.user;
    }
    
    const supabase = createServiceClient();

    let { action, content, filename, targetDatabase } = body;

    // Check if content is base64-encoded PDF
    let processedContent = content || "";
    let pdfExtractionResult: PDFExtractionResult | null = null;
    
    if (processedContent.startsWith("[BASE64_FILE:")) {
      const typeMatch = processedContent.match(/\[BASE64_FILE:([^\]]+)\]/);
      const fileType = typeMatch?.[1] || "";
      const base64Data = processedContent.replace(/\[BASE64_FILE:[^\]]+\]/, "");
      
      if (fileType.includes("pdf") || filename?.toLowerCase().endsWith(".pdf")) {
        console.log(`[analyze-file] Processing PDF with multi-page OCR: ${filename}`);
        const result = await processPDFWithMultiPageOCR(base64Data, filename || "document.pdf");
        processedContent = result.fullText;
        pdfExtractionResult = result.extractionResult;
        console.log(`[analyze-file] PDF extracted: ${processedContent.length} chars, ${result.extractionResult.unique_hs_codes.length} HS codes, ${result.pages.length} page(s)`);
      } else {
        // For other binary files, try to decode base64 as text
        try {
          processedContent = atob(base64Data);
        } catch {
          processedContent = `[Fichier binaire: ${filename}]`;
        }
      }
    }

    // Action: test-ocr - test OCR pipeline without auth (dev only)
    if (action === "test-ocr") {
      const testUrl = body.file_url || body.url;
      
      if (!testUrl && !content) {
        return new Response(JSON.stringify({ 
          error: "Fournir file_url ou content (base64)" 
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      let pdfBase64 = content || "";
      
      // Fetch PDF from URL if provided
      if (testUrl) {
        console.log(`[test-ocr] Fetching PDF from: ${testUrl}`);
        const response = await fetch(testUrl);
        if (!response.ok) {
          return new Response(JSON.stringify({ 
            error: `Impossible de télécharger: ${response.status}` 
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const buffer = await response.arrayBuffer();
        pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      }
      
      console.log(`[test-ocr] Processing PDF (${pdfBase64.length} base64 chars)`);
      
      const result = await processPDFWithMultiPageOCR(pdfBase64, filename || "test.pdf");
      
      return new Response(JSON.stringify({
        success: true,
        extraction_stats: {
          total_pages: result.extractionResult.total_pages,
          pages_processed: result.extractionResult.pages_processed,
          pages_failed: result.extractionResult.pages_failed,
          codes_extracted: result.extractionResult.unique_hs_codes.length,
          extraction_quality: result.extractionResult.extraction_quality,
          processing_time_ms: result.extractionResult.processing_time_ms,
        },
        hs_codes: result.extractionResult.unique_hs_codes.slice(0, 50), // First 50 for preview
        full_text_preview: result.fullText.slice(0, 2000),
        pages_preview: result.extractionResult.page_results.slice(0, 3).map(p => ({
          page: p.page_number,
          text_length: p.text.length,
          codes_found: p.hs_codes.length,
          success: p.success,
        })),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: analyze - just detect type
    if (action === "analyze") {
      const analysis = await analyzeWithAI(processedContent, filename || "document");
      
      // Add PDF extraction stats if available
      if (pdfExtractionResult) {
        analysis.pdfExtractionStats = {
          total_pages: pdfExtractionResult.total_pages,
          pages_processed: pdfExtractionResult.pages_processed,
          pages_failed: pdfExtractionResult.pages_failed,
          codes_extracted: pdfExtractionResult.unique_hs_codes.length,
          extraction_quality: pdfExtractionResult.extraction_quality.estimated_accuracy,
          processing_time_ms: pdfExtractionResult.processing_time_ms,
        };
      }
      
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
      
      // Pass PDF extraction result for optimized HS code storage
      const result = await processAndStore(
        supabase, 
        analysis, 
        processedContent, 
        filename || "document", 
        user.id,
        pdfExtractionResult || undefined
      );
      
      // Add PDF stats to response
      if (pdfExtractionResult) {
        analysis.pdfExtractionStats = {
          total_pages: pdfExtractionResult.total_pages,
          pages_processed: pdfExtractionResult.pages_processed,
          pages_failed: pdfExtractionResult.pages_failed,
          codes_extracted: pdfExtractionResult.unique_hs_codes.length,
          extraction_quality: pdfExtractionResult.extraction_quality.estimated_accuracy,
          processing_time_ms: pdfExtractionResult.processing_time_ms,
        };
      }
      
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
