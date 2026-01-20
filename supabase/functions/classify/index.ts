import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logger } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { 
  getUserFromToken, 
  getUserRole,
  isAdmin as checkIsAdmin,
  createServiceClient,
} from "../_shared/auth.ts";
import { 
  searchExternalCustomsSources,
  type ExternalSearchResult,
} from "../_shared/external-search.ts";
import {
  ClassifyRequestSchema,
  validateInput,
} from "../_shared/validation.ts";
import {
  checkRateLimit,
  rateLimitResponse,
  addRateLimitHeaders,
  RATE_LIMIT_PRESETS,
} from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================================================
// CONFIGURATION OPENAI
// ============================================================================

function getOpenAIConfig() {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY non configurée");
  }
  return {
    apiKey,
    modelVision: "gpt-4o",
    modelReasoning: "gpt-4o",
    modelEmbeddings: "text-embedding-3-large",
  };
}

// ============================================================================
// TIMEOUT MANAGEMENT
// ============================================================================

const CLASSIFY_TIMEOUT_MS = 25000; // 25 secondes (marge avant 30s Supabase)
const EXTRACTION_TIMEOUT_MS = 10000; // 10s pour extraction vision
const EMBEDDING_TIMEOUT_MS = 5000; // 5s pour embedding
const EXTERNAL_SEARCH_TIMEOUT_MS = 10000; // 10s pour recherche externe
const DECISION_TIMEOUT_MS = 12000; // 12s pour décision

class TimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Timeout: ${operation} a dépassé ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(operation, ms));
    }, ms);
    
    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ============================================================================
// INPUT VALIDATION (Zod)
// ============================================================================

// ClassifyRequestSchema imported from _shared/validation.ts

type ClassifyRequest = { case_id: string };

// ============================================================================
// TYPES STRICTS
// ============================================================================

// ETAPE 1 - ProductProfile STRICT
interface ProductProfile {
  product_name: string;
  description: string;
  usage_function: string | null;
  material_composition: string[];
  technical_specs: Record<string, string>;
  brand: string | null;
  model: string | null;
  confidence_extraction: number;
}

// ETAPE 2 - Candidats (LISTE FERMÉE)
interface HSCandidate {
  code_10: string;
  code_6: string;
  chapter_2: string;
  label_fr: string;
  label_ar: string | null;
  unit: string | null;
  taxes: Record<string, unknown> | null;
  score: number;
  match_keywords: string[];
}

// ETAPE 3 - Evidence RAG
interface Evidence {
  source: "omd" | "maroc" | "lois" | "dum";
  doc_id: string;
  ref: string;
  excerpt: string;
  similarity: number;
  source_url?: string;  // URL vers le document original
  page_number?: number; // Numéro de page si PDF
  external?: boolean;   // true si source externe, false si base interne
}

// ETAPE 4/5 - Résultat final
interface HSResult {
  status: "DONE" | "NEED_INFO" | "LOW_CONFIDENCE" | "ERROR";
  recommended_code: string | null;
  confidence: number | null;
  confidence_level: "high" | "medium" | "low" | null;
  justification_short: string | null;
  justification_detailed: {
    summary: string;
    reasoning_steps: string[];
    sources_cited: Array<{
      source: string;
      reference: string;
      relevance: string;
    }>;
    key_factors: string[];
  } | null;
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
    };
    details: string;
  } | null;
  product_profile: ProductProfile | null;
  candidates_count: number;
}

// ============================================================================
// OPENAI API CALLS
// ============================================================================

async function callOpenAI(
  messages: Array<{ role: string; content: any }>,
  model: string,
  temperature = 0.1
): Promise<string> {
  const config = getOpenAIConfig();
  
  logger.debug(`Calling OpenAI ${model}...`);

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
  
  console.log(`[classify] Generating embedding...`);

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.modelEmbeddings,
      input: text.substring(0, 8000),
      dimensions: 1536,
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
// ÉTAPE 1 : EXTRACTION VISION
// ============================================================================

async function extractProductProfile(
  imageUrls: string[],
  productName: string,
  previousAnswers: Record<string, string>
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
      brand: null,
      model: null,
      confidence_extraction: 0.2,
    };
  }

  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    {
      type: "text",
      text: `Analyse ces documents et extrais un profil produit STRICT.

PRODUIT DÉCLARÉ: ${productName}

${Object.keys(previousAnswers).length > 0 ? `INFORMATIONS COMPLÉMENTAIRES:\n${Object.entries(previousAnswers).map(([k, v]) => `- ${k}: ${v}`).join("\n")}` : ""}

EXTRAIS UNIQUEMENT ce qui est VISIBLE dans les documents.
NE SUPPOSE RIEN qui n'est pas explicitement mentionné.

Réponds UNIQUEMENT en JSON strict:
{
  "product_name": "nom exact visible",
  "description": "description détaillée",
  "usage_function": "usage/fonction si visible",
  "material_composition": ["matériaux visibles"],
  "technical_specs": {"spec1": "valeur1"},
  "brand": "marque si visible",
  "model": "modèle si visible",
  "confidence_extraction": 0.0-1.0
}`
    },
  ];

  for (const url of imageUrls.slice(0, 10)) {
    content.push({ type: "image_url", image_url: { url } });
  }

  try {
    const aiResponse = await withTimeout(
      callOpenAI(
        [{ role: "user", content }],
        config.modelVision,
        0.1
      ),
      EXTRACTION_TIMEOUT_MS,
      "extraction vision"
    );
    
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Échec parsing extraction");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log("ProductProfile extrait:", parsed.product_name, "conf:", parsed.confidence_extraction);
    
    return {
      product_name: parsed.product_name || productName,
      description: parsed.description || productName,
      usage_function: parsed.usage_function || null,
      material_composition: parsed.material_composition || [],
      technical_specs: parsed.technical_specs || {},
      brand: parsed.brand || null,
      model: parsed.model || null,
      confidence_extraction: parsed.confidence_extraction || 0.5,
    };
  } catch (e) {
    console.error("Erreur extraction:", e);
    return {
      product_name: productName,
      description: productName,
      usage_function: null,
      material_composition: [],
      technical_specs: {},
      brand: null,
      model: null,
      confidence_extraction: 0.1,
    };
  }
}

