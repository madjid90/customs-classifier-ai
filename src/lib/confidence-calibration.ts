// ============================================================================
// CALIBRATION DE CONFIANCE - Ajustement basé sur qualité evidence/documents
// ============================================================================

import type { EvidenceItem, CaseFileType, ConfidenceLevel } from "./types";

// ============================================================================
// TYPES
// ============================================================================

export interface CalibrationFactors {
  evidenceQuality: number;      // 0-1, qualité des preuves
  sourceAgreement: number;      // 0-1, accord entre sources
  documentQuality: number;      // 0-1, qualité des documents fournis
  candidateClarity: number;     // 0-1, clarté du choix parmi candidats
}

export interface CalibrationResult {
  originalConfidence: number;
  calibratedConfidence: number;
  calibratedLevel: ConfidenceLevel;
  factors: CalibrationFactors;
  adjustmentReason: string;
}

// ============================================================================
// POIDS DES SOURCES D'EVIDENCE
// ============================================================================

const SOURCE_WEIGHTS: Record<string, number> = {
  omd: 1.0,      // Notes OMD - Référence officielle internationale
  maroc: 0.95,   // Réglementation marocaine - Très fiable
  lois: 0.85,    // Lois de finances - Contexte fiscal
  dum: 0.75,     // Historique DUM - Précédents internes
  finance: 0.80, // Articles fiscaux
};

// ============================================================================
// POIDS DES TYPES DE DOCUMENTS
// ============================================================================

const DOCUMENT_TYPE_WEIGHTS: Record<CaseFileType, number> = {
  tech_sheet: 1.0,       // Fiche technique - Meilleure source
  invoice: 0.85,         // Facture - Bonne description
  certificate: 0.90,     // Certificat - Officiel
  packing_list: 0.70,    // Liste de colisage
  dum: 0.95,             // DUM historique - Très pertinent
  photo_product: 0.60,   // Photo produit
  photo_label: 0.75,     // Photo étiquette - Info composition
  photo_plate: 0.65,     // Photo plaque
  other: 0.40,           // Autre
  admin_ingestion: 0.50, // Admin
};

// ============================================================================
// CALIBRATION PRINCIPALE
// ============================================================================

export function calibrateConfidence(
  rawConfidence: number,
  evidence: EvidenceItem[],
  documentTypes: CaseFileType[],
  alternativesCount: number = 0,
  topCandidateScore: number = 0
): CalibrationResult {
  // Calculer les facteurs
  const evidenceQuality = calculateEvidenceQuality(evidence);
  const sourceAgreement = calculateSourceAgreement(evidence);
  const documentQuality = calculateDocumentQuality(documentTypes);
  const candidateClarity = calculateCandidateClarity(alternativesCount, topCandidateScore);

  const factors: CalibrationFactors = {
    evidenceQuality,
    sourceAgreement,
    documentQuality,
    candidateClarity,
  };

  // Formule de calibration pondérée
  const weights = {
    evidenceQuality: 0.35,
    sourceAgreement: 0.25,
    documentQuality: 0.25,
    candidateClarity: 0.15,
  };

  const qualityScore = 
    factors.evidenceQuality * weights.evidenceQuality +
    factors.sourceAgreement * weights.sourceAgreement +
    factors.documentQuality * weights.documentQuality +
    factors.candidateClarity * weights.candidateClarity;

  // Ajuster la confiance en fonction de la qualité
  // Si qualité < 0.5, on réduit la confiance
  // Si qualité > 0.5, on peut légèrement augmenter (max +10%)
  let calibratedConfidence: number;
  let adjustmentReason: string;

  if (qualityScore < 0.3) {
    // Qualité très faible → forte réduction
    calibratedConfidence = rawConfidence * 0.6;
    adjustmentReason = "Qualité des preuves insuffisante";
  } else if (qualityScore < 0.5) {
    // Qualité faible → réduction modérée
    calibratedConfidence = rawConfidence * 0.8;
    adjustmentReason = "Preuves limitées, confiance ajustée";
  } else if (qualityScore < 0.7) {
    // Qualité moyenne → légère réduction
    calibratedConfidence = rawConfidence * 0.95;
    adjustmentReason = "Qualité acceptable";
  } else if (qualityScore < 0.85) {
    // Bonne qualité → maintien
    calibratedConfidence = rawConfidence;
    adjustmentReason = "Bonne qualité des preuves";
  } else {
    // Excellente qualité → légère augmentation
    calibratedConfidence = Math.min(0.98, rawConfidence * 1.05);
    adjustmentReason = "Excellente qualité des preuves";
  }

  // Assurer les bornes [0, 1]
  calibratedConfidence = Math.max(0, Math.min(1, calibratedConfidence));

  // Déterminer le niveau
  let calibratedLevel: ConfidenceLevel;
  if (calibratedConfidence >= 0.80) {
    calibratedLevel = "high";
  } else if (calibratedConfidence >= 0.65) {
    calibratedLevel = "medium";
  } else {
    calibratedLevel = "low";
  }

  return {
    originalConfidence: rawConfidence,
    calibratedConfidence: Math.round(calibratedConfidence * 100) / 100,
    calibratedLevel,
    factors,
    adjustmentReason,
  };
}

