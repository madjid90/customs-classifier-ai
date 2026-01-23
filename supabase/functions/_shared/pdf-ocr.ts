/**
 * PDF Multi-Page OCR Module
 * 
 * Provides real page-by-page OCR extraction with:
 * - Parallel page processing
 * - Intelligent result aggregation
 * - Smart deduplication with scoring
 * - Retry logic for failed pages
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ExtractedHSCode {
  code_10: string;
  code_14?: string;
  label_fr: string;
  unit?: string;
  droit?: number;
  notes?: string;
  page_number?: number;
  extraction_confidence?: number;
}

export interface PageExtractionResult {
  page_number: number;
  success: boolean;
  text: string;
  hs_codes: ExtractedHSCode[];
  error?: string;
  processing_time_ms: number;
}

export interface PDFExtractionResult {
  total_pages: number;
  pages_processed: number;
  pages_failed: number;
  full_text: string;
  all_hs_codes: ExtractedHSCode[];
  unique_hs_codes: ExtractedHSCode[];
  page_results: PageExtractionResult[];
  processing_time_ms: number;
  extraction_quality: {
    estimated_accuracy: number;
    codes_per_page: number;
    coverage_percent: number;
  };
}

export interface HSCodeValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Processing limits
  MAX_CONCURRENT_PAGES: 4,
  MAX_RETRIES_PER_PAGE: 2,
  DELAY_BETWEEN_BATCHES_MS: 500,
  PAGE_TIMEOUT_MS: 45000,
  
  // Content limits
  MAX_CONTENT_PER_PAGE: 50000,
  MIN_CONTENT_FOR_EXTRACTION: 100,
  
  // AI settings
  MODEL: "google/gemini-2.5-flash",
  MODEL_PRO: "google/gemini-2.5-pro", // For complex pages
  TEMPERATURE: 0.05,
  MAX_TOKENS: 32000,
};

// ============================================================================
// MOROCCAN TARIFF PROMPTS
// ============================================================================

const MOROCCAN_TARIFF_PAGE_PROMPT = `Tu es un expert OCR spécialisé dans les tarifs douaniers marocains.

CETTE PAGE fait partie du TARIF DES DROITS DE DOUANE À L'IMPORTATION du Maroc.

FORMAT DU TABLEAU:
- CODIFICATION: Code complet en une colonne (ex: "0303.14 00 00" = 10 chiffres séparés par espaces/points)
  Structure: [Position 4 chiffres].[Sous-position 2 chiffres] [Extension 2 chiffres] [Extension nationale 2 chiffres]
- DESIGNATION DES PRODUITS: Libellé en français
- DROITS: Taux de droit (nombre, ex: 10 = 10%)
- UNITE: u, kg, l, m, m2, etc.

VARIATIONS DE FORMAT OBSERVÉES:
1. Tableau standard: Codification | Désignation | Droit | Unité
2. Tableau avec tirets: Les "–" indiquent des sous-catégories hiérarchiques
3. Codes partiels dans texte: "0302.74 00" en début de ligne avec sous-codes indentés

RÈGLES CRITIQUES:
1. Le code complet peut être sur UNE SEULE COLONNE (ex: "0303.14 00 00")
2. Reconstituer code_10: retirer tous les séparateurs (points, espaces)
3. Les tirets "– – –" au début du libellé = sous-catégorie, GARDER le libellé complet
4. "EX" = exception tarifaire
5. Si le droit est "-", c'est une exemption (0%)
6. Notes (a), (b), (1) = restrictions à capturer

FORMAT DE SORTIE - Une entrée par ligne:
CODIFICATION_BRUTE | DESIGNATION | DROIT | UNITE

Exemples:
0303.14 00 00 | – – Truites (Salmo trutta...) | 10 | kg
0302.74 00 | – – Anguilles (Anguilla spp.) | - | -
10 | – – – civelles | 10 | kg

COMMENCE L'EXTRACTION DE CETTE PAGE:`;

const HS_EXTRACTION_SYSTEM_PROMPT = `Tu es un expert en nomenclature douanière marocaine. Extrait TOUS les codes HS de ce contenu.

FORMAT MAROCAIN - Codification consolidée:
Le code est souvent en UNE SEULE COLONNE: "0303.14 00 00"
- Position: 4 premiers chiffres (ex: 0303)
- Sous-position: 2 chiffres suivants (ex: 14)
- Extension: 2 chiffres (ex: 00)
- Extension nationale: 2 chiffres (ex: 00)
- code_10 = Position + Sous-position + Extension + Extension nationale = 10 chiffres

RECONSTRUCTION DU CODE:
"0303.14 00 00" → code_10 = "0303140000"
"0302.74 00" → code_10 = "0302740000" (compléter avec 00)
"15 00" (sous un code parent 0301.91) → code_10 = "0301911500"

RÈGLES ABSOLUES:
1. Code en UNE colonne avec points/espaces à retirer
2. Sous-codes héritent du préfixe du code parent
3. "-" comme droit = exemption (0%)
4. Les tirets "– – –" font partie du libellé, les garder
5. Unités valides: u, kg, l, m, m2, m3, t, g, pair/paire, 1000u

VALIDATION:
- Chapitre (2 premiers chiffres): 01 à 99
- Un code_10 valide a EXACTEMENT 10 chiffres

IMPORTANT: Extraire TOUS les codes, même partiels. Reconstruire le code complet depuis le contexte.`;

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

export function validateHSCode(code: ExtractedHSCode): HSCodeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check code_10 format
  if (!code.code_10 || !/^\d{10}$/.test(code.code_10)) {
    errors.push(`code_10 invalide: ${code.code_10}`);
  }
  
  // Check chapter (01-99)
  const chapter = parseInt(code.code_10?.slice(0, 2) || "0", 10);
  if (chapter < 1 || chapter > 99) {
    errors.push(`Chapitre invalide: ${chapter}`);
  }
  
  // Check subheading (position 6 digits)
  const subheading = code.code_10?.slice(0, 6) || "";
  if (!/^\d{6}$/.test(subheading)) {
    errors.push(`Sous-position invalide: ${subheading}`);
  }
  
  // Check code_14 if present
  if (code.code_14 && !/^\d{14}$/.test(code.code_14)) {
    errors.push(`code_14 invalide: ${code.code_14}`);
  }
  
  // Check code_14 starts with code_10
  if (code.code_14 && code.code_10 && !code.code_14.startsWith(code.code_10)) {
    warnings.push(`code_14 ne commence pas par code_10`);
  }
  
  // Check label
  if (!code.label_fr || code.label_fr.length < 3) {
    errors.push(`Libellé trop court ou manquant`);
  }
  
  if (code.label_fr && code.label_fr.length > 500) {
    warnings.push(`Libellé très long (${code.label_fr.length} chars)`);
  }
  
  // Check for suspicious patterns in label
  if (code.label_fr && /^[\d\s\.\-]+$/.test(code.label_fr)) {
    errors.push(`Libellé contient uniquement des chiffres`);
  }
  
  // Check unit if present
  const validUnits = ["u", "kg", "l", "m", "m2", "m3", "p/st", "tonne", "ct", "g", "pair", "paire", "1000u", "1000 u", "t", "kw", "kwh"];
  if (code.unit && !validUnits.includes(code.unit.toLowerCase())) {
    warnings.push(`Unité non standard: ${code.unit}`);
  }
  
  // Check duty rate
  if (code.droit !== undefined && (code.droit < 0 || code.droit > 200)) {
    warnings.push(`Taux de droit inhabituel: ${code.droit}%`);
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

// ============================================================================
// PDF PAGE ESTIMATION
// ============================================================================

/**
 * Estimate number of pages in a PDF from base64 content
 * Uses heuristics based on file size and PDF structure markers
 */
