import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============= TYPES =============

interface ClassifyRequest {
  case_id: string;
  file_urls: string[];
  answers: Record<string, string>;
  context: {
    type_import_export: "import" | "export";
    origin_country: string;
  };
}

interface HSCodeCandidate {
  code_10: string;
  code_6: string;
  chapter_2: string;
  label_fr: string;
  label_ar: string | null;
  unit: string | null;
  taxes: Record<string, unknown>;
  restrictions: string[] | null;
}

interface KBChunk {
  id: string;
  source: string;
  doc_id: string;
  ref: string;
  text: string;
  similarity: number;
}

interface DUMRecord {
  hs_code_10: string;
  product_description: string;
  origin_country: string;
  reliability_score: number;
}

interface Alternative {
  code: string;
  reason: string;
  confidence: number;
}

interface EvidenceItem {
  source: "omd" | "maroc" | "lois" | "dum";
  doc_id: string;
  ref: string;
  excerpt: string;
}

interface NextQuestion {
  id: string;
  label: string;
  type: "yesno" | "select" | "text";
  options?: { value: string; label: string }[];
  required: boolean;
}

interface ClassifyResult {
  status: "NEED_INFO" | "DONE" | "ERROR" | "LOW_CONFIDENCE" | "HALLUCINATION_DETECTED";
  recommended_code: string | null;
  confidence: number | null;
  confidence_level: "high" | "medium" | "low" | null;
  justification_short: string | null;
  alternatives: Alternative[];
  evidence: EvidenceItem[];
  next_question: NextQuestion | null;
  error_message: string | null;
  answers: Record<string, string>;
  verification_passed?: boolean;
  verification_details?: string;
}

// ============= CANDIDATE RETRIEVAL =============

async function getCandidateHSCodes(
  supabase: any,
  productName: string,
  limit = 20
): Promise<HSCodeCandidate[]> {
  console.log("Fetching candidate HS codes for:", productName);
  
  // Search by keywords in label_fr
  const keywords = productName.toLowerCase().split(/\s+/).filter(k => k.length > 2);
  
  if (keywords.length === 0) {
    // Fallback: get most common codes
    const { data } = await supabase
      .from("hs_codes")
      .select("code_10, code_6, chapter_2, label_fr, label_ar, unit, taxes, restrictions")
      .limit(limit);
    return data || [];
  }

  // Build search query with OR conditions
  const { data, error } = await supabase
    .from("hs_codes")
    .select("code_10, code_6, chapter_2, label_fr, label_ar, unit, taxes, restrictions")
    .or(keywords.map(k => `label_fr.ilike.%${k}%`).join(","))
    .limit(limit);

  if (error) {
    console.error("Error fetching HS codes:", error);
    return [];
  }

  console.log(`Found ${data?.length || 0} candidate HS codes`);
  return data || [];
}

// ============= RAG SEARCH =============

