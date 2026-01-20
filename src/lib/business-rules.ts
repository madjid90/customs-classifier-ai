// ============================================================================
// RÈGLES MÉTIER DOUANIÈRES - Validation des résultats IA
// ============================================================================

import type { HSResult, EvidenceItem, ConfidenceLevel } from "./types";

// ============================================================================
// TYPES
// ============================================================================

export interface BusinessRuleViolation {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion?: string;
}

export interface BusinessRulesResult {
  valid: boolean;
  violations: BusinessRuleViolation[];
  adjustedConfidence?: number;
  adjustedConfidenceLevel?: ConfidenceLevel;
}

// ============================================================================
// RESTRICTIONS PAYS/PRODUIT
// ============================================================================

interface CountryRestriction {
  countries: string[];
  chapters: string[];
  message: string;
}

// Restrictions connues (exemple)
const COUNTRY_RESTRICTIONS: CountryRestriction[] = [
  {
    countries: ["IL", "ISR", "ISRAEL"],
    chapters: ["*"], // Tout
    message: "Restrictions commerciales avec Israël",
  },
  {
    countries: ["KP", "PRK", "NORTH KOREA", "COREE DU NORD"],
    chapters: ["*"],
    message: "Embargo total sur la Corée du Nord",
  },
  {
    countries: ["IR", "IRN", "IRAN"],
    chapters: ["27", "84", "85", "87", "88", "89", "93"],
    message: "Restrictions sectorielles sur l'Iran (pétrole, machines, armement)",
  },
  {
    countries: ["RU", "RUS", "RUSSIA", "RUSSIE"],
    chapters: ["27", "71", "84", "85", "87", "88", "89"],
    message: "Sanctions sectorielles sur la Russie",
  },
];

// ============================================================================
// RÈGLES TEXTILES (Chapitres 61-62)
// ============================================================================

const TEXTILE_CHAPTERS = ["61", "62", "63"];
const TEXTILE_COMPOSITION_KEYWORDS = [
  "coton", "cotton", "polyester", "nylon", "soie", "silk", "laine", "wool",
  "lin", "linen", "viscose", "acrylique", "acrylic", "elasthanne", "spandex",
  "lycra", "modal", "tencel", "chanvre", "hemp", "jute", "ramie"
];

const TEXTILE_CONSTRUCTION_KEYWORDS = [
  "tricoté", "tricot", "knit", "knitted", "maille",
  "tissé", "tissu", "woven", "chaîne et trame"
];

// ============================================================================
// RÈGLES DE CONFIANCE MINIMALE
// ============================================================================

const MIN_CONFIDENCE_THRESHOLD = 0.50; // 50%
const LOW_EVIDENCE_THRESHOLD = 2; // Minimum 2 preuves pour DONE

// ============================================================================
// VALIDATION PRINCIPALE
// ============================================================================