// ============================================================================
// ÉTAPE 2 : GÉNÉRATION CANDIDATS (HYBRIDE: TEXTUEL + SÉMANTIQUE)
// ============================================================================

interface HSCandidateWithSource extends HSCandidate {
  source?: "textual" | "semantic" | "hybrid";
}

async function generateCandidatesList(
  supabase: any,
  profile: ProductProfile,
  maxCandidates = 30
): Promise<HSCandidate[]> {
  console.log("=== ÉTAPE 2: GÉNÉRATION CANDIDATS (HYBRIDE) ===");
  
  // ============================================
  // PARTIE A : Recherche textuelle (existante)
  // ============================================
  
  // Extraire mots-clés du profil
  const allText = [
    profile.product_name,
    profile.description,
    profile.usage_function,
    ...profile.material_composition,
    ...Object.values(profile.technical_specs),
    profile.brand,
    profile.model,
  ].filter(Boolean).join(" ");
  
  // Mots-clés significatifs (> 2 chars, pas de stopwords)
  const stopwords = new Set(["les", "des", "une", "pour", "avec", "dans", "sur", "par", "que", "qui", "est", "sont", "ont", "aux", "cette", "ces"]);
  const keywords = allText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[\s,;.()\/\-]+/)
    .filter(k => k.length > 2 && !stopwords.has(k))
    .slice(0, 15);

  let textualCandidates: HSCandidateWithSource[] = [];

  if (keywords.length > 0) {
    console.log(`[TEXTUEL] Recherche avec ${keywords.length} mots-clés:`, keywords.slice(0, 5).join(", "));

    // Recherche SQL avec ILIKE sur les mots-clés
    const orConditions = keywords.slice(0, 8).map(k => `label_fr.ilike.%${k}%`).join(",");
    
    const { data: hsCodes, error: hsError } = await supabase
      .from("hs_codes")
      .select("code_10, code_6, chapter_2, label_fr, label_ar, unit, taxes, enrichment")
      .eq("active", true)
      .or(orConditions)
      .limit(maxCandidates * 3);

    if (hsError) {
      console.error("[TEXTUEL] Erreur hs_codes:", hsError);
    } else if (hsCodes && hsCodes.length > 0) {
      // Scorer chaque candidat par nombre de mots-clés matchés
      textualCandidates = hsCodes.map((hs: any) => {
        const labelLower = hs.label_fr.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const enrichmentText = hs.enrichment 
          ? JSON.stringify(hs.enrichment).toLowerCase() 
          : "";
        const fullText = labelLower + " " + enrichmentText;
        
        const matchedKeywords = keywords.filter(k => fullText.includes(k));
        const score = matchedKeywords.length / keywords.length;
        
        return {
          code_10: hs.code_10,
          code_6: hs.code_6,
          chapter_2: hs.chapter_2,
          label_fr: hs.label_fr,
          label_ar: hs.label_ar,
          unit: hs.unit,
          taxes: hs.taxes,
          score: Math.round(score * 100) / 100,
          match_keywords: matchedKeywords,
          source: "textual" as const,
        };
      });
      console.log(`[TEXTUEL] ${textualCandidates.length} codes trouvés`);
    }
  }

  // ============================================
  // PARTIE B : Recherche sémantique (NOUVEAU)
  // ============================================
  
  let semanticCandidates: HSCandidateWithSource[] = [];
  
  try {
    // Construire texte de recherche riche
    const searchText = [
      profile.product_name,
      profile.description,
      profile.usage_function,
      ...profile.material_composition,
    ].filter(Boolean).join(" ");
    
    if (searchText.trim().length > 10) {
      console.log(`[SÉMANTIQUE] Génération embedding pour: "${searchText.substring(0, 100)}..."`);
      
      // Générer embedding
      const searchEmbedding = await withTimeout(
        generateEmbedding(searchText),
        EMBEDDING_TIMEOUT_MS,
        "génération embedding candidats"
      );
      
      if (searchEmbedding.length > 0) {
        // Recherche sémantique via match_hs_codes
        const { data: semanticResults, error: semanticError } = await supabase.rpc("match_hs_codes", {
          query_embedding: searchEmbedding,
          match_threshold: 0.4,
          match_count: 20,
        });
        
        if (semanticError) {
          console.error("[SÉMANTIQUE] Erreur match_hs_codes:", semanticError);
        } else if (semanticResults && semanticResults.length > 0) {
          semanticCandidates = semanticResults.map((hs: any) => ({
            code_10: hs.code_10,
            code_6: hs.code_6,
            chapter_2: hs.chapter_2,
            label_fr: hs.label_fr,
            label_ar: hs.label_ar,
            unit: hs.unit,
            taxes: hs.taxes,
            score: Math.round(hs.similarity * 100) / 100,
            match_keywords: ["semantic"],
            source: "semantic" as const,
          }));
          console.log(`[SÉMANTIQUE] ${semanticCandidates.length} codes trouvés (similarité > 0.4)`);
        } else {
          console.log("[SÉMANTIQUE] Aucun résultat au-dessus du seuil");
        }
      }
    }
  } catch (e) {
    console.error("[SÉMANTIQUE] Erreur:", e);
    // Continue avec résultats textuels uniquement
  }

  // ============================================
  // FUSION DES RÉSULTATS
  // ============================================
  
  const candidateMap = new Map<string, HSCandidateWithSource>();
  
  // Ajouter les candidats textuels
  for (const c of textualCandidates) {
    candidateMap.set(c.code_10, { ...c });
  }
  
  // Fusionner les candidats sémantiques
  for (const c of semanticCandidates) {
    if (candidateMap.has(c.code_10)) {
      // Présent dans les deux → bonus de score x1.5
      const existing = candidateMap.get(c.code_10)!;
      existing.score = Math.min(1, Math.round(existing.score * 1.5 * 100) / 100);
      existing.match_keywords = [...existing.match_keywords, "semantic_boost"];
      existing.source = "hybrid";
    } else {
      // Uniquement sémantique
      candidateMap.set(c.code_10, c);
    }
  }
  
  // Convertir en array et trier par score décroissant
  const allCandidates = Array.from(candidateMap.values());
  allCandidates.sort((a, b) => b.score - a.score);
  
  const result = allCandidates.slice(0, maxCandidates);
  
  // Stats de fusion
  const hybridCount = result.filter(c => c.source === "hybrid").length;
  const textOnlyCount = result.filter(c => c.source === "textual").length;
  const semOnlyCount = result.filter(c => c.source === "semantic").length;
  
  console.log(`[HYBRIDE] ${result.length} candidats finaux:`);
  console.log(`  - hybrid (texte+sémantique): ${hybridCount}`);
  console.log(`  - textuel uniquement: ${textOnlyCount}`);
  console.log(`  - sémantique uniquement: ${semOnlyCount}`);
  console.log(`  - top: ${result[0]?.code_10 || "N/A"} (score: ${result[0]?.score || 0}, source: ${result[0]?.source || "N/A"})`);
  
  // Nettoyer le champ source avant de retourner (pas dans l'interface finale)
  return result.map(({ source, ...rest }) => rest) as HSCandidate[];
}

