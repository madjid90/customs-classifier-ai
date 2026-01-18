import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================================================
// CONFIGURATION OPENAI - 100% BACKEND, ZERO FRONTEND AI
// ============================================================================

function getOpenAIConfig() {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY non configurée");
  }
  return {
    apiKey,
    modelVision: Deno.env.get("OPENAI_MODEL_VISION") || "gpt-4.1",
    modelReasoning: Deno.env.get("OPENAI_MODEL_REASONING") || "gpt-4.1",
    modelVerifier: Deno.env.get("OPENAI_MODEL_VERIFIER") || "gpt-4.1-mini",
    modelEmbeddings: Deno.env.get("OPENAI_MODEL_EMBEDDINGS") || "text-embedding-3-large",
  };
}

// ============================================================================
// TYPES STRICTS
// ============================================================================

interface ClassifyRequest {
  case_id: string;
  file_urls: string[];
  answers: Record<string, string>;
  context: {
    type_import_export: "import" | "export";
    origin_country: string;
  };
}

// ETAPE 1 - ProductProfile STRICT (extraction vision)
interface ProductProfile {
  product_name: string;
  description: string;
  usage_function: string | null;
  material_composition: string[];
  technical_specs: Record<string, string>;
  dimensions: string | null;
  weight: string | null;
  brand: string | null;
  model: string | null;
  extracted_texts: string[];
  confidence_extraction: number;
}

// ETAPE 2 - Candidats (LISTE FERMÉE - AVANT LLM)
interface HSCandidate {
  code_10: string;
  code_6: string;
  chapter_2: string;
  label_fr: string;
  label_ar: string | null;
  unit: string | null;
  taxes: Record<string, unknown> | null;
  restrictions: string[] | null;
  score: number;
  score_breakdown: {
    text_similarity: number;
    dum_signal: number;
    omd_match: number;
  };
  dum_count: number;
}

// ETAPE 3 - Evidence RAG (pgvector)
interface Evidence {
  source: "omd" | "maroc" | "lois" | "dum";
  doc_id: string;
  ref: string;
  excerpt: string;
  similarity: number;
}

// ETAPE 4/5 - Résultat final
interface HSResult {
  status: "DONE" | "NEED_INFO" | "LOW_CONFIDENCE" | "ERROR" | "VERIFICATION_FAILED";
  recommended_code: string | null;
  confidence: number | null;
  confidence_level: "high" | "medium" | "low" | null;
  justification_short: string | null;
  alternatives: Array<{ code: string; reason: string; confidence: number }>;
  evidence: Evidence[];
  next_question: {
    id: string;
    label: string;
    type: "yesno" | "select" | "text";
    options?: { value: string; label: string }[];
    required: boolean;
  } | null;
  error_message: string | null;
  answers: Record<string, string>;
  verification: {
    passed: boolean;
    checks: {
      code_in_candidates: boolean;
      evidence_not_empty: boolean;
      justification_cites_evidence: boolean;
      coherence_product_code: boolean;
    };
    details: string;
  } | null;
  product_profile: ProductProfile | null;
  candidates_count: number;
}

// ============================================================================
// OPENAI API CALLS - Backend Only
// ============================================================================