async function searchKnowledgeBase(
  supabase: any,
  query: string,
  sources: string[] = ["omd", "maroc", "lois"],
  limit = 10
): Promise<KBChunk[]> {
  console.log("RAG search for:", query);
  
  // Simple text search in kb_chunks (without embeddings for now)
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
  
  if (keywords.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("kb_chunks")
    .select("id, source, doc_id, ref, text")
    .in("source", sources)
    .or(keywords.map(k => `text.ilike.%${k}%`).join(","))
    .limit(limit);

  if (error) {
    console.error("Error searching KB:", error);
    return [];
  }

  // Add similarity scores based on keyword matches
  const results: KBChunk[] = (data || []).map((chunk: { id: string; source: string; doc_id: string; ref: string; text: string }) => {
    const textLower = chunk.text.toLowerCase();
    const matchCount = keywords.filter(k => textLower.includes(k)).length;
    return {
      id: chunk.id,
      source: chunk.source,
      doc_id: chunk.doc_id,
      ref: chunk.ref,
      text: chunk.text,
      similarity: matchCount / keywords.length,
    };
  });

  // Sort by similarity
  results.sort((a, b) => b.similarity - a.similarity);
  
  console.log(`Found ${results.length} KB chunks`);
  return results;
}

// ============= DUM HISTORY SEARCH =============

async function searchDUMHistory(
  supabase: any,
  productName: string,
  companyId: string,
  limit = 5
): Promise<DUMRecord[]> {
  console.log("Searching DUM history for:", productName);
  
  const keywords = productName.toLowerCase().split(/\s+/).filter(k => k.length > 2);
  
  if (keywords.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("dum_records")
    .select("hs_code_10, product_description, origin_country, reliability_score")
    .eq("company_id", companyId)
    .or(keywords.map(k => `product_description.ilike.%${k}%`).join(","))
    .order("reliability_score", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error searching DUM history:", error);
    return [];
  }

  console.log(`Found ${data?.length || 0} DUM records`);
  return data || [];
}

// ============= PROMPTS =============

function buildSystemPrompt(
  candidates: HSCodeCandidate[],
  kbChunks: KBChunk[],
  dumRecords: DUMRecord[]
): string {
  let prompt = `Tu es un expert en classification douanière. Tu analyses les documents fournis pour déterminer le code SH à 10 chiffres.

RÈGLE ANTI-HALLUCINATION CRITIQUE:
⚠️ Tu ne peux recommander QUE des codes qui existent dans la liste CANDIDATS_VALIDES ci-dessous.
⚠️ Si aucun code candidat ne correspond, réponds avec status="LOW_CONFIDENCE" et demande plus d'infos.
⚠️ NE JAMAIS inventer un code qui n'est pas dans la liste.

`;

  // Add candidates list
  if (candidates.length > 0) {
    prompt += `=== CANDIDATS_VALIDES (seuls codes autorisés) ===\n`;
    candidates.forEach(c => {
      prompt += `- ${c.code_10}: ${c.label_fr}`;
      if (c.unit) prompt += ` [Unité: ${c.unit}]`;
      if (c.restrictions?.length) prompt += ` [Restrictions: ${c.restrictions.join(", ")}]`;
      prompt += `\n`;
    });
    prompt += `\n`;
  } else {
    prompt += `⚠️ AUCUN CANDIDAT TROUVÉ - Tu DOIS répondre avec status="NEED_INFO" pour demander plus de détails.\n\n`;
  }

  // Add KB context
  if (kbChunks.length > 0) {
    prompt += `=== CONTEXTE RÉGLEMENTAIRE (KB) ===\n`;
    kbChunks.slice(0, 5).forEach(chunk => {
      prompt += `[${chunk.source.toUpperCase()}] ${chunk.ref}:\n${chunk.text.slice(0, 500)}...\n\n`;
    });
  }

  // Add DUM history
  if (dumRecords.length > 0) {
    prompt += `=== HISTORIQUE DUM (classifications passées) ===\n`;
    dumRecords.forEach(dum => {
      prompt += `- "${dum.product_description}" → ${dum.hs_code_10} (fiabilité: ${dum.reliability_score}/100)\n`;
    });
    prompt += `\n`;
  }

  prompt += `RÈGLES DE CLASSIFICATION:
1. Analyse TOUS les documents fournis en détail
2. Base ta classification sur les caractéristiques techniques du produit
3. Choisis UNIQUEMENT parmi les CANDIDATS_VALIDES
4. Fournis des preuves documentaires (evidence) pour justifier
5. Si tu manques d'informations, pose UNE question précise
6. Exprime ta confiance en pourcentage (0-100)

NIVEAUX DE CONFIANCE:
- high (>=85%): Classification certaine avec preuves solides
- medium (65-84%): Classification probable mais à vérifier  
- low (<65%): Informations insuffisantes

FORMAT DE RÉPONSE (JSON strict):
{
  "status": "DONE" | "NEED_INFO" | "LOW_CONFIDENCE",
  "recommended_code": "XXXXXXXXXXXX" (doit être dans CANDIDATS_VALIDES) ou null,
  "confidence": 0-100 ou null,
  "justification_short": "Explication courte en 1-2 phrases",
  "alternatives": [
    {"code": "XXXXXXXXXXXX", "reason": "Raison alternative", "confidence": 0-100}
  ],
  "evidence": [
    {"source": "omd"|"maroc"|"lois"|"dum", "doc_id": "ID", "ref": "Section/Article", "excerpt": "Citation pertinente"}
  ],
  "next_question": {
    "id": "q_xxx",
    "label": "Question précise",
    "type": "yesno"|"select"|"text",
    "options": [{"value": "val", "label": "Label"}] (si type=select),
    "required": true
  } ou null
}`;

  return prompt;
}

function buildUserPrompt(
  request: ClassifyRequest, 
  productName: string
): string {
  let prompt = `PRODUIT À CLASSIFIER: ${productName}
TYPE D'OPÉRATION: ${request.context.type_import_export === "import" ? "Importation" : "Exportation"}
PAYS D'ORIGINE: ${request.context.origin_country}

`;

  if (request.file_urls.length > 0) {
    prompt += `DOCUMENTS FOURNIS (${request.file_urls.length} fichiers):
Les documents sont joints en tant qu'images à analyser.

`;
  }

  if (Object.keys(request.answers).length > 0) {
    prompt += `RÉPONSES AUX QUESTIONS PRÉCÉDENTES:
`;
    for (const [questionId, answer] of Object.entries(request.answers)) {
      prompt += `- ${questionId}: ${answer}
`;
    }
    prompt += "\n";
  }

  prompt += `Analyse ces informations et fournis ta recommandation de classification douanière.
RAPPEL: Tu ne peux recommander QUE des codes de la liste CANDIDATS_VALIDES.`;

  return prompt;
}

// ============= AI CALL =============

async function callLovableAI(
  systemPrompt: string,
  userPrompt: string,
  imageUrls: string[]
): Promise<ClassifyResult> {
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY not configured");
  }

  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: userPrompt },
  ];

  for (const url of imageUrls) {
    content.push({
      type: "image_url",
      image_url: { url },
    });
  }

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      temperature: 0.1, // Lower temperature for more deterministic output
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Lovable AI error:", response.status, errorText);
    
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    if (response.status === 402) {
      throw new Error("AI credits exhausted. Please add funds.");
    }
    throw new Error(`AI gateway error: ${response.status}`);
  }

  const data = await response.json();
  const aiResponse = data.choices?.[0]?.message?.content || "";

  console.log("AI Response:", aiResponse);

  const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse AI response as JSON");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  let confidenceLevel: "high" | "medium" | "low" | null = null;
  if (parsed.confidence !== null && parsed.confidence !== undefined) {
    if (parsed.confidence >= 85) confidenceLevel = "high";
    else if (parsed.confidence >= 65) confidenceLevel = "medium";
    else confidenceLevel = "low";
  }

  const rawConfidence = parsed.confidence ?? null;
  const normalizedConfidence = rawConfidence !== null 
    ? (rawConfidence > 1 ? rawConfidence / 100 : rawConfidence) 
    : null;

  return {
    status: parsed.status || "ERROR",
    recommended_code: parsed.recommended_code || null,
    confidence: normalizedConfidence,
    confidence_level: confidenceLevel,
    justification_short: parsed.justification_short || null,
    alternatives: (parsed.alternatives || []).map((alt: Record<string, unknown>) => ({
      ...alt,
      confidence: typeof alt.confidence === "number" && alt.confidence > 1 
        ? alt.confidence / 100 
        : alt.confidence,
    })),
    evidence: parsed.evidence || [],
    next_question: parsed.next_question || null,
    error_message: parsed.error_message || null,
    answers: {},
  };
}