export function estimatePDFPages(base64Content: string): number {
  const sizeBytes = (base64Content.length * 3) / 4;
  
  // Count page markers in PDF structure
  const pageMarkers = (base64Content.match(/\/Page\s/g) || []).length;
  const typePageMarkers = (base64Content.match(/\/Type\s*\/Page/g) || []).length;
  
  // Use markers if found, otherwise estimate from size
  if (typePageMarkers > 0) {
    return typePageMarkers;
  }
  
  if (pageMarkers > 1) {
    return Math.ceil(pageMarkers / 2); // Rough estimate
  }
  
  // Estimate based on file size (avg 50KB per page for scanned PDFs)
  const estimatedFromSize = Math.max(1, Math.ceil(sizeBytes / 50000));
  
  return Math.min(estimatedFromSize, 100); // Cap at 100 pages
}

// ============================================================================
// SINGLE PAGE OCR
// ============================================================================

async function extractTextFromSinglePage(
  base64Content: string,
  pageNumber: number,
  totalPages: number,
  filename: string
): Promise<PageExtractionResult> {
  const startTime = Date.now();
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    return {
      page_number: pageNumber,
      success: false,
      text: "",
      hs_codes: [],
      error: "LOVABLE_API_KEY not configured",
      processing_time_ms: Date.now() - startTime,
    };
  }

  const pageInstruction = totalPages > 1 
    ? `\n\n[PAGE ${pageNumber}/${totalPages}]\n\n` 
    : "";

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CONFIG.MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${MOROCCAN_TARIFF_PAGE_PROMPT}${pageInstruction}`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Content}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: CONFIG.MAX_TOKENS,
        temperature: CONFIG.TEMPERATURE,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[pdf-ocr] Page ${pageNumber} error:`, response.status);
      
      if (response.status === 429) {
        throw new Error("RATE_LIMIT");
      }
      if (response.status === 402) {
        throw new Error("PAYMENT_REQUIRED");
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const extractedText = data.choices?.[0]?.message?.content || "";
    
    console.log(`[pdf-ocr] Page ${pageNumber}: extracted ${extractedText.length} chars`);
    
    return {
      page_number: pageNumber,
      success: true,
      text: extractedText,
      hs_codes: [], // Will be filled in post-processing
      processing_time_ms: Date.now() - startTime,
    };
  } catch (error) {
    console.error(`[pdf-ocr] Page ${pageNumber} failed:`, error);
    return {
      page_number: pageNumber,
      success: false,
      text: "",
      hs_codes: [],
      error: error instanceof Error ? error.message : "Unknown error",
      processing_time_ms: Date.now() - startTime,
    };
  }
}