export function validateWithBusinessRules(
  result: HSResult,
  context: {
    origin_country: string;
    type_import_export: "import" | "export";
    product_name: string;
    product_description?: string;
    material_composition?: string[];
  }
): BusinessRulesResult {
  const violations: BusinessRuleViolation[] = [];
  let adjustedConfidence = result.confidence;
  let adjustedConfidenceLevel = result.confidence_level;

  // Skip validation for non-DONE results
  if (result.status !== "DONE" && result.status !== "LOW_CONFIDENCE") {
    return { valid: true, violations: [] };
  }

  const hsCode = result.recommended_code;
  if (!hsCode) {
    return { valid: true, violations: [] };
  }

  const chapter2 = hsCode.substring(0, 2);

  // ========================================
  // RÈGLE 1: Restrictions pays/produit
  // ========================================
  const countryNorm = context.origin_country.toUpperCase().trim();
  
  for (const restriction of COUNTRY_RESTRICTIONS) {
    const countryMatches = restriction.countries.some(c => 
      countryNorm.includes(c.toUpperCase())
    );
    
    if (countryMatches) {
      const chapterRestricted = restriction.chapters.includes("*") || 
        restriction.chapters.includes(chapter2);
      
      if (chapterRestricted) {
        violations.push({
          rule: "COUNTRY_RESTRICTION",
          severity: "warning",
          message: restriction.message,
          suggestion: "Vérifier les licences d'importation requises",
        });
      }
    }
  }

  // ========================================
  // RÈGLE 2: Textiles - Vérifier composition
  // ========================================
  if (TEXTILE_CHAPTERS.includes(chapter2)) {
    const hasComposition = checkTextileComposition(context);
    
    if (!hasComposition.found) {
      violations.push({
        rule: "TEXTILE_COMPOSITION_MISSING",
        severity: "warning",
        message: "Produit textile sans composition matière détectée",
        suggestion: "Préciser la composition (ex: 100% coton, 65% polyester 35% coton)",
      });
      
      // Réduire la confiance
      if (adjustedConfidence) {
        adjustedConfidence = Math.max(0.4, adjustedConfidence * 0.85);
      }
    }

    // Vérifier construction (tricoté vs tissé) pour chapitres 61-62
    if (chapter2 === "61" || chapter2 === "62") {
      const hasConstruction = checkTextileConstruction(context);
      
      if (!hasConstruction.found) {
        violations.push({
          rule: "TEXTILE_CONSTRUCTION_UNCLEAR",
          severity: "info",
          message: `Classification ${chapter2 === "61" ? "chapitre 61 (tricoté)" : "chapitre 62 (tissé)"} - construction non explicite`,
          suggestion: "Confirmer si le produit est tricoté (ch.61) ou tissé (ch.62)",
        });
      } else if (hasConstruction.type === "knit" && chapter2 === "62") {
        violations.push({
          rule: "TEXTILE_CONSTRUCTION_MISMATCH",
          severity: "error",
          message: "Produit tricoté classé au chapitre 62 (tissé)",
          suggestion: "Le chapitre 61 est généralement pour les articles tricotés",
        });
      } else if (hasConstruction.type === "woven" && chapter2 === "61") {
        violations.push({
          rule: "TEXTILE_CONSTRUCTION_MISMATCH",
          severity: "error",
          message: "Produit tissé classé au chapitre 61 (tricoté)",
          suggestion: "Le chapitre 62 est généralement pour les articles tissés",
        });
      }
    }
  }

  // ========================================
  // RÈGLE 3: Confiance minimale
  // ========================================
  if (result.confidence !== null && result.confidence < MIN_CONFIDENCE_THRESHOLD) {
    violations.push({
      rule: "LOW_CONFIDENCE",
      severity: "warning",
      message: `Confiance trop faible (${Math.round(result.confidence * 100)}% < 50%)`,
      suggestion: "Ajouter des documents supplémentaires pour améliorer la précision",
    });
  }

  // ========================================
  // RÈGLE 4: Evidence insuffisante
  // ========================================
  if (result.evidence && result.evidence.length < LOW_EVIDENCE_THRESHOLD) {
    violations.push({
      rule: "INSUFFICIENT_EVIDENCE",
      severity: "warning",
      message: `Seulement ${result.evidence.length} preuve(s) documentaire(s)`,
      suggestion: "La classification manque de sources de vérification",
    });
    
    if (adjustedConfidence) {
      adjustedConfidence = Math.max(0.4, adjustedConfidence * 0.9);
    }
  }

  // ========================================
  // RÈGLE 5: Diversité des sources
  // ========================================
  if (result.evidence && result.evidence.length > 0) {
    const sources = new Set(result.evidence.map(e => e.source));
    if (sources.size === 1) {
      violations.push({
        rule: "SINGLE_SOURCE_TYPE",
        severity: "info",
        message: "Classification basée sur une seule source de preuves",
        suggestion: "Diversifier les sources (OMD, réglementation, historique)",
      });
    }
  }

  // ========================================
  // RÈGLE 6: Codes spéciaux (chapitres sensibles)
  // ========================================
  const sensitiveChapters: Record<string, string> = {
    "93": "Armes et munitions - Licence obligatoire",
    "97": "Objets d'art - Vérifier authenticité",
    "30": "Produits pharmaceutiques - AMM requise",
    "29": "Produits chimiques - Réglementation REACH",
    "28": "Produits chimiques inorganiques - Précurseurs potentiels",
  };

  if (sensitiveChapters[chapter2]) {
    violations.push({
      rule: "SENSITIVE_CHAPTER",
      severity: "warning",
      message: sensitiveChapters[chapter2],
      suggestion: "Vérifier les autorisations spécifiques requises",
    });
  }

  // Recalculer le niveau de confiance
  if (adjustedConfidence && adjustedConfidence !== result.confidence) {
    if (adjustedConfidence >= 0.80) adjustedConfidenceLevel = "high";
    else if (adjustedConfidence >= 0.65) adjustedConfidenceLevel = "medium";
    else adjustedConfidenceLevel = "low";
  }

  // Déterminer validité globale
  const hasErrors = violations.some(v => v.severity === "error");

  return {
    valid: !hasErrors,
    violations,
    adjustedConfidence,
    adjustedConfidenceLevel,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function checkTextileComposition(context: {
  product_name: string;
  product_description?: string;
  material_composition?: string[];
}): { found: boolean; materials: string[] } {
  const materials: string[] = [];
  
  // Check explicit composition
  if (context.material_composition && context.material_composition.length > 0) {
    return { found: true, materials: context.material_composition };
  }

  // Search in text
  const searchText = [
    context.product_name,
    context.product_description || "",
  ].join(" ").toLowerCase();

  for (const keyword of TEXTILE_COMPOSITION_KEYWORDS) {
    if (searchText.includes(keyword.toLowerCase())) {
      materials.push(keyword);
    }
  }

  // Check for percentage patterns (e.g., "100% coton", "65/35")
  const percentagePattern = /\d+\s*%/;
  const hasPercentage = percentagePattern.test(searchText);

  return {
    found: materials.length > 0 || hasPercentage,
    materials,
  };
}

function checkTextileConstruction(context: {
  product_name: string;
  product_description?: string;
}): { found: boolean; type: "knit" | "woven" | null } {
  const searchText = [
    context.product_name,
    context.product_description || "",
  ].join(" ").toLowerCase();

  const knitKeywords = ["tricoté", "tricot", "knit", "knitted", "maille", "jersey", "rib"];
  const wovenKeywords = ["tissé", "tissu", "woven", "chaîne", "trame", "popeline", "sergé", "satin"];

  for (const kw of knitKeywords) {
    if (searchText.includes(kw)) {
      return { found: true, type: "knit" };
    }
  }

  for (const kw of wovenKeywords) {
    if (searchText.includes(kw)) {
      return { found: true, type: "woven" };
    }
  }

  return { found: false, type: null };
}

// ============================================================================
// EXPORT HELPERS
// ============================================================================

export function formatViolations(violations: BusinessRuleViolation[]): string {
  if (violations.length === 0) return "Aucune violation";
  
  return violations.map(v => {
    const icon = v.severity === "error" ? "❌" : v.severity === "warning" ? "⚠️" : "ℹ️";
    return `${icon} [${v.rule}] ${v.message}${v.suggestion ? ` → ${v.suggestion}` : ""}`;
  }).join("\n");
}

export function getViolationsBySeverity(
  violations: BusinessRuleViolation[],
  severity: "error" | "warning" | "info"
): BusinessRuleViolation[] {
  return violations.filter(v => v.severity === severity);
}