async function callOpenAI(
  messages: Array<{ role: string; content: any }>,
  model: string,
  temperature = 0.1
): Promise<string> {
  const config = getOpenAIConfig();
  
  console.log(`[classify] Calling OpenAI ${model}...`);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[classify] OpenAI error:", response.status, errorText);
    
    if (response.status === 429) {
      throw new Error("Rate limit OpenAI dépassé. Réessayez plus tard.");
    }
    if (response.status === 401) {
      throw new Error("Clé API OpenAI invalide.");
    }
    throw new Error(`Erreur OpenAI: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function generateEmbedding(text: string): Promise<number[]> {
  const config = getOpenAIConfig();
  
  console.log(`[classify] Generating embedding with ${config.modelEmbeddings}...`);

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.modelEmbeddings,
      input: text.substring(0, 8000), // Limit input length
      dimensions: 1536, // Match kb_chunks.embedding dimension
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[classify] Embedding error:", response.status, errorText);
    throw new Error(`Erreur embedding: ${response.status}`);
  }

  const data = await response.json();
  return data.data?.[0]?.embedding || [];
}

// ============================================================================
// ÉTAPE 1 : EXTRACTION VISION (ProductProfile)
// ============================================================================

async function extractProductProfile(
  imageUrls: string[],
  productName: string,
  answers: Record<string, string>
): Promise<ProductProfile> {
  console.log("=== ÉTAPE 1: EXTRACTION VISION ===");
  
  const config = getOpenAIConfig();

  if (imageUrls.length === 0) {
    console.log("Aucun document fourni, profil minimal");
    return {
      product_name: productName,
      description: productName,
      usage_function: null,
      material_composition: [],
      technical_specs: {},
      dimensions: null,
      weight: null,
      brand: null,
      model: null,
      extracted_texts: [],
      confidence_extraction: 0.2,
    };
  }

  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    {
      type: "text",
      text: `Tu es un expert en analyse documentaire. Analyse ces documents et extrais un profil produit STRICT.

PRODUIT DÉCLARÉ: ${productName}

${Object.keys(answers).length > 0 ? `INFORMATIONS COMPLÉMENTAIRES:\n${Object.entries(answers).map(([k, v]) => `- ${k}: ${v}`).join("\n")}` : ""}

RÈGLES STRICTES:
- EXTRAIS UNIQUEMENT ce qui est VISIBLE dans les documents
- NE SUPPOSE RIEN qui n'est pas explicitement mentionné
- Si une information n'est pas visible → null

Réponds UNIQUEMENT en JSON strict:
{
  "product_name": "nom exact visible ou déclaré",
  "description": "description technique détaillée extraite",
  "usage_function": "usage/fonction si mentionné ou null",
  "material_composition": ["matériau1", "matériau2"],
  "technical_specs": {"spec1": "valeur1"},
  "dimensions": "dimensions si visibles ou null",
  "weight": "poids si visible ou null",
  "brand": "marque si visible ou null",
  "model": "modèle si visible ou null",
  "extracted_texts": ["textes clés extraits"],
  "confidence_extraction": 0.0-1.0
}`
    },
  ];

  for (const url of imageUrls) {
    content.push({ type: "image_url", image_url: { url } });
  }

  const aiResponse = await callOpenAI(
    [{ role: "user", content }],
    config.modelVision,
    0.1
  );
  
  const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Échec parsing extraction");
    return {
      product_name: productName,
      description: productName,
      usage_function: null,
      material_composition: [],
      technical_specs: {},
      dimensions: null,
      weight: null,
      brand: null,
      model: null,
      extracted_texts: [],
      confidence_extraction: 0.1,
    };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  console.log("ProductProfile extrait:", parsed.product_name, "conf:", parsed.confidence_extraction);
  
  return {
    product_name: parsed.product_name || productName,
    description: parsed.description || productName,
    usage_function: parsed.usage_function || null,
    material_composition: parsed.material_composition || [],
    technical_specs: parsed.technical_specs || {},
    dimensions: parsed.dimensions || null,
    weight: parsed.weight || null,
    brand: parsed.brand || null,
    model: parsed.model || null,
    extracted_texts: parsed.extracted_texts || [],
    confidence_extraction: parsed.confidence_extraction || 0.5,
  };
}

// ============================================================================
// ÉTAPE 2 : LISTE FERMÉE candidates[] (AVANT LLM)
// ============================================================================

function calculateTextSimilarity(text1: string, text2: string): number {
  const normalize = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const words1 = new Set(normalize(text1).split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(normalize(text2).split(/\s+/).filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  let matches = 0;
  for (const word of words1) {
    if (words2.has(word)) matches++;
  }
  
  return (2 * matches) / (words1.size + words2.size);
}

async function generateCandidatesList(
  supabase: any,
  profile: ProductProfile,
  companyId: string,
  originCountry: string,
  maxCandidates = 30
): Promise<HSCandidate[]> {
  console.log("=== ÉTAPE 2: GÉNÉRATION candidates[] (AVANT LLM) ===");
  
  // Construire termes de recherche
  const searchTerms = [
    profile.product_name,
    profile.description,
    profile.usage_function,
    ...profile.material_composition,
    ...Object.values(profile.technical_specs),
  ].filter(Boolean).join(" ");
  
  const keywords = searchTerms.toLowerCase().split(/\s+/).filter(k => k.length > 2);
  
  if (keywords.length === 0) {
    console.log("Aucun mot-clé → liste vide");
    return [];
  }

  console.log(`Recherche avec ${keywords.length} mots-clés`);

  // 1. Requête hs_codes (nomenclature Maroc 10 chiffres)
  const { data: hsCodes, error: hsError } = await supabase
    .from("hs_codes")
    .select("code_10, code_6, chapter_2, label_fr, label_ar, unit, taxes, restrictions")
    .or(keywords.slice(0, 6).map(k => `label_fr.ilike.%${k}%`).join(","))
    .limit(maxCandidates * 2);

  if (hsError) {
    console.error("Erreur hs_codes:", hsError);
  }

  // 2. Requête DUM (SIGNAL SECONDAIRE uniquement)
  const { data: dumRecords, error: dumError } = await supabase
    .from("dum_records")
    .select("hs_code_10, product_description, origin_country, reliability_score")
    .eq("company_id", companyId)
    .or(keywords.slice(0, 5).map(k => `product_description.ilike.%${k}%`).join(","))
    .order("reliability_score", { ascending: false })
    .limit(50);

  if (dumError) {
    console.error("Erreur dum_records:", dumError);
  }

  // 3. Requête notes OMD (mapping chapitres)
  const { data: omdNotes, error: omdError } = await supabase
    .from("hs_omd_notes")
    .select("hs_code, hs_level, text")
    .or(keywords.slice(0, 4).map(k => `text.ilike.%${k}%`).join(","))
    .limit(30);

  if (omdError) {
    console.error("Erreur hs_omd_notes:", omdError);
  }

  console.log(`DB: ${hsCodes?.length || 0} hs_codes, ${dumRecords?.length || 0} DUM, ${omdNotes?.length || 0} OMD`);

  // Construire map des codes OMD mentionnés
  const omdCodeMap = new Map<string, number>();
  for (const note of omdNotes || []) {
    const code = note.hs_code.replace(/\./g, "").substring(0, 4);
    omdCodeMap.set(code, (omdCodeMap.get(code) || 0) + 1);
  }

  // Construire map des scores DUM (SIGNAL SECONDAIRE)
  const dumSignalMap = new Map<string, { count: number; avgScore: number }>();
  for (const dum of dumRecords || []) {
    const code = dum.hs_code_10.replace(/\./g, "");
    const existing = dumSignalMap.get(code);
    
    if (existing) {
      existing.count++;
      existing.avgScore = (existing.avgScore * (existing.count - 1) + (dum.reliability_score || 50)) / existing.count;
    } else {
      dumSignalMap.set(code, {
        count: 1,
        avgScore: dum.reliability_score || 50,
      });
    }
  }

  // Scorer les candidats
  const candidates: HSCandidate[] = (hsCodes || []).map((hs: any) => {
    const code = hs.code_10.replace(/\./g, "");
    const chapter = code.substring(0, 4);
    const dumInfo = dumSignalMap.get(code);
    const omdMentions = omdCodeMap.get(chapter) || 0;
    
    // Score similarité texte (poids principal: 50 points max)
    const textSim = calculateTextSimilarity(searchTerms, hs.label_fr) * 50;
    
    // Score OMD (30 points max)
    const omdScore = Math.min(omdMentions * 10, 30);
    
    // Score DUM (SIGNAL SECONDAIRE: 20 points max)
    let dumScore = 0;
    if (dumInfo) {
      dumScore = Math.min((dumInfo.avgScore / 100) * 10 * Math.min(dumInfo.count, 3), 20);
    }
    
    const totalScore = textSim + omdScore + dumScore;
    
    return {
      code_10: hs.code_10,
      code_6: hs.code_6,
      chapter_2: hs.chapter_2,
      label_fr: hs.label_fr,
      label_ar: hs.label_ar,
      unit: hs.unit,
      taxes: hs.taxes,
      restrictions: hs.restrictions,
      score: Math.round(totalScore * 100) / 100,
      score_breakdown: {
        text_similarity: Math.round(textSim * 100) / 100,
        dum_signal: Math.round(dumScore * 100) / 100,
        omd_match: omdScore,
      },
      dum_count: dumInfo?.count || 0,
    };
  });

  // Ajouter codes DUM non présents dans hs_codes
  const existingCodes = new Set(candidates.map(c => c.code_10.replace(/\./g, "")));
  const missingDumCodes = [...dumSignalMap.keys()].filter(code => !existingCodes.has(code));
  
  if (missingDumCodes.length > 0) {
    const formattedCodes = missingDumCodes.map(c => 
      c.replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, "$1.$2.$3.$4")
    );
    
    const { data: additionalHS } = await supabase
      .from("hs_codes")
      .select("code_10, code_6, chapter_2, label_fr, label_ar, unit, taxes, restrictions")
      .in("code_10", formattedCodes);
    
    for (const hs of additionalHS || []) {
      const code = hs.code_10.replace(/\./g, "");
      const dumInfo = dumSignalMap.get(code);
      if (dumInfo) {
        candidates.push({
          code_10: hs.code_10,
          code_6: hs.code_6,
          chapter_2: hs.chapter_2,
          label_fr: hs.label_fr,
          label_ar: hs.label_ar,
          unit: hs.unit,
          taxes: hs.taxes,
          restrictions: hs.restrictions,
          score: Math.min((dumInfo.avgScore / 100) * 20, 20),
          score_breakdown: {
            text_similarity: 0,
            dum_signal: Math.min((dumInfo.avgScore / 100) * 20, 20),
            omd_match: 0,
          },
          dum_count: dumInfo.count,
        });
      }
    }
  }

  // Trier et limiter
  candidates.sort((a, b) => b.score - a.score);
  const result = candidates.slice(0, maxCandidates);
  
  console.log(`candidates[]: ${result.length} codes, top: ${result[0]?.code_10 || "N/A"} (${result[0]?.score || 0})`);
  return result;
}

// ============================================================================
// ÉTAPE 3 : RAG PREUVES evidence[] (pgvector)
// ============================================================================

async function searchEvidenceRAG(
  supabase: any,
  profile: ProductProfile,
  candidates: HSCandidate[],
  limit = 15
): Promise<Evidence[]> {
  console.log("=== ÉTAPE 3: RAG PREUVES evidence[] (pgvector) ===");
  
  // Construire query pour embedding
  const queryText = [
    profile.product_name,
    profile.description,
    profile.usage_function,
    ...profile.material_composition,
    ...candidates.slice(0, 5).map(c => c.label_fr),
  ].filter(Boolean).join(" ");

  if (!queryText.trim()) {
    console.log("Query vide → evidence vide");
    return [];
  }

  try {
    // Générer embedding de la query
    const queryEmbedding = await generateEmbedding(queryText);
    
    if (queryEmbedding.length === 0) {
      console.log("Embedding vide, fallback texte");
      return await searchEvidenceTextFallback(supabase, profile, candidates, limit);
    }

    // Recherche vectorielle via RPC
    const { data: chunks, error } = await supabase.rpc("match_kb_chunks", {
      query_embedding: queryEmbedding,
      match_threshold: 0.4,
      match_count: limit,
      filter_sources: null, // Toutes les sources
    });

    if (error) {
      console.error("Erreur match_kb_chunks:", error);
      return await searchEvidenceTextFallback(supabase, profile, candidates, limit);
    }

    // Convertir en Evidence[]
    const evidence: Evidence[] = (chunks || []).map((chunk: any) => ({
      source: chunk.source as Evidence["source"],
      doc_id: chunk.doc_id,
      ref: chunk.ref,
      excerpt: chunk.text.slice(0, 500),
      similarity: chunk.similarity,
    }));

    console.log(`evidence[]: ${evidence.length} extraits (pgvector)`);
    return evidence;

  } catch (e) {
    console.error("Erreur RAG:", e);
    return await searchEvidenceTextFallback(supabase, profile, candidates, limit);
  }
}

async function searchEvidenceTextFallback(
  supabase: any,
  profile: ProductProfile,
  candidates: HSCandidate[],
  limit: number
): Promise<Evidence[]> {
  console.log("Fallback: recherche textuelle");
  
  const keywords = [
    profile.product_name,
    profile.description,
    ...profile.material_composition,
    ...candidates.slice(0, 3).map(c => c.code_10),
  ].filter(Boolean).join(" ").toLowerCase().split(/\s+/).filter(k => k.length > 2);

  if (keywords.length === 0) return [];

  const { data: chunks, error } = await supabase
    .from("kb_chunks")
    .select("id, source, doc_id, ref, text")
    .or(keywords.slice(0, 6).map(k => `text.ilike.%${k}%`).join(","))
    .limit(limit * 2);

  if (error) {
    console.error("Erreur fallback:", error);
    return [];
  }

  // Scorer et trier
  const scored = (chunks || []).map((chunk: any) => {
    const textLower = chunk.text.toLowerCase();
    const matchCount = keywords.filter(k => textLower.includes(k)).length;
    return {
      ...chunk,
      similarity: matchCount / keywords.length,
    };
  });

  scored.sort((a: any, b: any) => b.similarity - a.similarity);

  return scored.slice(0, limit).map((chunk: any) => ({
    source: chunk.source as Evidence["source"],
    doc_id: chunk.doc_id,
    ref: chunk.ref,
    excerpt: chunk.text.slice(0, 500),
    similarity: chunk.similarity,
  }));
}

// ============================================================================
// ÉTAPE 4 : DÉCISION CONTRÔLÉE (GPT-4.1)
// ============================================================================

async function makeControlledDecision(
  profile: ProductProfile,
  candidates: HSCandidate[],
  evidence: Evidence[],
  context: { type_import_export: string; origin_country: string },
  answers: Record<string, string>
): Promise<Omit<HSResult, "verification" | "product_profile" | "candidates_count">> {
  console.log("=== ÉTAPE 4: DÉCISION CONTRÔLÉE (GPT-4.1) ===");
  
  const config = getOpenAIConfig();

  if (candidates.length === 0) {
    return {
      status: "NEED_INFO",
      recommended_code: null,
      confidence: null,
      confidence_level: null,
      justification_short: "Aucun code candidat trouvé. Précisez le produit.",
      alternatives: [],
      evidence: [],
      next_question: {
        id: "q_product_description",
        label: "Décrivez précisément le produit (matière, usage, composition)",
        type: "text",
        required: true,
      },
      error_message: null,
      answers,
    };
  }

  // Prompt STRICT anti-hallucination
  const systemPrompt = `Tu es un expert en classification douanière marocaine. Tu dois choisir UN code parmi une LISTE FERMÉE.

RÈGLES ABSOLUES (VIOLATION = REJET):
1. Tu DOIS choisir EXACTEMENT un code de candidates[] - AUCUNE INVENTION
2. Tu DOIS justifier UNIQUEMENT avec des citations de evidence[]
3. Si evidence[] est vide ou insuffisante → status="LOW_CONFIDENCE" ou "NEED_INFO"
4. Si aucun code ne correspond → status="NEED_INFO" avec UNE question discriminante
5. AUCUNE connaissance externe, AUCUNE supposition

FORMAT RÉPONSE (JSON STRICT):
{
  "status": "DONE" | "NEED_INFO" | "LOW_CONFIDENCE",
  "recommended_code": "code_10 EXACT de candidates[]" ou null,
  "confidence": 0-100,
  "justification_short": "Citation evidence[] - max 2 phrases",
  "alternatives": [{"code": "de candidates[]", "reason": "citation evidence[]", "confidence": 0-100}],
  "evidence_used": ["doc_id1", "doc_id2"],
  "next_question": {"id": "q_xxx", "label": "UNE question discriminante", "type": "yesno|select|text", "options": [], "required": true} ou null
}`;

  const userPrompt = `=== PRODUCT PROFILE ===
Nom: ${profile.product_name}
Description: ${profile.description}
Usage: ${profile.usage_function || "Non spécifié"}
Matériaux: ${profile.material_composition.join(", ") || "Non spécifié"}
Specs: ${JSON.stringify(profile.technical_specs)}

=== CONTEXTE ===
Opération: ${context.type_import_export}
Origine: ${context.origin_country}
${Object.keys(answers).length > 0 ? `Réponses: ${JSON.stringify(answers)}` : ""}

=== candidates[] (LISTE FERMÉE - CODE DOIT VENIR D'ICI) ===
${candidates.slice(0, 15).map((c, i) => 
  `${i + 1}. ${c.code_10}: ${c.label_fr} [Score: ${c.score}]${c.dum_count > 0 ? ` [${c.dum_count} DUM]` : ""}`
).join("\n")}

=== evidence[] (SEULES CITATIONS AUTORISÉES) ===
${evidence.length > 0 
  ? evidence.slice(0, 10).map((e, i) => 
      `${i + 1}. [${e.source.toUpperCase()}] ${e.ref} (sim: ${(e.similarity * 100).toFixed(0)}%):\n"${e.excerpt.slice(0, 250)}..."`
    ).join("\n\n")
  : "⚠️ AUCUNE EVIDENCE - RÉPONDS AVEC status='LOW_CONFIDENCE' ou 'NEED_INFO'"
}

RAPPEL: Code de candidates[] UNIQUEMENT. Justification de evidence[] UNIQUEMENT.`;

  const aiResponse = await callOpenAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    config.modelReasoning,
    0.1
  );

  const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Échec parsing décision LLM");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Normaliser confidence
  let confidence = parsed.confidence ?? null;
  let confidenceLevel: "high" | "medium" | "low" | null = null;
  
  if (confidence !== null) {
    if (confidence > 1) confidence = confidence / 100;
    if (confidence >= 0.85) confidenceLevel = "high";
    else if (confidence >= 0.65) confidenceLevel = "medium";
    else confidenceLevel = "low";
  }

  // Filtrer evidence utilisée
  const usedEvidence = evidence.filter(e => 
    parsed.evidence_used?.includes(e.doc_id) || 
    parsed.justification_short?.toLowerCase().includes(e.ref.toLowerCase())
  );

  console.log(`Décision: ${parsed.status}, code: ${parsed.recommended_code}, conf: ${confidence}`);

  return {
    status: parsed.status || "ERROR",
    recommended_code: parsed.recommended_code || null,
    confidence,
    confidence_level: confidenceLevel,
    justification_short: parsed.justification_short || null,
    alternatives: (parsed.alternatives || []).map((alt: any) => ({
      code: alt.code,
      reason: alt.reason,
      confidence: alt.confidence > 1 ? alt.confidence / 100 : alt.confidence,
    })),
    evidence: usedEvidence.length > 0 ? usedEvidence : evidence.slice(0, 5),
    next_question: parsed.next_question || null,
    error_message: null,
    answers,
  };
}

// ============================================================================
// ÉTAPE 5 : VERIFIER PASS (Anti-hallucination)
// ============================================================================

interface VerificationResult {
  passed: boolean;
  checks: {
    code_in_candidates: boolean;
    evidence_not_empty: boolean;
    justification_cites_evidence: boolean;
    coherence_product_code: boolean;
  };
  details: string;
  corrected_code: string | null;
}

async function verifyResult(
  result: Omit<HSResult, "verification" | "product_profile" | "candidates_count">,
  profile: ProductProfile,
  candidates: HSCandidate[],
  evidence: Evidence[]
): Promise<VerificationResult> {
  console.log("=== ÉTAPE 5: VERIFIER PASS ===");

  const checks = {
    code_in_candidates: false,
    evidence_not_empty: false,
    justification_cites_evidence: false,
    coherence_product_code: true,
  };

  // CHECK 1: code ∈ candidates[]
  if (result.recommended_code) {
    const normalizedCode = result.recommended_code.replace(/\./g, "");
    checks.code_in_candidates = candidates.some(
      c => c.code_10.replace(/\./g, "") === normalizedCode
    );
    if (!checks.code_in_candidates) {
      console.error(`ÉCHEC: code ${result.recommended_code} ∉ candidates[]`);
    }
  } else {
    // Pas de code = OK si NEED_INFO/LOW_CONFIDENCE
    checks.code_in_candidates = result.status !== "DONE";
  }

  // CHECK 2: evidence[] non vide (si DONE)
  if (result.status === "DONE") {
    checks.evidence_not_empty = result.evidence.length > 0;
    if (!checks.evidence_not_empty) {
      console.error("ÉCHEC: evidence[] vide pour DONE");
    }
  } else {
    checks.evidence_not_empty = true;
  }

  // CHECK 3: justification cite evidence
  if (result.justification_short && result.evidence.length > 0) {
    const justifLower = result.justification_short.toLowerCase();
    checks.justification_cites_evidence = result.evidence.some(
      e => justifLower.includes(e.ref.toLowerCase()) || 
           justifLower.includes(e.source.toLowerCase()) ||
           e.excerpt.split(" ").slice(0, 5).some(w => 
             w.length > 3 && justifLower.includes(w.toLowerCase())
           )
    );
    if (!checks.justification_cites_evidence) {
      console.warn("WARN: justification ne cite pas evidence[]");
    }
  } else if (result.status !== "DONE") {
    checks.justification_cites_evidence = true;
  }

  // CHECK 4: cohérence produit/code
  if (result.status === "DONE" && result.recommended_code && checks.code_in_candidates) {
    const matchingCandidate = candidates.find(
      c => c.code_10.replace(/\./g, "") === result.recommended_code!.replace(/\./g, "")
    );
    
    if (matchingCandidate) {
      const similarity = calculateTextSimilarity(
        profile.description + " " + profile.product_name,
        matchingCandidate.label_fr
      );
      checks.coherence_product_code = similarity > 0.05 || matchingCandidate.dum_count > 0;
      if (!checks.coherence_product_code) {
        console.warn(`WARN: faible cohérence produit/code (${similarity})`);
      }
    }
  }

  const allPassed = Object.values(checks).every(v => v);
  
  // Correction si code invalide
  let correctedCode: string | null = null;
  if (!allPassed && !checks.code_in_candidates && result.recommended_code) {
    const bestCandidate = candidates[0];
    if (bestCandidate) {
      correctedCode = bestCandidate.code_10;
      console.log(`Correction: ${result.recommended_code} → ${correctedCode}`);
    }
  }

  const failedChecks = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const details = allPassed 
    ? "VERIFIER PASS: Toutes les vérifications OK"
    : `VERIFIER FAIL: ${failedChecks.join(", ")}`;

  console.log(details);

  return {
    passed: allPassed,
    checks,
    details,
    corrected_code: correctedCode,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const body: ClassifyRequest = await req.json();
    const { case_id, file_urls, answers, context } = body;

    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║        PIPELINE CLASSIFICATION ANTI-HALLUCINATION     ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("Case:", case_id, "Files:", file_urls.length, "Answers:", Object.keys(answers).length);

    if (!case_id) {
      return new Response(
        JSON.stringify({ error: "case_id requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get case
    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("*")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return new Response(
        JSON.stringify({ error: "Case non trouvé" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Audit log start
    await supabase.from("audit_logs").insert({
      case_id,
      action: "classify_called",
      user_id: caseData.created_by,
      user_phone: "system",
      meta: { 
        file_urls_count: file_urls.length, 
        answers_count: Object.keys(answers).length,
        pipeline: "anti-hallucination-v2",
      },
    });

    // ═══════════════════════════════════════════════════════════
    // ÉTAPE 1: EXTRACTION VISION → ProductProfile
    // ═══════════════════════════════════════════════════════════
    const profile = await extractProductProfile(file_urls, caseData.product_name, answers);

    // ═══════════════════════════════════════════════════════════
    // ÉTAPE 2: GÉNÉRATION candidates[] AVANT LLM
    // ═══════════════════════════════════════════════════════════
    const candidates = await generateCandidatesList(
      supabase,
      profile,
      caseData.company_id,
      context.origin_country,
      30
    );

    // ═══════════════════════════════════════════════════════════
    // ÉTAPE 3: RAG evidence[] (pgvector)
    // ═══════════════════════════════════════════════════════════
    const evidence = await searchEvidenceRAG(supabase, profile, candidates, 15);

    // ═══════════════════════════════════════════════════════════
    // ÉTAPE 4: DÉCISION CONTRÔLÉE (GPT-4.1)
    // ═══════════════════════════════════════════════════════════
    let result = await makeControlledDecision(profile, candidates, evidence, context, answers);

    // ═══════════════════════════════════════════════════════════
    // ÉTAPE 5: VERIFIER PASS
    // ═══════════════════════════════════════════════════════════
    const verification = await verifyResult(result, profile, candidates, evidence);

    // Appliquer corrections
    if (!verification.passed) {
      if (verification.corrected_code) {
        result.recommended_code = verification.corrected_code;
        result.justification_short = `[CORRIGÉ] ${result.justification_short}`;
        if (result.confidence) {
          result.confidence = Math.max(0.5, result.confidence * 0.7);
          result.confidence_level = result.confidence >= 0.65 ? "medium" : "low";
        }
      } else if (!verification.checks.evidence_not_empty && result.status === "DONE") {
        // RÈGLE: Jamais de DONE sans evidence
        result.status = "VERIFICATION_FAILED";
        result.error_message = "Classification rejetée: aucune preuve documentaire";
        result.recommended_code = null;
        result.confidence = null;
        result.confidence_level = null;
      }
    }

    // Résultat final
    const finalResult: HSResult = {
      ...result,
      verification: {
        passed: verification.passed,
        checks: verification.checks,
        details: verification.details,
      },
      product_profile: profile,
      candidates_count: candidates.length,
    };

    // Audit log verification
    await supabase.from("audit_logs").insert({
      case_id,
      action: "classify_verified",
      user_id: caseData.created_by,
      user_phone: "system",
      meta: {
        verification_passed: verification.passed,
        verification_checks: verification.checks,
        recommended_code: finalResult.recommended_code,
        candidates_count: candidates.length,
        evidence_count: evidence.length,
        pipeline: "anti-hallucination-v2",
      },
    });

    // Save result
    await supabase.from("classification_results").insert({
      case_id,
      status: finalResult.status,
      recommended_code: finalResult.recommended_code,
      confidence: finalResult.confidence,
      confidence_level: finalResult.confidence_level,
      justification_short: finalResult.justification_short,
      alternatives: finalResult.alternatives,
      evidence: finalResult.evidence,
      next_question: finalResult.next_question,
      error_message: finalResult.error_message,
      answers: finalResult.answers,
    });

    // Update case status
    let newStatus = caseData.status;
    if (finalResult.status === "DONE" && verification.passed && finalResult.evidence.length > 0) {
      newStatus = "RESULT_READY";
    } else if (finalResult.status === "ERROR" || finalResult.status === "VERIFICATION_FAILED") {
      newStatus = "ERROR";
    }

    if (newStatus !== caseData.status) {
      await supabase.from("cases").update({ status: newStatus }).eq("id", case_id);
      
      if (newStatus === "RESULT_READY") {
        await supabase.from("audit_logs").insert({
          case_id,
          action: "result_ready",
          user_id: caseData.created_by,
          user_phone: "system",
          meta: {
            recommended_code: finalResult.recommended_code,
            confidence: finalResult.confidence,
            evidence_count: finalResult.evidence.length,
          },
        });
      }
    }

    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log(`║ PIPELINE TERMINÉ: ${finalResult.status.padEnd(37)}║`);
    console.log(`║ Verifier: ${verification.passed ? "PASS" : "FAIL"}`.padEnd(56) + "║");
    console.log("╚═══════════════════════════════════════════════════════╝");

    return new Response(
      JSON.stringify(finalResult),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Pipeline error:", error);
    return new Response(
      JSON.stringify({
        status: "ERROR",
        error_message: error instanceof Error ? error.message : "Erreur inconnue",
        recommended_code: null,
        confidence: null,
        confidence_level: null,
        justification_short: null,
        alternatives: [],
        evidence: [],
        next_question: null,
        verification: null,
        product_profile: null,
        candidates_count: 0,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