// ============================================================================
// CALCUL QUALITÉ EVIDENCE
// ============================================================================

export function calculateEvidenceQuality(evidence: EvidenceItem[]): number {
  if (!evidence || evidence.length === 0) {
    return 0;
  }

  // Facteurs:
  // 1. Nombre de preuves (plus = mieux, plafonné à 10)
  const countScore = Math.min(1, evidence.length / 10);

  // 2. Diversité des sources
  const uniqueSources = new Set(evidence.map(e => e.source));
  const diversityScore = Math.min(1, uniqueSources.size / 4); // Max 4 sources

  // 3. Poids moyen des sources
  const avgSourceWeight = evidence.reduce((sum, e) => {
    return sum + (SOURCE_WEIGHTS[e.source] || 0.5);
  }, 0) / evidence.length;

  // 4. Qualité des extraits (longueur)
  const avgExcerptLength = evidence.reduce((sum, e) => {
    return sum + (e.excerpt?.length || 0);
  }, 0) / evidence.length;
  const excerptScore = Math.min(1, avgExcerptLength / 300); // 300 chars = score max

  // Pondération finale
  const qualityScore = 
    countScore * 0.25 +
    diversityScore * 0.30 +
    avgSourceWeight * 0.30 +
    excerptScore * 0.15;

  return Math.round(qualityScore * 100) / 100;
}

// ============================================================================
// CALCUL ACCORD ENTRE SOURCES
// ============================================================================

export function calculateSourceAgreement(evidence: EvidenceItem[]): number {
  if (!evidence || evidence.length < 2) {
    return evidence?.length === 1 ? 0.5 : 0;
  }

  // Analyser si les différentes sources pointent vers le même code
  // On ne peut pas vraiment le faire sans le code recommandé, 
  // donc on utilise une heuristique basée sur la cohérence des extraits

  const uniqueSources = new Set(evidence.map(e => e.source));
  
  // Plus de sources uniques = meilleure validation croisée
  if (uniqueSources.size >= 3) {
    return 0.9; // 3+ sources concordantes
  } else if (uniqueSources.size === 2) {
    return 0.7; // 2 sources
  } else {
    return 0.5; // 1 seule source
  }
}

// ============================================================================
// CALCUL QUALITÉ DOCUMENTS
// ============================================================================

export function calculateDocumentQuality(documentTypes: CaseFileType[]): number {
  if (!documentTypes || documentTypes.length === 0) {
    return 0.1; // Minimum sans documents
  }

  // Calculer le score moyen des types de documents
  const totalWeight = documentTypes.reduce((sum, type) => {
    return sum + (DOCUMENT_TYPE_WEIGHTS[type] || 0.5);
  }, 0);

  const avgWeight = totalWeight / documentTypes.length;

  // Bonus pour diversité des documents
  const uniqueTypes = new Set(documentTypes);
  const diversityBonus = Math.min(0.2, uniqueTypes.size * 0.05);

  // Bonus pour types critiques
  const hasTechSheet = documentTypes.includes("tech_sheet");
  const hasCertificate = documentTypes.includes("certificate");
  const criticalBonus = (hasTechSheet ? 0.1 : 0) + (hasCertificate ? 0.05 : 0);

  const qualityScore = Math.min(1, avgWeight + diversityBonus + criticalBonus);

  return Math.round(qualityScore * 100) / 100;
}

// ============================================================================
// CALCUL CLARTÉ DU CANDIDAT
// ============================================================================

export function calculateCandidateClarity(
  alternativesCount: number,
  topCandidateScore: number
): number {
  // Moins d'alternatives = plus clair
  // Score du top candidat élevé = plus clair

  let clarityScore = 0.5; // Base

  // Peu d'alternatives = bon signe
  if (alternativesCount === 0) {
    clarityScore += 0.3; // Choix unique évident
  } else if (alternativesCount === 1) {
    clarityScore += 0.2;
  } else if (alternativesCount === 2) {
    clarityScore += 0.1;
  }
  // 3+ alternatives = pas de bonus

  // Score du candidat principal
  if (topCandidateScore >= 0.8) {
    clarityScore += 0.2;
  } else if (topCandidateScore >= 0.6) {
    clarityScore += 0.1;
  }

  return Math.min(1, Math.round(clarityScore * 100) / 100);
}

// ============================================================================
// UTILITAIRES
// ============================================================================

export function formatCalibrationFactors(factors: CalibrationFactors): string {
  return [
    `📊 Qualité evidence: ${Math.round(factors.evidenceQuality * 100)}%`,
    `🔗 Accord sources: ${Math.round(factors.sourceAgreement * 100)}%`,
    `📄 Qualité documents: ${Math.round(factors.documentQuality * 100)}%`,
    `🎯 Clarté candidat: ${Math.round(factors.candidateClarity * 100)}%`,
  ].join("\n");
}

export function shouldRequestMoreInfo(calibration: CalibrationResult): boolean {
  // Recommander plus d'info si:
  // 1. Confiance calibrée < 50%
  // 2. OU facteurs critiques très faibles
  return (
    calibration.calibratedConfidence < 0.50 ||
    calibration.factors.evidenceQuality < 0.3 ||
    calibration.factors.documentQuality < 0.2
  );
}