// ============================================================================
// ÉTAPE 2.5 : SIGNAL DUM (BOOST HISTORIQUE)
// ============================================================================

interface DUMSignal {
  count: number;
  reliability: number;
  latest: string;
}

interface HSCandidateWithDUM extends HSCandidate {
  dum_signal?: DUMSignal;
}

async function applyDUMSignal(
  supabase: any,
  candidates: HSCandidate[],
  companyId: string,
  profile: ProductProfile
): Promise<HSCandidate[]> {
  console.log("=== ÉTAPE 2.5: SIGNAL DUM ===");
  
  if (candidates.length === 0) return candidates;
  
  try {
    // Extraire mots-clés pour la recherche DUM
    const keywords = [
      profile.product_name,
      profile.brand,
      profile.model,
      ...profile.material_composition,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .split(/\s+/)
      .filter(k => k.length > 2)
      .slice(0, 10);
    
    if (keywords.length === 0) {
      console.log("[DUM] Pas de mots-clés pour signal DUM");
      return candidates;
    }
    
    console.log(`[DUM] Recherche avec ${keywords.length} mots-clés:`, keywords.slice(0, 5).join(", "));
    
    // Appeler get_dum_signal
    const { data: dumSignal, error } = await supabase.rpc("get_dum_signal", {
      p_company_id: companyId,
      p_keywords: keywords,
      p_limit: 20,
    });
    
    if (error) {
      console.error("[DUM] Erreur get_dum_signal:", error);
      return candidates;
    }
    
    if (!dumSignal || dumSignal.length === 0) {
      console.log("[DUM] Aucun signal DUM historique trouvé");
      return candidates;
    }
    
    console.log(`[DUM] Signal trouvé: ${dumSignal.length} codes historiques`);
    
    // Créer une map des signaux DUM
    const dumMap = new Map<string, DUMSignal>();
    for (const d of dumSignal) {
      dumMap.set(d.hs_code_10, {
        count: d.match_count,
        reliability: d.avg_reliability,
        latest: d.latest_date,
      });
    }
    
    // Appliquer le boost aux candidats
    const boostedCandidates: HSCandidateWithDUM[] = candidates.map(c => {
      const signal = dumMap.get(c.code_10);
      if (signal) {
        // Calculer le boost basé sur :
        // - Nombre de matchs (plus = meilleur) → max +20%
        // - Fiabilité moyenne (plus = meilleur) → max +10%
        const countBoost = Math.min(0.2, signal.count * 0.02);
        const reliabilityBoost = (signal.reliability / 100) * 0.1;
        
        const totalBoost = 1 + countBoost + reliabilityBoost;
        const newScore = Math.min(1, Math.round(c.score * totalBoost * 100) / 100);
        
        console.log(`[DUM] Boost ${c.code_10}: ${c.score} → ${newScore} (count=${signal.count}, rel=${signal.reliability})`);
        
        return {
          ...c,
          score: newScore,
          match_keywords: [...c.match_keywords, `dum_signal_${signal.count}`],
          dum_signal: signal,
        };
      }
      return c;
    });
    
    // Re-trier par score décroissant
    boostedCandidates.sort((a, b) => b.score - a.score);
    
    const boostedCount = boostedCandidates.filter(c => c.dum_signal).length;
    console.log(`[DUM] ${boostedCount}/${boostedCandidates.length} candidats boostés par signal historique`);
    
    // Retourner sans le champ dum_signal (non requis dans l'interface HSCandidate)
    return boostedCandidates.map(({ dum_signal, ...rest }) => rest);
    
  } catch (e) {
    console.error("[DUM] Erreur applyDUMSignal:", e);
    return candidates;
  }
}

// ============================================================================
// ÉTAPE 3 : RECHERCHE PREUVES RAG (MULTI-SOURCES INTELLIGENT)
// ============================================================================

interface RAGSearchConfig {
  sources: ("omd" | "maroc" | "lois" | "finance")[];
  minSimilarity: number;
  maxPerSource: number;
}

async function searchEvidenceRAG(
  supabase: any,
  profile: ProductProfile,
  candidates: HSCandidate[],
  limit = 20
): Promise<Evidence[]> {
  console.log("=== ÉTAPE 3: RECHERCHE PREUVES RAG (MULTI-SOURCES) ===");
  
  const allEvidence: Evidence[] = [];

  // ============================================
  // PARTIE A : Construire requêtes de recherche intelligentes
  // ============================================
  
  // Requête principale basée sur le produit
  const mainQuery = [
    profile.product_name,
    profile.description,
    profile.usage_function,
    ...profile.material_composition.slice(0, 3),
  ].filter(Boolean).join(" ");

  // Requête basée sur les codes HS candidats
  const hsQuery = candidates.slice(0, 5).map(c => 
    `${c.chapter_2} ${c.code_6} ${c.label_fr}`
  ).join(" ");

  // Requête technique basée sur les specs
  const techQuery = Object.entries(profile.technical_specs)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" ");

  console.log(`[RAG] Requête principale: "${mainQuery.substring(0, 100)}..."`);

  // ============================================
  // PARTIE B : Recherche vectorielle multi-sources
  // ============================================
  
  try {
    // Générer embedding pour recherche principale
    const mainEmbedding = await withTimeout(
      generateEmbedding(mainQuery + " " + hsQuery),
      EMBEDDING_TIMEOUT_MS,
      "génération embedding RAG principal"
    );
    
    if (mainEmbedding.length > 0) {
      // Recherche dans kb_chunks (Notes OMD, réglementations Maroc, lois)
      const { data: kbChunks, error: kbError } = await supabase.rpc("match_kb_chunks", {
        query_embedding: mainEmbedding,
        match_threshold: 0.35,
        match_count: limit,
        filter_sources: null, // Toutes les sources
      });

      if (kbError) {
        console.error("[RAG] Erreur match_kb_chunks:", kbError);
      } else if (kbChunks && kbChunks.length > 0) {
        console.log(`[RAG] kb_chunks: ${kbChunks.length} résultats`);
        for (const chunk of kbChunks) {
          allEvidence.push({
            source: chunk.source as Evidence["source"],
            doc_id: chunk.doc_id,
            ref: chunk.ref,
            excerpt: chunk.text.slice(0, 600),
            similarity: chunk.similarity,
          });
        }
      }
    }

    // ============================================
    // PARTIE C : Recherche textuelle complémentaire
    // ============================================
    
    // Extraire mots-clés pour recherche textuelle
    const keywords = mainQuery
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/\s+/)
      .filter(k => k.length > 3)
      .slice(0, 8);

    if (keywords.length > 0 && allEvidence.length < limit) {
      console.log(`[RAG] Recherche textuelle avec mots-clés:`, keywords.slice(0, 5).join(", "));
      
      // Recherche hybride avec search_kb_hybrid
      const { data: hybridResults, error: hybridError } = await supabase.rpc("search_kb_hybrid", {
        query_text: keywords.join(" "),
        query_embedding: mainEmbedding.length > 0 ? mainEmbedding : null,
        match_count: Math.max(5, limit - allEvidence.length),
        filter_sources: null,
      });

      if (hybridError) {
        console.error("[RAG] Erreur search_kb_hybrid:", hybridError);
      } else if (hybridResults && hybridResults.length > 0) {
        console.log(`[RAG] search_kb_hybrid: ${hybridResults.length} résultats`);
        
        // Ajouter uniquement les résultats non dupliqués
        const existingIds = new Set(allEvidence.map(e => e.doc_id + e.ref));
        for (const result of hybridResults) {
          const key = result.doc_id + result.ref;
          if (!existingIds.has(key)) {
            existingIds.add(key);
            allEvidence.push({
              source: result.source as Evidence["source"],
              doc_id: result.doc_id,
              ref: result.ref,
              excerpt: result.text.slice(0, 600),
              similarity: result.similarity,
            });
          }
        }
      }
    }

    // ============================================
    // PARTIE D : Recherche dans les articles de loi de finance
    // ============================================
    
    if (allEvidence.length < limit) {
      // Chercher dans finance_law_articles si la table existe
      try {
        const financeKeywords = keywords.slice(0, 5);
        if (financeKeywords.length > 0) {
          const orConditions = financeKeywords.map(k => `content.ilike.%${k}%`).join(",");
          
          const { data: financeArticles, error: financeError } = await supabase
            .from("finance_law_articles")
            .select("id, year, article_number, title, content")
            .or(orConditions)
            .limit(5);

          if (!financeError && financeArticles && financeArticles.length > 0) {
            console.log(`[RAG] finance_law_articles: ${financeArticles.length} résultats`);
            for (const article of financeArticles) {
              allEvidence.push({
                source: "lois",
                doc_id: `lf_${article.year}_${article.article_number}`,
                ref: `Loi de Finance ${article.year} - Art. ${article.article_number}`,
                excerpt: article.content.slice(0, 600),
                similarity: 0.5, // Score fixe pour recherche textuelle
              });
            }
          }
        }
      } catch (e) {
        // Table peut ne pas exister, ignorer silencieusement
        console.log("[RAG] finance_law_articles non disponible");
      }
    }

  } catch (e) {
    console.error("[RAG] Erreur globale:", e);
  }

  // ============================================
  // PARTIE E : RECHERCHE EXTERNE SI INSUFFISANT
  // ============================================
  
  if (allEvidence.length < 3) {
    console.warn(`[RAG] ⚠️ Seulement ${allEvidence.length} preuves internes trouvées, lancement recherche externe...`);
    
    try {
      // Construire query pour recherche externe
      const externalQuery = [
        profile.product_name,
        ...candidates.slice(0, 3).map(c => c.code_6),
      ].filter(Boolean).join(" ");
      
      console.log(`[RAG] Recherche externe: "${externalQuery.substring(0, 80)}..."`);
      
      // Appel avec timeout de 10 secondes max
      const externalResults = await withTimeout(
        searchExternalCustomsSources(externalQuery, {
          maxResults: 10,
          language: "fr",
        }),
        EXTERNAL_SEARCH_TIMEOUT_MS,
        "recherche externe customs"
      );
      
      if (externalResults && externalResults.length > 0) {
        console.log(`[RAG] ✅ ${externalResults.length} résultats externes trouvés`);
        
        const timestamp = Date.now();
        
        for (const result of externalResults) {
          // Mapper source externe vers notre type
          let mappedSource: Evidence["source"] = "maroc";
          if (result.source === "omd") mappedSource = "omd";
          else if (result.source === "eu_taric") mappedSource = "omd"; // EU TARIC -> omd
          else if (result.source === "adii") mappedSource = "maroc";
          
          allEvidence.push({
            source: mappedSource,
            doc_id: `external_${result.source}_${timestamp}`,
            ref: result.title,
            excerpt: result.excerpt.slice(0, 600),
            source_url: result.source_url,
            external: true,
            similarity: result.confidence,
          });
        }
        
        console.log(`[RAG] Total après externe: ${allEvidence.length} preuves`);
      } else {
        console.log(`[RAG] Recherche externe: aucun résultat`);
      }
    } catch (externalError) {
      if (externalError instanceof TimeoutError) {
        console.warn(`[RAG] ⚠️ Recherche externe timeout (${EXTERNAL_SEARCH_TIMEOUT_MS}ms)`);
      } else {
        console.error(`[RAG] Erreur recherche externe:`, externalError);
      }
      // Continuer sans les résultats externes
    }
  }

  // ============================================
  // PARTIE F : Tri et déduplication finale
  // ============================================
  
  // Trier par similarité décroissante
  allEvidence.sort((a, b) => b.similarity - a.similarity);
  
  // Limiter et diversifier les sources
  const finalEvidence: Evidence[] = [];
  const sourceCount: Record<string, number> = {};
  const externalCount = { total: 0 };
  const maxPerSource = Math.ceil(limit / 3);

  for (const e of allEvidence) {
    sourceCount[e.source] = (sourceCount[e.source] || 0) + 1;
    if (e.external) externalCount.total++;
    
    // Limiter par source pour diversité
    if (sourceCount[e.source] <= maxPerSource) {
      finalEvidence.push(e);
    }
    
    if (finalEvidence.length >= limit) break;
  }

  // Stats par source
  const sourceStats = Object.entries(sourceCount)
    .map(([s, c]) => `${s}=${c}`)
    .join(", ");
  const externalStats = externalCount.total > 0 ? ` (${externalCount.total} externes)` : "";
  console.log(`[RAG] Evidence finale: ${finalEvidence.length} extraits (${sourceStats})${externalStats}`);

  return finalEvidence;
}