// ============================================================================
// EXTRACT HS CODES FROM TEXT
// ============================================================================

async function extractHSCodesFromText(
  text: string,
  pageNumber: number,
  retryCount: number = 0
): Promise<ExtractedHSCode[]> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY || text.length < CONFIG.MIN_CONTENT_FOR_EXTRACTION) {
    return [];
  }

  const contentToProcess = text.slice(0, CONFIG.MAX_CONTENT_PER_PAGE);

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CONFIG.MODEL,
        messages: [
          {
            role: "system",
            content: HS_EXTRACTION_SYSTEM_PROMPT
          },
          {
            role: "user",
            content: `Extrait tous les codes HS de cette page (page ${pageNumber}):\n\n${contentToProcess}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_hs_codes",
              description: "Extrait les codes HS marocains et leurs métadonnées depuis le tarif douanier",
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
                          description: "Code brut tel qu'il apparaît (ex: '0303.14 00 00', '15 00', '10')" 
                        },
                        code_10_reconstructed: {
                          type: "string",
                          description: "Code 10 chiffres reconstitué si le code_raw est partiel (hérite du code parent). Ex: si parent est 0301.91 et code_raw est '15 00', alors code_10 = '0301911500'"
                        },
                        label_fr: { 
                          type: "string", 
                          description: "Désignation du produit en français (garder les tirets – – au début)" 
                        },
                        unit: {
                          type: "string",
                          description: "Unité de mesure (u, kg, l, m, m2, etc.)"
                        },
                        droit: {
                          type: "number",
                          description: "Taux de droit (nombre). Si '-' alors mettre 0"
                        },
                        notes: {
                          type: "string",
                          description: "Notes de restriction (a), (b), etc."
                        },
                        is_subcode: {
                          type: "boolean",
                          description: "True si c'est un sous-code d'un code parent (code_raw court comme '15 00')"
                        },
                        parent_code: {
                          type: "string",
                          description: "Code parent si is_subcode=true (ex: '0301.91')"
                        },
                        confidence: {
                          type: "number",
                          description: "Confiance dans l'extraction (0-1)"
                        }
                      },
                      required: ["code_raw", "label_fr"]
                    }
                  },
                  page_quality: {
                    type: "object",
                    properties: {
                      readability: { type: "number", description: "Lisibilité 0-1" },
                      codes_found: { type: "number" },
                      has_partial_codes: { type: "boolean", description: "True si la page contient des codes partiels qui héritent d'un parent" }
                    }
                  }
                },
                required: ["codes"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_hs_codes" } },
        max_tokens: CONFIG.MAX_TOKENS,
        temperature: CONFIG.TEMPERATURE,
      }),
    });

    if (!response.ok) {
      if (response.status === 429 && retryCount < CONFIG.MAX_RETRIES_PER_PAGE) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
        return extractHSCodesFromText(text, pageNumber, retryCount + 1);
      }
      return [];
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall?.function?.arguments) {
      return [];
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    const codes = parsed.codes || [];
    
    // Process and validate codes
    const processedCodes: ExtractedHSCode[] = [];
    
    for (const c of codes) {
      if (!c.code_raw || !c.label_fr) continue;
      
      // Priority: use code_10_reconstructed if available (for partial codes)
      let codeToProcess = c.code_10_reconstructed || c.code_raw;
      
      // Clean the code - remove all non-digits
      let cleanCode = codeToProcess.replace(/\D/g, '');
      
      // Handle partial codes with parent context
      if (cleanCode.length < 6 && c.parent_code) {
        const parentClean = c.parent_code.replace(/\D/g, '');
        // Combine parent prefix with partial code
        if (parentClean.length >= 4) {
          cleanCode = parentClean + cleanCode;
        }
      }
      
      // Skip if still too short
      if (cleanCode.length < 6) {
        console.log(`[pdf-ocr] Skipping short code: ${c.code_raw} -> ${cleanCode}`);
        continue;
      }
      
      let code_10: string;
      let code_14: string | undefined;
      
      if (cleanCode.length >= 14) {
        code_14 = cleanCode.slice(0, 14);
        code_10 = cleanCode.slice(0, 10);
      } else if (cleanCode.length > 10) {
        code_14 = cleanCode.padEnd(14, '0').slice(0, 14);
        code_10 = cleanCode.slice(0, 10);
      } else {
        code_10 = cleanCode.padEnd(10, '0').slice(0, 10);
        code_14 = undefined;
      }
      
      // Handle "-" as duty rate (exemption = 0)
      let droit = c.droit;
      if (droit === null || droit === undefined) {
        droit = undefined;
      }
      
      const hsCode: ExtractedHSCode = {
        code_10,
        code_14,
        label_fr: c.label_fr.trim(),
        unit: c.unit?.trim(),
        droit: typeof droit === 'number' ? droit : undefined,
        notes: c.notes?.trim(),
        page_number: pageNumber,
        extraction_confidence: c.confidence || (c.is_subcode ? 0.7 : 0.85),
      };
      
      const validation = validateHSCode(hsCode);
      
      if (validation.isValid) {
        processedCodes.push(hsCode);
      } else {
        console.log(`[pdf-ocr] Invalid code ${code_10}: ${validation.errors.join(', ')}`);
      }
    }
    
    console.log(`[pdf-ocr] Page ${pageNumber}: extracted ${processedCodes.length} valid codes from ${codes.length} raw`);
    return processedCodes;
  } catch (error) {
    console.error(`[pdf-ocr] HS extraction error page ${pageNumber}:`, error);
    return [];
  }
}

// ============================================================================
// INTELLIGENT DEDUPLICATION
// ============================================================================

function calculateCodeScore(code: ExtractedHSCode): number {
  let score = 0;
  
  // Base score for valid code
  score += 10;
  
  // Bonus for 14-digit code
  if (code.code_14) score += 3;
  
  // Bonus for unit
  if (code.unit) score += 2;
  
  // Bonus for duty rate
  if (code.droit !== undefined) score += 2;
  
  // Bonus for notes/restrictions
  if (code.notes) score += 1;
  
  // Bonus for label quality
  if (code.label_fr.length > 20) score += 1;
  if (code.label_fr.length > 50) score += 1;
  
  // Bonus for extraction confidence
  if (code.extraction_confidence) {
    score += code.extraction_confidence * 3;
  }
  
  return score;
}

export function deduplicateHSCodes(codes: ExtractedHSCode[]): ExtractedHSCode[] {
  const codeMap = new Map<string, ExtractedHSCode>();
  
  for (const code of codes) {
    const existing = codeMap.get(code.code_10);
    
    if (!existing) {
      codeMap.set(code.code_10, code);
    } else {
      // Keep the one with higher score
      const existingScore = calculateCodeScore(existing);
      const newScore = calculateCodeScore(code);
      
      if (newScore > existingScore) {
        codeMap.set(code.code_10, code);
      }
    }
  }
  
  return Array.from(codeMap.values());
}

// ============================================================================
// MAIN MULTI-PAGE EXTRACTION
// ============================================================================

export async function extractPDFMultiPage(
  base64Content: string,
  filename: string
): Promise<PDFExtractionResult> {
  const startTime = Date.now();
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    console.log("[pdf-ocr] No LOVABLE_API_KEY, cannot process PDF");
    return {
      total_pages: 0,
      pages_processed: 0,
      pages_failed: 0,
      full_text: `[PDF non traité: ${filename}]`,
      all_hs_codes: [],
      unique_hs_codes: [],
      page_results: [],
      processing_time_ms: Date.now() - startTime,
      extraction_quality: {
        estimated_accuracy: 0,
        codes_per_page: 0,
        coverage_percent: 0,
      },
    };
  }

  // Estimate page count
  const estimatedPages = estimatePDFPages(base64Content);
  console.log(`[pdf-ocr] Starting extraction: ${filename}, estimated ${estimatedPages} page(s)`);

  // Strategy based on document size
  let pageResults: PageExtractionResult[] = [];
  
  if (estimatedPages <= 3) {
    // Small document: process as single unit with enhanced prompt
    console.log(`[pdf-ocr] Small PDF (${estimatedPages} pages), processing as single unit`);
    
    const singleResult = await extractTextFromSinglePage(base64Content, 1, 1, filename);
    pageResults = [singleResult];
    
  } else if (estimatedPages <= 20) {
    // Medium document: process in 2-4 passes with page hints
    const passes = Math.min(4, Math.ceil(estimatedPages / 5));
    console.log(`[pdf-ocr] Medium PDF (${estimatedPages} pages), processing in ${passes} passes`);
    
    // First pass: get full document
    const fullResult = await extractTextFromSinglePage(base64Content, 1, estimatedPages, filename);
    pageResults.push(fullResult);
    
    // Additional passes if first pass seems incomplete
    if (fullResult.text.length < estimatedPages * 500) { // Less than 500 chars per page avg
      console.log(`[pdf-ocr] First pass incomplete, running ${passes - 1} additional passes`);
      
      for (let pass = 2; pass <= passes; pass++) {
        // Add delay between passes
        await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_BATCHES_MS));
        
        const passResult = await extractTextFromSinglePage(base64Content, pass, passes, filename);
        if (passResult.success && passResult.text.length > 100) {
          pageResults.push(passResult);
        }
      }
    }
    
  } else {
    // Large document: chunked processing with multiple AI calls
    const chunks = Math.ceil(estimatedPages / 10);
    console.log(`[pdf-ocr] Large PDF (${estimatedPages} pages), processing in ${chunks} chunks`);
    
    for (let chunk = 0; chunk < chunks; chunk++) {
      const chunkStart = chunk * 10 + 1;
      const chunkEnd = Math.min((chunk + 1) * 10, estimatedPages);
      
      console.log(`[pdf-ocr] Processing chunk ${chunk + 1}/${chunks} (pages ${chunkStart}-${chunkEnd})`);
      
      const chunkResult = await extractTextFromSinglePage(base64Content, chunkStart, estimatedPages, filename);
      pageResults.push(chunkResult);
      
      // Delay between chunks
      if (chunk < chunks - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_BATCHES_MS));
      }
    }
  }

  // Aggregate text from all pages
  const successfulPages = pageResults.filter(p => p.success);
  const failedPages = pageResults.filter(p => !p.success);
  
  const fullText = successfulPages
    .map((p, idx) => `--- Page ${idx + 1} ---\n${p.text}`)
    .join("\n\n");

  console.log(`[pdf-ocr] OCR complete: ${successfulPages.length}/${pageResults.length} pages, ${fullText.length} chars total`);

  // Extract HS codes from aggregated text
  console.log(`[pdf-ocr] Starting HS code extraction from OCR text...`);
  
  // Split text into chunks for HS extraction
  const CHUNK_SIZE = 35000;
  const OVERLAP = 2000;
  const textChunks: string[] = [];
  
  if (fullText.length <= CHUNK_SIZE) {
    textChunks.push(fullText);
  } else {
    let start = 0;
    while (start < fullText.length) {
      let end = Math.min(start + CHUNK_SIZE, fullText.length);
      
      if (end < fullText.length) {
        const lastNewline = fullText.lastIndexOf('\n', end);
        const lastPipe = fullText.lastIndexOf('|', end);
        const breakPoint = Math.max(lastNewline, lastPipe);
        
        if (breakPoint > start + CHUNK_SIZE / 2) {
          end = breakPoint + 1;
        }
      }
      
      textChunks.push(fullText.slice(start, end));
      start = end - OVERLAP;
    }
  }

  console.log(`[pdf-ocr] Extracting HS codes from ${textChunks.length} text chunk(s)`);

  // Process chunks in parallel batches
  const allHSCodes: ExtractedHSCode[] = [];
  
  for (let i = 0; i < textChunks.length; i += CONFIG.MAX_CONCURRENT_PAGES) {
    const batch = textChunks.slice(i, i + CONFIG.MAX_CONCURRENT_PAGES);
    
    const batchResults = await Promise.all(
      batch.map((chunk, idx) => extractHSCodesFromText(chunk, i + idx + 1))
    );
    
    for (const codes of batchResults) {
      allHSCodes.push(...codes);
    }
    
    if (i + CONFIG.MAX_CONCURRENT_PAGES < textChunks.length) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_BATCHES_MS));
    }
  }

  // Deduplicate codes
  const uniqueCodes = deduplicateHSCodes(allHSCodes);
  
  console.log(`[pdf-ocr] Extraction complete: ${allHSCodes.length} total codes, ${uniqueCodes.length} unique after deduplication`);

  // Calculate quality metrics
  const processingTime = Date.now() - startTime;
  const codesPerPage = successfulPages.length > 0 ? uniqueCodes.length / successfulPages.length : 0;
  const coveragePercent = pageResults.length > 0 ? (successfulPages.length / pageResults.length) * 100 : 0;
  
  // Estimate accuracy based on multiple factors
  let estimatedAccuracy = 0.7; // Base accuracy
  
  if (successfulPages.length === pageResults.length) estimatedAccuracy += 0.1;
  if (uniqueCodes.length > 0) estimatedAccuracy += 0.1;
  if (codesPerPage > 5) estimatedAccuracy += 0.05;
  if (failedPages.length === 0) estimatedAccuracy += 0.05;
  
  estimatedAccuracy = Math.min(estimatedAccuracy, 0.95);

  return {
    total_pages: estimatedPages,
    pages_processed: successfulPages.length,
    pages_failed: failedPages.length,
    full_text: fullText,
    all_hs_codes: allHSCodes,
    unique_hs_codes: uniqueCodes,
    page_results: pageResults,
    processing_time_ms: processingTime,
    extraction_quality: {
      estimated_accuracy: Math.round(estimatedAccuracy * 100) / 100,
      codes_per_page: Math.round(codesPerPage * 10) / 10,
      coverage_percent: Math.round(coveragePercent),
    },
  };
}

// ============================================================================
// SIMPLE TEXT EXTRACTION (for non-HS documents)
// ============================================================================

export async function extractTextFromPDF(
  base64Content: string,
  filename: string
): Promise<string> {
  const result = await extractPDFMultiPage(base64Content, filename);
  return result.full_text;
}

// ============================================================================
// PAGE IMAGES VISION OCR (for client-side converted PDFs)
// ============================================================================

export interface PageImageInput {
  pageNumber: number;
  base64: string; // PNG base64
  width?: number;
  height?: number;
}

/**
 * Process pre-converted page images (PNG) with vision OCR
 * This is used when the client has already converted PDF to images
 */
export async function processPageImagesWithVisionOCR(
  pageImages: PageImageInput[],
  filename: string
): Promise<PDFExtractionResult> {
  const startTime = Date.now();
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    console.log("[pdf-ocr] No LOVABLE_API_KEY, cannot process page images");
    return {
      total_pages: pageImages.length,
      pages_processed: 0,
      pages_failed: pageImages.length,
      full_text: `[Pages non traitées: ${filename}]`,
      all_hs_codes: [],
      unique_hs_codes: [],
      page_results: [],
      processing_time_ms: Date.now() - startTime,
      extraction_quality: {
        estimated_accuracy: 0,
        codes_per_page: 0,
        coverage_percent: 0,
      },
    };
  }

  console.log(`[pdf-ocr] Processing ${pageImages.length} page images with vision OCR: ${filename}`);

  const pageResults: PageExtractionResult[] = [];

  // Process pages in parallel batches
  for (let i = 0; i < pageImages.length; i += CONFIG.MAX_CONCURRENT_PAGES) {
    const batch = pageImages.slice(i, i + CONFIG.MAX_CONCURRENT_PAGES);
    
    console.log(`[pdf-ocr] Processing batch ${Math.floor(i / CONFIG.MAX_CONCURRENT_PAGES) + 1}, pages ${i + 1}-${Math.min(i + CONFIG.MAX_CONCURRENT_PAGES, pageImages.length)}`);
    
    const batchResults = await Promise.all(
      batch.map(async (pageImage) => {
        const pageStartTime = Date.now();
        
        try {
          const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: CONFIG.MODEL,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `${MOROCCAN_TARIFF_PAGE_PROMPT}\n\n[PAGE ${pageImage.pageNumber}/${pageImages.length}]`
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/png;base64,${pageImage.base64}`,
                        detail: "high"
                      }
                    }
                  ]
                }
              ],
              max_tokens: CONFIG.MAX_TOKENS,
              temperature: CONFIG.TEMPERATURE,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[pdf-ocr] Page ${pageImage.pageNumber} error:`, response.status, errorText.slice(0, 200));
            
            return {
              page_number: pageImage.pageNumber,
              success: false,
              text: "",
              hs_codes: [],
              error: `API error: ${response.status}`,
              processing_time_ms: Date.now() - pageStartTime,
            } as PageExtractionResult;
          }

          const data = await response.json();
          const extractedText = data.choices?.[0]?.message?.content || "";
          
          console.log(`[pdf-ocr] Page ${pageImage.pageNumber}: extracted ${extractedText.length} chars`);
          
          return {
            page_number: pageImage.pageNumber,
            success: true,
            text: extractedText,
            hs_codes: [],
            processing_time_ms: Date.now() - pageStartTime,
          } as PageExtractionResult;
          
        } catch (error) {
          console.error(`[pdf-ocr] Page ${pageImage.pageNumber} failed:`, error);
          return {
            page_number: pageImage.pageNumber,
            success: false,
            text: "",
            hs_codes: [],
            error: error instanceof Error ? error.message : "Unknown error",
            processing_time_ms: Date.now() - pageStartTime,
          } as PageExtractionResult;
        }
      })
    );
    
    pageResults.push(...batchResults);
    
    // Delay between batches
    if (i + CONFIG.MAX_CONCURRENT_PAGES < pageImages.length) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_BATCHES_MS));
    }
  }

  // Aggregate text from all pages
  const successfulPages = pageResults.filter(p => p.success);
  const failedPages = pageResults.filter(p => !p.success);
  
  const fullText = successfulPages
    .sort((a, b) => a.page_number - b.page_number)
    .map(p => `--- Page ${p.page_number} ---\n${p.text}`)
    .join("\n\n");

  console.log(`[pdf-ocr] Vision OCR complete: ${successfulPages.length}/${pageResults.length} pages, ${fullText.length} chars total`);

  // Extract HS codes from aggregated text
  console.log(`[pdf-ocr] Starting HS code extraction from vision OCR text...`);
  
  const CHUNK_SIZE = 35000;
  const OVERLAP = 2000;
  const textChunks: string[] = [];
  
  if (fullText.length <= CHUNK_SIZE) {
    textChunks.push(fullText);
  } else {
    let start = 0;
    while (start < fullText.length) {
      let end = Math.min(start + CHUNK_SIZE, fullText.length);
      
      if (end < fullText.length) {
        const lastNewline = fullText.lastIndexOf('\n', end);
        const lastPipe = fullText.lastIndexOf('|', end);
        const breakPoint = Math.max(lastNewline, lastPipe);
        
        if (breakPoint > start + CHUNK_SIZE / 2) {
          end = breakPoint + 1;
        }
      }
      
      textChunks.push(fullText.slice(start, end));
      start = end - OVERLAP;
    }
  }

  console.log(`[pdf-ocr] Extracting HS codes from ${textChunks.length} text chunk(s)`);

  const allHSCodes: ExtractedHSCode[] = [];
  
  for (let i = 0; i < textChunks.length; i += CONFIG.MAX_CONCURRENT_PAGES) {
    const batch = textChunks.slice(i, i + CONFIG.MAX_CONCURRENT_PAGES);
    
    const batchResults = await Promise.all(
      batch.map((chunk, idx) => extractHSCodesFromText(chunk, i + idx + 1))
    );
    
    for (const codes of batchResults) {
      allHSCodes.push(...codes);
    }
    
    if (i + CONFIG.MAX_CONCURRENT_PAGES < textChunks.length) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_BATCHES_MS));
    }
  }

  // Deduplicate codes
  const uniqueCodes = deduplicateHSCodes(allHSCodes);
  
  console.log(`[pdf-ocr] Vision extraction complete: ${allHSCodes.length} total codes, ${uniqueCodes.length} unique`);

  // Calculate quality metrics
  const processingTime = Date.now() - startTime;
  const codesPerPage = successfulPages.length > 0 ? uniqueCodes.length / successfulPages.length : 0;
  const coveragePercent = pageResults.length > 0 ? (successfulPages.length / pageResults.length) * 100 : 0;
  
  let estimatedAccuracy = 0.75; // Higher base accuracy for vision OCR
  
  if (successfulPages.length === pageResults.length) estimatedAccuracy += 0.1;
  if (uniqueCodes.length > 0) estimatedAccuracy += 0.08;
  if (codesPerPage > 5) estimatedAccuracy += 0.05;
  if (failedPages.length === 0) estimatedAccuracy += 0.02;
  
  estimatedAccuracy = Math.min(estimatedAccuracy, 0.98);

  return {
    total_pages: pageImages.length,
    pages_processed: successfulPages.length,
    pages_failed: failedPages.length,
    full_text: fullText,
    all_hs_codes: allHSCodes,
    unique_hs_codes: uniqueCodes,
    page_results: pageResults,
    processing_time_ms: processingTime,
    extraction_quality: {
      estimated_accuracy: Math.round(estimatedAccuracy * 100) / 100,
      codes_per_page: Math.round(codesPerPage * 10) / 10,
      coverage_percent: Math.round(coveragePercent),
    },
  };
}
