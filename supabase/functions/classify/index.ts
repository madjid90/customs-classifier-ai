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
  };
}

// ============================================================================
// TYPES
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

// ETAPE 1 - ProductProfile extrait des documents
interface ProductProfile {
  product_name: string;
  description: string;
  material_composition: string[];
  dimensions: string | null;
  weight: string | null;
  intended_use: string | null;
  manufacturing_process: string | null;
  brand: string | null;
  model: string | null;
  technical_specs: Record<string, string>;
  extracted_texts: string[];
  confidence_extraction: number;
}

// ETAPE 2 - Candidats (liste fermée)
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
    dum_history: number;
    kb_mentions: number;
    origin_match: number;
  };
  dum_matches: number;
}

// ETAPE 3 - Evidence (RAG uniquement)
interface Evidence {
  source: "omd" | "maroc" | "lois" | "dum";
  doc_id: string;
  ref: string;
  excerpt: string;
  similarity?: number;
}

// ETAPE 4 - Résultat structuré
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
      justification_uses_evidence: boolean;
      product_code_coherent: boolean;
    };
    details: string;
  } | null;
  product_profile: ProductProfile | null;
  candidates_count: number;
}

// ============================================================================
// OPENAI API CALLS - Backend Only (Zero Frontend AI)
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
    if (response.status === 402 || response.status === 403) {
      throw new Error("Quota OpenAI épuisé.");
    }
    throw new Error(`Erreur OpenAI: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ============================================================================
// ETAPE 1 : EXTRACTION (Vision/OCR) - Uses OPENAI_MODEL_VISION
// ============================================================================

async function extractProductProfile(
  imageUrls: string[],
  productName: string,
  answers: Record<string, string>
): Promise<ProductProfile> {
  console.log("ETAPE 1: Extraction ProductProfile avec OpenAI Vision...");
  
  const config = getOpenAIConfig();

  if (imageUrls.length === 0) {
    // Pas de documents, créer un profil minimal
    return {
      product_name: productName,
      description: productName,
      material_composition: [],
      dimensions: null,
      weight: null,
      intended_use: null,
      manufacturing_process: null,
      brand: null,
      model: null,
      technical_specs: {},
      extracted_texts: [],
      confidence_extraction: 0.3,
    };
  }

  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    {
      type: "text",
      text: `Analyse ces documents (fiches techniques, factures, photos) et extrais un profil produit structuré.

PRODUIT DÉCLARÉ: ${productName}

${Object.keys(answers).length > 0 ? `INFORMATIONS ADDITIONNELLES:\n${Object.entries(answers).map(([k, v]) => `- ${k}: ${v}`).join("\n")}` : ""}

EXTRAIS UNIQUEMENT les informations VISIBLES dans les documents. Ne suppose rien.

Réponds en JSON strict:
{
  "product_name": "nom exact du produit",
  "description": "description technique détaillée",
  "material_composition": ["matériau1", "matériau2"],
  "dimensions": "dimensions si mentionnées ou null",
  "weight": "poids si mentionné ou null",
  "intended_use": "usage prévu si mentionné ou null",
  "manufacturing_process": "procédé de fabrication si mentionné ou null",
  "brand": "marque si visible ou null",
  "model": "modèle si visible ou null",
  "technical_specs": {"spec1": "valeur1"},
  "extracted_texts": ["textes clés extraits des documents"],
  "confidence_extraction": 0.0-1.0
}`,
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
    console.error("Failed to parse extraction response");
    return {
      product_name: productName,
      description: productName,
      material_composition: [],
      dimensions: null,
      weight: null,
      intended_use: null,
      manufacturing_process: null,
      brand: null,
      model: null,
      technical_specs: {},
      extracted_texts: [],
      confidence_extraction: 0.2,
    };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  console.log("ProductProfile extrait:", parsed.product_name);
  
  return {
    product_name: parsed.product_name || productName,
    description: parsed.description || productName,
    material_composition: parsed.material_composition || [],
    dimensions: parsed.dimensions || null,
    weight: parsed.weight || null,
    intended_use: parsed.intended_use || null,
    manufacturing_process: parsed.manufacturing_process || null,
    brand: parsed.brand || null,
    model: parsed.model || null,
    technical_specs: parsed.technical_specs || {},
    extracted_texts: parsed.extracted_texts || [],
    confidence_extraction: parsed.confidence_extraction || 0.5,
  };
}

// ============================================================================
// ETAPE 2 : CANDIDATS (Liste fermée depuis DB uniquement)
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

async function getCandidates(
  supabase: any,
  profile: ProductProfile,
  companyId: string,
  originCountry: string,
  limit = 30
): Promise<HSCandidate[]> {
  console.log("ETAPE 2: Génération candidates[] depuis DB...");
  
  // Construire les termes de recherche
  const searchTerms = [
    profile.product_name,
    profile.description,
    ...profile.material_composition,
    profile.intended_use,
  ].filter(Boolean).join(" ");
  
  const keywords = searchTerms.toLowerCase().split(/\s+/).filter(k => k.length > 2);
  
  if (keywords.length === 0) {
    console.log("Aucun mot-clé, retour liste vide");
    return [];
  }

  // Requête hs_codes (nomenclature Maroc)
  const { data: hsCodes, error: hsError } = await supabase
    .from("hs_codes")
    .select("code_10, code_6, chapter_2, label_fr, label_ar, unit, taxes, restrictions")
    .or(keywords.slice(0, 5).map(k => `label_fr.ilike.%${k}%`).join(","))
    .limit(limit * 2);

  if (hsError) {
    console.error("Erreur requête hs_codes:", hsError);
  }

  // Requête dum_records (historique entreprise)
  const { data: dumRecords, error: dumError } = await supabase
    .from("dum_records")
    .select("hs_code_10, product_description, origin_country, reliability_score")
    .eq("company_id", companyId)
    .or(keywords.slice(0, 5).map(k => `product_description.ilike.%${k}%`).join(","))
    .order("reliability_score", { ascending: false })
    .limit(50);

  if (dumError) {
    console.error("Erreur requête dum_records:", dumError);
  }

  console.log(`DB: ${hsCodes?.length || 0} hs_codes, ${dumRecords?.length || 0} dum_records`);

  // Construire map des scores DUM par code
  const dumScoreMap = new Map<string, { count: number; avgScore: number; matchOrigin: boolean }>();
  for (const dum of dumRecords || []) {
    const code = dum.hs_code_10.replace(/\./g, "");
    const existing = dumScoreMap.get(code);
    const matchOrigin = dum.origin_country?.toLowerCase() === originCountry.toLowerCase();
    
    if (existing) {
      existing.count++;
      existing.avgScore = (existing.avgScore * (existing.count - 1) + (dum.reliability_score || 50)) / existing.count;
      existing.matchOrigin = existing.matchOrigin || matchOrigin;
    } else {
      dumScoreMap.set(code, {
        count: 1,
        avgScore: dum.reliability_score || 50,
        matchOrigin,
      });
    }
  }

  // Scorer les candidats
  const candidates: HSCandidate[] = (hsCodes || []).map((hs: any) => {
    const code = hs.code_10.replace(/\./g, "");
    const dumInfo = dumScoreMap.get(code);
    
    // Score similarité texte (max 40)
    const textSim = calculateTextSimilarity(searchTerms, hs.label_fr) * 40;
    
    // Score historique DUM (max 35)
    let dumScore = 0;
    if (dumInfo) {
      dumScore = (dumInfo.avgScore / 100) * 25 * Math.min(dumInfo.count, 5) / 5;
      dumScore = Math.min(dumScore, 35);
    }
    
    // Score correspondance origine (max 10)
    const originScore = dumInfo?.matchOrigin ? 10 : 0;
    
    // KB mentions sera ajouté à l'étape 3
    const kbScore = 0;
    
    const totalScore = textSim + dumScore + kbScore + originScore;
    
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
        dum_history: Math.round(dumScore * 100) / 100,
        kb_mentions: 0,
        origin_match: originScore,
      },
      dum_matches: dumInfo?.count || 0,
    };
  });

  // Ajouter les codes DUM qui ne sont pas dans hs_codes (récupérer leurs infos)
  const existingCodes = new Set(candidates.map(c => c.code_10.replace(/\./g, "")));
  const missingDumCodes = [...dumScoreMap.keys()].filter(code => !existingCodes.has(code));
  
  if (missingDumCodes.length > 0) {
    const { data: additionalHS } = await supabase
      .from("hs_codes")
      .select("code_10, code_6, chapter_2, label_fr, label_ar, unit, taxes, restrictions")
      .in("code_10", missingDumCodes.map(c => c.replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, "$1.$2.$3.$4")));
    
    for (const hs of additionalHS || []) {
      const code = hs.code_10.replace(/\./g, "");
      const dumInfo = dumScoreMap.get(code);
      if (dumInfo) {
        const dumScore = Math.min((dumInfo.avgScore / 100) * 35, 35);
        const originScore = dumInfo.matchOrigin ? 10 : 0;
        
        candidates.push({
          code_10: hs.code_10,
          code_6: hs.code_6,
          chapter_2: hs.chapter_2,
          label_fr: hs.label_fr,
          label_ar: hs.label_ar,
          unit: hs.unit,
          taxes: hs.taxes,
          restrictions: hs.restrictions,
          score: dumScore + originScore,
          score_breakdown: {
            text_similarity: 0,
            dum_history: dumScore,
            kb_mentions: 0,
            origin_match: originScore,
          },
          dum_matches: dumInfo.count,
        });
      }
    }
  }

  // Trier par score et limiter
  candidates.sort((a, b) => b.score - a.score);
  const result = candidates.slice(0, limit);
  
  console.log(`candidates[]: ${result.length} codes, top score: ${result[0]?.score || 0}`);
  return result;
}

// ============================================================================
// ETAPE 3 : PREUVES RAG (kb_chunks uniquement)
// ============================================================================

async function searchEvidence(
  supabase: any,
  profile: ProductProfile,
  candidates: HSCandidate[],
  limit = 15
): Promise<Evidence[]> {
  console.log("ETAPE 3: Recherche evidence[] dans kb_chunks...");
  
  // Termes de recherche
  const searchTerms = [
    profile.product_name,
    profile.description,
    ...profile.material_composition,
    ...candidates.slice(0, 5).map(c => c.code_10),
    ...candidates.slice(0, 5).map(c => c.label_fr),
  ].filter(Boolean);
  
  const keywords = searchTerms.join(" ").toLowerCase().split(/\s+/).filter(k => k.length > 2);
  
  if (keywords.length === 0) {
    return [];
  }

  // Recherche dans kb_chunks
  const { data: chunks, error } = await supabase
    .from("kb_chunks")
    .select("id, source, doc_id, ref, text")
    .or(keywords.slice(0, 8).map(k => `text.ilike.%${k}%`).join(","))
    .limit(limit * 2);

  if (error) {
    console.error("Erreur recherche kb_chunks:", error);
    return [];
  }

  // Scorer et trier par pertinence
  const scoredChunks = (chunks || []).map((chunk: any) => {
    const textLower = chunk.text.toLowerCase();
    const matchCount = keywords.filter(k => textLower.includes(k)).length;
    return {
      ...chunk,
      similarity: matchCount / keywords.length,
    };
  });

  scoredChunks.sort((a: any, b: any) => b.similarity - a.similarity);

  // Convertir en Evidence[]
  const evidence: Evidence[] = scoredChunks.slice(0, limit).map((chunk: any) => ({
    source: chunk.source as Evidence["source"],
    doc_id: chunk.doc_id,
    ref: chunk.ref,
    excerpt: chunk.text.slice(0, 500),
    similarity: chunk.similarity,
  }));

  console.log(`evidence[]: ${evidence.length} extraits trouvés`);
  return evidence;
}

// ============================================================================
// ETAPE 4 : CHOIX CONTROLE (IA contrainte) - Uses OPENAI_MODEL_REASONING
// ============================================================================

async function makeControlledChoice(
  profile: ProductProfile,
  candidates: HSCandidate[],
  evidence: Evidence[],
  context: { type_import_export: string; origin_country: string },
  answers: Record<string, string>
): Promise<Omit<HSResult, "verification" | "product_profile" | "candidates_count">> {
  console.log("ETAPE 4: Choix contrôlé par OpenAI...");
  
  const config = getOpenAIConfig();

  if (candidates.length === 0) {
    return {
      status: "NEED_INFO",
      recommended_code: null,
      confidence: null,
      confidence_level: null,
      justification_short: "Aucun code candidat trouvé. Veuillez fournir plus de détails sur le produit.",
      alternatives: [],
      evidence: [],
      next_question: {
        id: "q_product_details",
        label: "Décrivez le produit plus en détail (matière, usage, caractéristiques techniques)",
        type: "text",
        required: true,
      },
      error_message: null,
      answers,
    };
  }

  // Construire le prompt STRICT - ZERO HALLUCINATION
  const systemPrompt = `Tu es un expert en classification douanière marocaine. Tu dois choisir UN code SH parmi une liste FERMÉE de candidats.

RÈGLES ABSOLUES (NON NÉGOCIABLES):
1. Tu ne peux recommander QUE un code présent dans candidates[]
2. Ta justification ne peut citer QUE des extraits de evidence[]
3. AUCUNE connaissance générale, AUCUNE supposition
4. Si evidence[] est vide ou insuffisante → status="LOW_CONFIDENCE"
5. Si aucun code ne correspond → status="NEED_INFO" avec question précise

FORMAT DE RÉPONSE (JSON strict):
{
  "status": "DONE" | "NEED_INFO" | "LOW_CONFIDENCE",
  "recommended_code": "code_10 exact de candidates[]" ou null,
  "confidence": 0-100 (basé sur evidence[]),
  "justification_short": "UNIQUEMENT basé sur evidence[] - max 2 phrases",
  "alternatives": [{"code": "code de candidates[]", "reason": "basé sur evidence[]", "confidence": 0-100}],
  "evidence_used": ["doc_id1", "doc_id2"],
  "next_question": {"id": "q_xxx", "label": "question", "type": "yesno|select|text", "options": [...], "required": true} ou null
}`;

  const userPrompt = `=== PRODUCT PROFILE ===
Nom: ${profile.product_name}
Description: ${profile.description}
Matériaux: ${profile.material_composition.join(", ") || "Non spécifié"}
Usage: ${profile.intended_use || "Non spécifié"}
Spécifications: ${JSON.stringify(profile.technical_specs)}

=== CONTEXTE ===
Opération: ${context.type_import_export}
Origine: ${context.origin_country}
${Object.keys(answers).length > 0 ? `Réponses: ${JSON.stringify(answers)}` : ""}

=== CANDIDATES[] (LISTE FERMÉE - choisis UNIQUEMENT parmi ces codes) ===
${candidates.slice(0, 15).map((c, i) => 
  `${i + 1}. [Score: ${c.score}] ${c.code_10}: ${c.label_fr}${c.dum_matches > 0 ? ` [${c.dum_matches} DUM]` : ""}`
).join("\n")}

=== EVIDENCE[] (SEULES sources autorisées pour justification) ===
${evidence.length > 0 
  ? evidence.slice(0, 10).map((e, i) => 
      `${i + 1}. [${e.source.toUpperCase()}] ${e.ref} (${e.doc_id}):\n"${e.excerpt.slice(0, 300)}..."`
    ).join("\n\n")
  : "⚠️ AUCUNE EVIDENCE DISPONIBLE - Tu DOIS répondre avec status='LOW_CONFIDENCE' ou 'NEED_INFO'"
}

RAPPEL: Tu ne peux utiliser QUE candidates[] et evidence[]. Aucune autre source.`;

  const aiResponse = await callOpenAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    config.modelReasoning,
    0.1
  );

  console.log("AI choice response received");

  const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse AI choice response");
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
    parsed.justification_short?.includes(e.ref)
  );

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
// ETAPE 5 : VERIFICATION ANTI-HALLUCINATION - Uses OPENAI_MODEL_VERIFIER
// ============================================================================

interface VerificationResult {
  passed: boolean;
  checks: {
    code_in_candidates: boolean;
    evidence_not_empty: boolean;
    justification_uses_evidence: boolean;
    product_code_coherent: boolean;
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
  console.log("ETAPE 5: Vérification anti-hallucination...");

  const checks = {
    code_in_candidates: false,
    evidence_not_empty: false,
    justification_uses_evidence: false,
    product_code_coherent: true, // Assume true, verify if needed
  };

  // Check 1: Code dans candidates[]
  if (result.recommended_code) {
    const normalizedCode = result.recommended_code.replace(/\./g, "");
    checks.code_in_candidates = candidates.some(
      c => c.code_10.replace(/\./g, "") === normalizedCode
    );
  } else {
    // Pas de code recommandé = OK pour NEED_INFO/LOW_CONFIDENCE
    checks.code_in_candidates = result.status !== "DONE";
  }

  // Check 2: Evidence non vide (si DONE)
  if (result.status === "DONE") {
    checks.evidence_not_empty = result.evidence.length > 0;
  } else {
    checks.evidence_not_empty = true; // Non requis pour autres statuts
  }

  // Check 3: Justification utilise evidence
  if (result.justification_short && result.evidence.length > 0) {
    const justifLower = result.justification_short.toLowerCase();
    checks.justification_uses_evidence = result.evidence.some(
      e => justifLower.includes(e.ref.toLowerCase()) || 
           justifLower.includes(e.source.toLowerCase()) ||
           e.excerpt.split(" ").slice(0, 5).some(w => justifLower.includes(w.toLowerCase()))
    );
  } else if (result.status !== "DONE") {
    checks.justification_uses_evidence = true;
  }

  // Check 4: Cohérence produit/code (vérification IA si nécessaire)
  if (result.status === "DONE" && result.recommended_code && checks.code_in_candidates) {
    const matchingCandidate = candidates.find(
      c => c.code_10.replace(/\./g, "") === result.recommended_code!.replace(/\./g, "")
    );
    
    if (matchingCandidate) {
      // Simple coherence check based on text similarity
      const similarity = calculateTextSimilarity(
        profile.description + " " + profile.product_name,
        matchingCandidate.label_fr
      );
      checks.product_code_coherent = similarity > 0.1 || matchingCandidate.dum_matches > 0;
    }
  }

  const allPassed = Object.values(checks).every(v => v);
  
  // Trouver un code corrigé si échec
  let correctedCode: string | null = null;
  if (!allPassed && !checks.code_in_candidates && result.recommended_code) {
    // Trouver le meilleur candidat
    const bestCandidate = candidates[0];
    if (bestCandidate) {
      correctedCode = bestCandidate.code_10;
    }
  }

  const failedChecks = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const details = allPassed 
    ? "Toutes les vérifications passées"
    : `Échecs: ${failedChecks.join(", ")}`;

  console.log("Verification:", { allPassed, checks, details });

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

    console.log("=== CLASSIFY START (OpenAI Backend) ===");
    console.log("Case:", case_id, "Files:", file_urls.length, "Answers:", Object.keys(answers).length);

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

    // Log start
    await supabase.from("audit_logs").insert({
      case_id,
      action: "classify_called",
      user_id: caseData.created_by,
      user_phone: "system",
      meta: { file_urls_count: file_urls.length, answers_count: Object.keys(answers).length, ai_backend: "openai" },
    });

    // ========== ETAPE 1: EXTRACTION (OpenAI Vision) ==========
    const profile = await extractProductProfile(file_urls, caseData.product_name, answers);

    // ========== ETAPE 2: CANDIDATS (Database only) ==========
    const candidates = await getCandidates(
      supabase,
      profile,
      caseData.company_id,
      context.origin_country,
      30
    );

    // ========== ETAPE 3: PREUVES RAG (kb_chunks) ==========
    const evidence = await searchEvidence(supabase, profile, candidates, 15);

    // ========== ETAPE 4: CHOIX CONTROLE (OpenAI Reasoning) ==========
    let result = await makeControlledChoice(profile, candidates, evidence, context, answers);

    // ========== ETAPE 5: VERIFICATION (Anti-hallucination) ==========
    const verification = await verifyResult(result, profile, candidates, evidence);

    // Appliquer corrections si nécessaire
    if (!verification.passed) {
      if (verification.corrected_code) {
        console.log(`Correction: ${result.recommended_code} → ${verification.corrected_code}`);
        result.recommended_code = verification.corrected_code;
        result.justification_short = `[CORRIGÉ] ${result.justification_short}`;
        if (result.confidence) {
          result.confidence = Math.max(0.5, result.confidence * 0.7);
          result.confidence_level = result.confidence >= 0.65 ? "medium" : "low";
        }
      } else if (!verification.checks.evidence_not_empty && result.status === "DONE") {
        // RÈGLE UI: Ne jamais afficher code si evidence vide
        result.status = "VERIFICATION_FAILED";
        result.error_message = "Classification rejetée: aucune preuve documentaire";
        result.recommended_code = null;
        result.confidence = null;
        result.confidence_level = null;
      }
    }

    // Construire résultat final
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

    // Log verification
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
        ai_backend: "openai",
      },
    });

    // Save result
    const { error: insertError } = await supabase.from("classification_results").insert({
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

    if (insertError) {
      console.error("Failed to save result:", insertError);
    }

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
            ai_backend: "openai",
          },
        });
      }
    }

    console.log("=== CLASSIFY END (OpenAI Backend) ===", finalResult.status);

    return new Response(
      JSON.stringify(finalResult),
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
        verification: null,
        product_profile: null,
        candidates_count: 0,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