// ============================================================================
// ÉTAPE 4 : DÉCISION CONTRÔLÉE
// ============================================================================

async function makeControlledDecision(
  profile: ProductProfile,
  candidates: HSCandidate[],
  evidence: Evidence[],
  context: { type_import_export: string; origin_country: string },
  answers: Record<string, string>
): Promise<Omit<HSResult, "verification" | "product_profile" | "candidates_count">> {
  console.log("=== ÉTAPE 4: DÉCISION CONTRÔLÉE ===");
  
  const config = getOpenAIConfig();

  if (candidates.length === 0) {
    return {
      status: "NEED_INFO",
      recommended_code: null,
      confidence: null,
      confidence_level: null,
      justification_short: "Aucun code candidat trouvé. Précisez le produit.",
      justification_detailed: null,
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

  const systemPrompt = `Tu es un expert en classification douanière marocaine.

Tu as accès à une base de données complète contenant:
- Notes explicatives de l'OMD (Organisation Mondiale des Douanes)
- Réglementation douanière marocaine
- Lois de finances et articles fiscaux
- Historique des déclarations DUM validées
- Nomenclature des codes HS avec descriptions enrichies

RÈGLES ABSOLUES (VIOLATION = REJET):
1. Tu DOIS choisir EXACTEMENT un code de candidates[] - AUCUNE INVENTION
2. Tu DOIS justifier UNIQUEMENT avec des citations de evidence[]
3. Cite les sources spécifiques (ex: "Selon Note OMD Ch.84...", "Art. 15 LF 2024...")
4. Si evidence[] est vide ou insuffisante → status='LOW_CONFIDENCE' ou 'NEED_INFO'
5. Si incertain → status='NEED_INFO' avec UNE question discriminante
6. AUCUNE connaissance externe, AUCUNE supposition

ANALYSE DES PREUVES:
- [OMD]: Notes officielles de classification, exemples de produits
- [MAROC]: Règles spécifiques, restrictions, licences requises
- [LOIS]: Taux de droits, exonérations, régimes économiques
- [DUM]: Précédents de classification historiques

Réponds en JSON:
{
  "status": "DONE" | "NEED_INFO" | "LOW_CONFIDENCE",
  "recommended_code": "code_10 EXACT de candidates[]",
  "confidence": 0-100,
  "justification_short": "2-3 phrases résumant la décision",
  "justification_detailed": {
    "summary": "Explication complète de 3-5 phrases expliquant le raisonnement",
    "reasoning_steps": ["Étape 1: analyse du produit", "Étape 2: recherche dans la base", "Étape 3: sélection du code"],
    "sources_cited": [
      {"source": "OMD/MAROC/LOIS/DUM", "reference": "référence exacte de evidence[]", "relevance": "pourquoi cette source est pertinente"}
    ],
    "key_factors": ["facteur déterminant 1", "facteur déterminant 2"]
  },
  "alternatives": [{"code": "...", "reason": "...", "confidence": 0-100}],
  "evidence_used": ["ref1", "ref2"],
  "next_question": null ou {"id": "q_xxx", "label": "Question", "type": "text", "required": true}
}`;

  // Grouper les preuves par source pour une meilleure présentation
  const evidenceBySource: Record<string, Evidence[]> = {};
  for (const e of evidence) {
    if (!evidenceBySource[e.source]) evidenceBySource[e.source] = [];
    evidenceBySource[e.source].push(e);
  }

  const formattedEvidence = Object.entries(evidenceBySource)
    .map(([source, items]) => {
      const sourceLabel = {
        omd: "📘 NOTES OMD (Organisation Mondiale des Douanes)",
        maroc: "🇲🇦 RÉGLEMENTATION MAROCAINE",
        lois: "⚖️ LOIS DE FINANCES ET ARTICLES FISCAUX",
        dum: "📋 HISTORIQUE DUM (Déclarations validées)",
        finance: "💰 LOIS DE FINANCES",
      }[source] || source.toUpperCase();
      
      const itemsFormatted = items.slice(0, 4).map((e, i) => 
        `  ${i + 1}. [${e.ref}] (pertinence: ${(e.similarity * 100).toFixed(0)}%)\n     "${e.excerpt.slice(0, 350)}..."`
      ).join("\n");
      
      return `${sourceLabel}:\n${itemsFormatted}`;
    })
    .join("\n\n");

  const userPrompt = `PRODUIT À CLASSIFIER:
Nom: ${profile.product_name}
Description: ${profile.description}
Usage/Fonction: ${profile.usage_function || "Non spécifié"}
Matériaux/Composition: ${profile.material_composition.join(", ") || "Non spécifié"}
Marque: ${profile.brand || "Non spécifiée"}
Modèle: ${profile.model || "Non spécifié"}
Spécifications techniques: ${Object.entries(profile.technical_specs).map(([k, v]) => `${k}=${v}`).join(", ") || "Non spécifiées"}

CONTEXTE OPÉRATIONNEL:
Opération: ${context.type_import_export}
Pays d'origine: ${context.origin_country}
${Object.keys(answers).length > 0 ? `Informations complémentaires: ${JSON.stringify(answers)}` : ""}

════════════════════════════════════════════════════════════
CODES CANDIDATS (CHOISIS UNIQUEMENT PARMI CETTE LISTE):
════════════════════════════════════════════════════════════
${candidates.slice(0, 20).map((c, i) => 
  `${i + 1}. ${c.code_10}: ${c.label_fr}\n   [Score: ${c.score}] [Chapitre: ${c.chapter_2}] [Mots-clés: ${c.match_keywords.slice(0, 3).join(", ")}]`
).join("\n")}

════════════════════════════════════════════════════════════
BASE DE CONNAISSANCES (CITE UNIQUEMENT CES SOURCES):
════════════════════════════════════════════════════════════
${evidence.length > 0 
  ? formattedEvidence
  : "⚠️ AUCUNE PREUVE TROUVÉE DANS LA BASE DE DONNÉES\n→ Tu DOIS répondre avec status='LOW_CONFIDENCE' ou 'NEED_INFO'"
}`;

  const aiResponse = await withTimeout(
    callOpenAI(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      config.modelReasoning,
      0.1
    ),
    DECISION_TIMEOUT_MS,
    "décision classification"
  );

  const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Échec parsing décision LLM");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Normaliser confidence (0-1)
  let confidence = parsed.confidence ?? null;
  let confidenceLevel: "high" | "medium" | "low" | null = null;
  
  if (confidence !== null) {
    if (confidence > 1) confidence = confidence / 100;
    if (confidence >= 0.85) confidenceLevel = "high";
    else if (confidence >= 0.65) confidenceLevel = "medium";
    else confidenceLevel = "low";
  }

  console.log(`Décision: ${parsed.status}, code: ${parsed.recommended_code}, conf: ${confidence}`);

  // Construire justification détaillée
  const justificationDetailed = parsed.justification_detailed ? {
    summary: parsed.justification_detailed.summary || parsed.justification_short || "",
    reasoning_steps: parsed.justification_detailed.reasoning_steps || [],
    sources_cited: (parsed.justification_detailed.sources_cited || []).map((s: any) => ({
      source: s.source || "unknown",
      reference: s.reference || "",
      relevance: s.relevance || "",
    })),
    key_factors: parsed.justification_detailed.key_factors || [],
  } : {
    summary: parsed.justification_short || "",
    reasoning_steps: ["Analyse du produit", "Recherche dans la base de données", "Sélection du code approprié"],
    sources_cited: evidence.slice(0, 3).map(e => ({
      source: e.source.toUpperCase(),
      reference: e.ref,
      relevance: `Pertinence: ${Math.round(e.similarity * 100)}%`,
    })),
    key_factors: ["Classification basée sur les preuves documentaires"],
  };

  return {
    status: parsed.status || "ERROR",
    recommended_code: parsed.recommended_code || null,
    confidence,
    confidence_level: confidenceLevel,
    justification_short: parsed.justification_short || null,
    justification_detailed: justificationDetailed,
    alternatives: (parsed.alternatives || []).slice(0, 3).map((alt: any) => ({
      code: alt.code,
      reason: alt.reason,
      confidence: alt.confidence > 1 ? alt.confidence / 100 : alt.confidence,
    })),
    evidence: evidence.slice(0, 5),
    next_question: parsed.next_question || null,
    error_message: null,
    answers,
  };
}

// ============================================================================
// ÉTAPE 5 : VÉRIFICATION ANTI-HALLUCINATION
// ============================================================================

interface VerificationResult {
  passed: boolean;
  checks: {
    code_in_candidates: boolean;
    evidence_not_empty: boolean;
  };
  details: string;
  corrected_code: string | null;
}

function verifyResult(
  result: Omit<HSResult, "verification" | "product_profile" | "candidates_count">,
  candidates: HSCandidate[],
  evidence: Evidence[]
): VerificationResult {
  console.log("=== ÉTAPE 5: VÉRIFICATION ===");

  const checks = {
    code_in_candidates: false,
    evidence_not_empty: false,
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
    checks.code_in_candidates = result.status !== "DONE";
  }

  // CHECK 2: evidence[] non vide si DONE
  if (result.status === "DONE") {
    checks.evidence_not_empty = evidence.length > 0;
    if (!checks.evidence_not_empty) {
      console.error("ÉCHEC: evidence[] vide pour DONE");
    }
  } else {
    checks.evidence_not_empty = true;
  }

  const allPassed = Object.values(checks).every(v => v);
  
  // Correction si code invalide
  let correctedCode: string | null = null;
  if (!checks.code_in_candidates && result.recommended_code && candidates.length > 0) {
    correctedCode = candidates[0].code_10;
    console.log(`Correction: ${result.recommended_code} → ${correctedCode}`);
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
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Parse and validate request
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Corps de requête JSON invalide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const validation = validateInput(ClassifyRequestSchema, body);
    if (!validation.success) {
      return validation.error;
    }
    
    const { case_id } = validation.data;

    logger.info("╔═══════════════════════════════════════════════════════╗");
    logger.info("║    PIPELINE CLASSIFICATION ANTI-HALLUCINATION v4      ║");
    logger.info("║    (avec gestion timeout - limite 25s)                ║");
    logger.info("╚═══════════════════════════════════════════════════════╝");
    logger.debug("Case:", case_id);

    // ═══════════════════════════════════════════════════════════
    // AUTHENTIFICATION (centralized auth module)
    // ═══════════════════════════════════════════════════════════
    
    const authHeader = req.headers.get("Authorization");
    const user = await getUserFromToken(authHeader);
    
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Non authentifié", code: "UNAUTHENTICATED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════════
    // RATE LIMITING CHECK (using centralized module)
    // ═══════════════════════════════════════════════════════════
    
    // Vérifier si l'utilisateur est admin (limite plus élevée)
    const userRole = await getUserRole(user.id);
    const isAdmin = checkIsAdmin(userRole);
    
    // Use centralized rate limit with classify preset
    const rateLimit = await checkRateLimit(
      supabase, 
      user.id, 
      {
        endpoint: "classify",
        ...RATE_LIMIT_PRESETS.classify,
      },
      isAdmin
    );
    
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, corsHeaders);
    }

    // Stocker les infos rate limit pour les ajouter aux réponses
    const rateLimitHeaders = {
      "X-RateLimit-Limit": rateLimit.limit.toString(),
      "X-RateLimit-Remaining": rateLimit.remaining.toString(),
      "X-RateLimit-Reset": rateLimit.resetAt.toISOString(),
    };

    // Récupérer le dossier
    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("*")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return new Response(
        JSON.stringify({ error: "Dossier non trouvé" }),
        { status: 404, headers: { ...corsHeaders, ...rateLimitHeaders, "Content-Type": "application/json" } }
      );
    }

    // Récupérer les fichiers du dossier
    const { data: caseFiles } = await supabase
      .from("case_files")
      .select("*")
      .eq("case_id", case_id);

    // Filtrer les images (tech_sheet, invoice, photo_product, photo_label)
    const imageTypes = ["tech_sheet", "invoice", "photo_product", "photo_label"];
    const imageUrls = (caseFiles || [])
      .filter((f: any) => imageTypes.includes(f.file_type))
      .map((f: any) => f.file_url);

    console.log(`Fichiers: ${caseFiles?.length || 0}, Images: ${imageUrls.length}`);

    // Récupérer le dernier résultat pour les réponses précédentes
    const { data: lastResult } = await supabase
      .from("classification_results")
      .select("answers")
      .eq("case_id", case_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const previousAnswers: Record<string, string> = lastResult?.answers || {};

    // Context
    const context = {
      type_import_export: caseData.type_import_export,
      origin_country: caseData.origin_country,
    };

    // ═══════════════════════════════════════════════════════════
    // ÉTAPE 1: EXTRACTION VISION → ProductProfile
    // ═══════════════════════════════════════════════════════════
    const profile = await extractProductProfile(imageUrls, caseData.product_name, previousAnswers);

    // ═══════════════════════════════════════════════════════════
    // ÉTAPE 2: GÉNÉRATION CANDIDATS (HYBRIDE: TEXTUEL + SÉMANTIQUE)
    // ═══════════════════════════════════════════════════════════
    let candidates = await generateCandidatesList(supabase, profile, 30);

    // ═══════════════════════════════════════════════════════════
    // ÉTAPE 2.5: SIGNAL DUM (BOOST HISTORIQUE)
    // ═══════════════════════════════════════════════════════════
    if (candidates.length > 0 && caseData.company_id) {
      candidates = await applyDUMSignal(supabase, candidates, caseData.company_id, profile);
    }

    // Si 0 candidat → NEED_INFO
    if (candidates.length === 0) {
      const needInfoResult: HSResult = {
        status: "NEED_INFO",
        recommended_code: null,
        confidence: null,
        confidence_level: null,
        justification_short: "Aucun code candidat trouvé dans la nomenclature.",
        justification_detailed: null,
        alternatives: [],
        evidence: [],
        next_question: {
          id: "q_product_details",
          label: "Décrivez le produit en détail (matière, fonction, composition)",
          type: "text",
          required: true,
        },
        error_message: null,
        answers: previousAnswers,
        verification: null,
        product_profile: profile,
        candidates_count: 0,
      };

      await supabase.from("classification_results").insert({
        case_id,
        status: needInfoResult.status,
        recommended_code: null,
        confidence: null,
        confidence_level: null,
        justification_short: needInfoResult.justification_short,
        alternatives: [],
        evidence: [],
        next_question: needInfoResult.next_question,
        error_message: null,
        answers: previousAnswers,
      });

      return new Response(
        JSON.stringify({ success: true, result: needInfoResult }),
        { headers: { ...corsHeaders, ...rateLimitHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════════
    // ÉTAPE 3: RAG PREUVES
    // ═══════════════════════════════════════════════════════════
    const evidence = await searchEvidenceRAG(supabase, profile, candidates, 15);

    // ═══════════════════════════════════════════════════════════
    // ÉTAPE 4: DÉCISION CONTRÔLÉE
    // ═══════════════════════════════════════════════════════════
    let result = await makeControlledDecision(profile, candidates, evidence, context, previousAnswers);

    // ═══════════════════════════════════════════════════════════
    // ÉTAPE 5: VÉRIFICATION
    // ═══════════════════════════════════════════════════════════
    const verification = verifyResult(result, candidates, evidence);

    // Appliquer corrections
    if (!verification.passed) {
      if (verification.corrected_code) {
        result.recommended_code = verification.corrected_code;
        result.justification_short = `[CORRIGÉ] ${result.justification_short}`;
        if (result.confidence) {
          result.confidence = Math.max(0.5, result.confidence * 0.7);
          result.confidence_level = result.confidence >= 0.65 ? "medium" : "low";
        }
        result.status = "LOW_CONFIDENCE";
      }
      
      if (!verification.checks.evidence_not_empty && result.status === "DONE") {
        result.status = "LOW_CONFIDENCE";
        result.justification_short = "[SANS PREUVE] " + result.justification_short;
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

    // Sauvegarder le résultat
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

    // Mettre à jour statut du dossier
    let newStatus = caseData.status;
    if (finalResult.status === "DONE" && verification.passed) {
      newStatus = "RESULT_READY";
    } else if (finalResult.status === "ERROR") {
      newStatus = "ERROR";
    }

    if (newStatus !== caseData.status) {
      await supabase.from("cases").update({ status: newStatus }).eq("id", case_id);
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      case_id,
      action: "classify_completed",
      user_id: user.id,
      user_phone: "system",
      meta: {
        status: finalResult.status,
        verification_passed: verification.passed,
        recommended_code: finalResult.recommended_code,
        candidates_count: candidates.length,
        evidence_count: evidence.length,
      },
    });

    const duration = Date.now() - startTime;
    
    // Log métriques
    logger.metric("classify_duration_ms", duration);
    logger.metric("classify_candidates_count", candidates.length);
    logger.metric("classify_evidence_count", evidence.length);
    logger.metric("classify_confidence", finalResult.confidence || 0, { status: finalResult.status });
    
    logger.info("╔═══════════════════════════════════════════════════════╗");
    logger.info(`║ PIPELINE TERMINÉ: ${finalResult.status.padEnd(37)}║`);
    logger.debug(`║ Vérification: ${verification.passed ? "PASS" : "FAIL"}`.padEnd(56) + "║");
    logger.debug(`║ Durée: ${duration}ms`.padEnd(56) + "║");
    logger.info("╚═══════════════════════════════════════════════════════╝");

    return new Response(
      JSON.stringify({ success: true, result: finalResult, verification, duration_ms: duration }),
      { headers: { ...corsHeaders, ...rateLimitHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Pipeline error après ${duration}ms:`, error);
    
    // Gestion spéciale timeout
    if (error instanceof TimeoutError || (error instanceof Error && error.message?.includes("Timeout"))) {
      logger.error(`TIMEOUT après ${duration}ms:`, error.message);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: "Classification timeout",
          message: "La classification a pris trop de temps. Réessayez avec moins de documents ou simplifiez la description.",
          duration_ms: duration,
          result: {
            status: "ERROR",
            error_message: `Timeout - classification trop longue (${duration}ms)`,
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
            answers: {},
          },
        }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Autres erreurs
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Erreur inconnue",
        duration_ms: duration,
        result: {
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
          answers: {},
        },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