// ============= ANTI-HALLUCINATION VERIFICATION =============

function verifyCodeExists(
  recommendedCode: string | null,
  alternatives: Alternative[],
  candidates: HSCodeCandidate[]
): { passed: boolean; details: string; correctedCode: string | null } {
  if (!recommendedCode) {
    return { passed: true, details: "No code recommended", correctedCode: null };
  }

  // Normalize code (remove dots)
  const normalizedCode = recommendedCode.replace(/\./g, "");
  const candidateCodes = candidates.map(c => c.code_10.replace(/\./g, ""));

  // Check if recommended code exists in candidates
  const exactMatch = candidateCodes.includes(normalizedCode);
  
  if (exactMatch) {
    return { 
      passed: true, 
      details: `Code ${recommendedCode} verified in candidates list`,
      correctedCode: recommendedCode 
    };
  }

  // Check for partial match (first 6 digits)
  const code6 = normalizedCode.slice(0, 6);
  const partialMatches = candidates.filter(c => 
    c.code_10.replace(/\./g, "").startsWith(code6)
  );

  if (partialMatches.length > 0) {
    // Return the best partial match
    const corrected = partialMatches[0].code_10;
    return {
      passed: false,
      details: `Code ${recommendedCode} not found, corrected to ${corrected} (same chapter)`,
      correctedCode: corrected,
    };
  }

  // Check alternatives
  for (const alt of alternatives) {
    const altNormalized = alt.code.replace(/\./g, "");
    if (candidateCodes.includes(altNormalized)) {
      return {
        passed: false,
        details: `Recommended code ${recommendedCode} not found, using alternative ${alt.code}`,
        correctedCode: alt.code,
      };
    }
  }

  // No valid code found
  return {
    passed: false,
    details: `HALLUCINATION DETECTED: Code ${recommendedCode} does not exist in nomenclature`,
    correctedCode: null,
  };
}

// ============= MAIN HANDLER =============

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const body: ClassifyRequest = await req.json();
    const { case_id, file_urls, answers, context } = body;

    console.log("Classify request:", { case_id, file_urls_count: file_urls.length, answers });

    if (!case_id) {
      return new Response(
        JSON.stringify({ error: "case_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get case details
    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("*")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      console.error("Case not found:", caseError);
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log classify call
    await supabase.from("audit_logs").insert({
      case_id,
      action: "classify_called",
      user_id: caseData.created_by,
      user_phone: "system",
      meta: { file_urls_count: file_urls.length, answers_count: Object.keys(answers).length },
    });

    // ============= STEP 1: RETRIEVE CANDIDATES =============
    console.log("Step 1: Retrieving candidate HS codes...");
    const candidates = await getCandidateHSCodes(supabase, caseData.product_name, 30);
    
    // ============= STEP 2: RAG SEARCH =============
    console.log("Step 2: RAG search in knowledge base...");
    const kbChunks = await searchKnowledgeBase(
      supabase, 
      caseData.product_name,
      ["omd", "maroc", "lois"],
      10
    );
    
    // ============= STEP 3: DUM HISTORY =============
    console.log("Step 3: Searching DUM history...");
    const dumRecords = await searchDUMHistory(
      supabase,
      caseData.product_name,
      caseData.company_id,
      5
    );

    // Log retrieval stats
    console.log("Retrieval stats:", {
      candidates: candidates.length,
      kbChunks: kbChunks.length,
      dumRecords: dumRecords.length,
    });

    // ============= STEP 4: BUILD PROMPTS & CALL AI =============
    console.log("Step 4: Building prompts and calling AI...");
    const systemPrompt = buildSystemPrompt(candidates, kbChunks, dumRecords);
    const userPrompt = buildUserPrompt(body, caseData.product_name);
    
    let result: ClassifyResult;
    try {
      result = await callLovableAI(systemPrompt, userPrompt, file_urls);
      result.answers = answers;
    } catch (aiError) {
      console.error("AI classification error:", aiError);
      result = {
        status: "ERROR",
        recommended_code: null,
        confidence: null,
        confidence_level: null,
        justification_short: null,
        alternatives: [],
        evidence: [],
        next_question: null,
        error_message: aiError instanceof Error ? aiError.message : "Classification failed",
        answers,
      };
    }

    // ============= STEP 5: ANTI-HALLUCINATION VERIFICATION =============
    console.log("Step 5: Anti-hallucination verification...");
    if (result.status === "DONE" && result.recommended_code) {
      const verification = verifyCodeExists(
        result.recommended_code,
        result.alternatives,
        candidates
      );
      
      console.log("Verification result:", verification);
      
      result.verification_passed = verification.passed;
      result.verification_details = verification.details;

      if (!verification.passed) {
        if (verification.correctedCode) {
          // Correct the code
          console.log(`Correcting code from ${result.recommended_code} to ${verification.correctedCode}`);
          result.recommended_code = verification.correctedCode;
          result.justification_short = `[CORRIGÉ] ${result.justification_short}`;
          
          // Reduce confidence due to correction
          if (result.confidence) {
            result.confidence = Math.max(0.5, result.confidence * 0.8);
            if (result.confidence < 0.65) result.confidence_level = "low";
            else if (result.confidence < 0.85) result.confidence_level = "medium";
          }
        } else {
          // No valid code found - mark as hallucination
          result.status = "HALLUCINATION_DETECTED";
          result.error_message = verification.details;
          result.confidence = null;
          result.confidence_level = null;
        }
      }

      // Log verification
      await supabase.from("audit_logs").insert({
        case_id,
        action: "classify_verified",
        user_id: caseData.created_by,
        user_phone: "system",
        meta: {
          verification_passed: verification.passed,
          verification_details: verification.details,
          original_code: result.recommended_code,
          corrected_code: verification.correctedCode,
        },
      });
    }

    // ============= STEP 6: SAVE & UPDATE =============
    const { error: insertError } = await supabase.from("classification_results").insert({
      case_id,
      status: result.status,
      recommended_code: result.recommended_code,
      confidence: result.confidence,
      confidence_level: result.confidence_level,
      justification_short: result.justification_short,
      alternatives: result.alternatives,
      evidence: result.evidence,
      next_question: result.next_question,
      error_message: result.error_message,
      answers: result.answers,
    });

    if (insertError) {
      console.error("Failed to save classification result:", insertError);
    }

    // Update case status
    let newStatus = caseData.status;
    if (result.status === "DONE" && result.verification_passed) {
      newStatus = "RESULT_READY";
      
      await supabase.from("audit_logs").insert({
        case_id,
        action: "result_ready",
        user_id: caseData.created_by,
        user_phone: "system",
        meta: { 
          recommended_code: result.recommended_code,
          confidence: result.confidence,
          verification_passed: result.verification_passed,
        },
      });
    } else if (result.status === "ERROR" || result.status === "HALLUCINATION_DETECTED") {
      newStatus = "ERROR";
    }

    if (newStatus !== caseData.status) {
      await supabase
        .from("cases")
        .update({ status: newStatus })
        .eq("id", case_id);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Classify error:", error);
    return new Response(
      JSON.stringify({ 
        status: "ERROR",
        error_message: error instanceof Error ? error.message : "Unknown error",
        recommended_code: null,
        confidence: null,
        confidence_level: null,
        justification_short: null,
        alternatives: [],
        evidence: [],
        next_question: null,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
