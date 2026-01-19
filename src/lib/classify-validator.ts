/**
 * VALIDATEUR ANTI-HALLUCINATION POUR /classify
 * 
 * Ce module vérifie que toute réponse de classification
 * respecte les règles strictes définies dans l'OpenAPI.
 * 
 * RÈGLES ABSOLUES:
 * - status=DONE: recommended_code ET evidence obligatoires
 * - status=NEED_INFO: next_question obligatoire
 * - status=ERROR: error_message obligatoire
 * - status=LOW_CONFIDENCE: recommended_code + evidence + warning
 * - recommended_code doit avoir exactement 10 chiffres
 * - evidence[].excerpt max 300 chars
 * - alternatives max 3
 */

import { HSResult, ClassifyStatus, EvidenceItem, Alternative, NextQuestion } from "./types";
import { logger } from "./logger";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedResult?: HSResult;
}

// Regex for 10-digit HS code
const HS_CODE_PATTERN = /^\d{10}$/;

// Valid status values
const VALID_STATUSES: ClassifyStatus[] = ["DONE", "NEED_INFO", "ERROR", "LOW_CONFIDENCE"];

// Valid evidence sources
const VALID_SOURCES = ["omd", "maroc", "lois", "dum"];

/**
 * Validate and sanitize a classify response
 * Returns sanitized result only if valid
 */
export function validateClassifyResponse(response: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if response is an object
  if (!response || typeof response !== "object") {
    return {
      valid: false,
      errors: ["FATAL: La réponse n'est pas un objet valide"],
      warnings: [],
    };
  }

  const data = response as Record<string, unknown>;

  // ===== RULE 1: status is required and must be valid =====
  if (!data.status) {
    errors.push("FATAL: Champ 'status' manquant");
    return { valid: false, errors, warnings };
  }

  const status = data.status as string;
  if (!VALID_STATUSES.includes(status as ClassifyStatus)) {
    errors.push(`FATAL: Status invalide '${status}'. Valeurs autorisées: ${VALID_STATUSES.join(", ")}`);
    return { valid: false, errors, warnings };
  }

  // ===== RULE 2: Validate based on status =====
  switch (status) {
    case "DONE":
    case "LOW_CONFIDENCE":
      // recommended_code is REQUIRED
      if (!data.recommended_code) {
        errors.push(`BLOCKER: Status=${status} mais recommended_code est vide`);
      } else if (!HS_CODE_PATTERN.test(data.recommended_code as string)) {
        errors.push(`BLOCKER: recommended_code '${data.recommended_code}' n'a pas 10 chiffres`);
      }

      // evidence is REQUIRED and must be non-empty
      if (!data.evidence) {
        errors.push(`BLOCKER: Status=${status} mais evidence[] est absent`);
      } else if (!Array.isArray(data.evidence)) {
        errors.push(`BLOCKER: evidence doit être un tableau`);
      } else if (data.evidence.length === 0) {
        errors.push(`BLOCKER: Status=${status} mais evidence[] est vide - ANTI-HALLUCINATION VIOLATION`);
      } else {
        // Validate each evidence item
        (data.evidence as unknown[]).forEach((ev, idx) => {
          const evResult = validateEvidence(ev, idx);
          errors.push(...evResult.errors);
          warnings.push(...evResult.warnings);
        });
      }

      // LOW_CONFIDENCE specific warning
      if (status === "LOW_CONFIDENCE" && !data.justification_short) {
        warnings.push("LOW_CONFIDENCE devrait avoir une justification");
      }
      break;

    case "NEED_INFO":
      // next_question is REQUIRED
      if (!data.next_question) {
        errors.push("BLOCKER: Status=NEED_INFO mais next_question est absent");
      } else {
        const qResult = validateNextQuestion(data.next_question);
        errors.push(...qResult.errors);
        warnings.push(...qResult.warnings);
      }

      // Should NOT have recommended_code displayed
      if (data.recommended_code) {
        warnings.push("NEED_INFO ne devrait pas afficher recommended_code");
      }
      break;

    case "ERROR":
      // error_message is REQUIRED
      if (!data.error_message) {
        errors.push("BLOCKER: Status=ERROR mais error_message est absent");
      }
      break;
  }

  // ===== RULE 3: Validate alternatives (max 3) =====
  if (data.alternatives) {
    if (!Array.isArray(data.alternatives)) {
      errors.push("alternatives doit être un tableau");
    } else if (data.alternatives.length > 3) {
      warnings.push(`alternatives contient ${data.alternatives.length} éléments (max 3)`);
    } else {
      (data.alternatives as unknown[]).forEach((alt, idx) => {
        const altResult = validateAlternative(alt, idx);
        errors.push(...altResult.errors);
        warnings.push(...altResult.warnings);
      });
    }
  }

  // ===== RULE 4: Validate justification length =====
  if (data.justification_short && typeof data.justification_short === "string") {
    if ((data.justification_short as string).length > 500) {
      warnings.push("justification_short dépasse 500 caractères");
    }
  }

  // ===== RULE 5: Validate confidence =====
  if (data.confidence !== null && data.confidence !== undefined) {
    const conf = Number(data.confidence);
    if (isNaN(conf) || conf < 0 || conf > 1) {
      errors.push(`confidence doit être entre 0 et 1, reçu: ${data.confidence}`);
    }
  }

  // Build sanitized result if valid
  if (errors.length === 0) {
    const sanitizedResult = sanitizeResult(data);
    return {
      valid: true,
      errors: [],
      warnings,
      sanitizedResult,
    };
  }

  return {
    valid: false,
    errors,
    warnings,
  };
}

/**
 * Validate an evidence item
 */
function validateEvidence(ev: unknown, index: number): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!ev || typeof ev !== "object") {
    errors.push(`evidence[${index}]: n'est pas un objet valide`);
    return { errors, warnings };
  }

  const evidence = ev as Record<string, unknown>;

  // source is required
  if (!evidence.source) {
    errors.push(`evidence[${index}]: source manquant`);
  } else if (!VALID_SOURCES.includes(evidence.source as string)) {
    errors.push(`evidence[${index}]: source invalide '${evidence.source}'`);
  }

  // ref is required
  if (!evidence.ref) {
    errors.push(`evidence[${index}]: ref manquant`);
  }

  // excerpt is required (was 'text' in old schema)
  const excerptField = evidence.excerpt || evidence.text;
  if (!excerptField) {
    errors.push(`evidence[${index}]: excerpt manquant`);
  } else if (typeof excerptField === "string" && excerptField.length > 300) {
    warnings.push(`evidence[${index}]: excerpt dépasse 300 caractères (${excerptField.length})`);
  }

  return { errors, warnings };
}

/**
 * Validate an alternative code
 */
function validateAlternative(alt: unknown, index: number): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!alt || typeof alt !== "object") {
    errors.push(`alternatives[${index}]: n'est pas un objet valide`);
    return { errors, warnings };
  }

  const alternative = alt as Record<string, unknown>;

  // code is required
  if (!alternative.code) {
    errors.push(`alternatives[${index}]: code manquant`);
  } else if (!HS_CODE_PATTERN.test(alternative.code as string)) {
    warnings.push(`alternatives[${index}]: code '${alternative.code}' n'a pas 10 chiffres`);
  }

  // reason is required
  if (!alternative.reason) {
    warnings.push(`alternatives[${index}]: reason manquant`);
  }

  return { errors, warnings };
}

/**
 * Validate next_question
 */
function validateNextQuestion(q: unknown): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!q || typeof q !== "object") {
    errors.push("next_question: n'est pas un objet valide");
    return { errors, warnings };
  }

  const question = q as Record<string, unknown>;

  // id is required
  if (!question.id) {
    errors.push("next_question: id manquant");
  }

  // label (or text) is required
  const labelField = question.label || question.text;
  if (!labelField) {
    errors.push("next_question: label manquant");
  }

  // type is required
  if (!question.type) {
    errors.push("next_question: type manquant");
  } else if (!["yesno", "select", "text"].includes(question.type as string)) {
    errors.push(`next_question: type invalide '${question.type}'`);
  }

  // If type is select, options should be present
  if (question.type === "select" && (!question.options || !Array.isArray(question.options))) {
    warnings.push("next_question: type=select mais options manquant");
  }

  return { errors, warnings };
}

/**
 * Sanitize and normalize the result to match our types
 */
function sanitizeResult(data: Record<string, unknown>): HSResult {
  const status = data.status as ClassifyStatus;

  // Normalize evidence
  let evidence: EvidenceItem[] = [];
  if (data.evidence && Array.isArray(data.evidence)) {
    evidence = (data.evidence as Record<string, unknown>[]).map((ev) => ({
      source: ev.source as EvidenceItem["source"],
      doc_id: (ev.doc_id as string) || "",
      ref: (ev.ref as string) || "",
      excerpt: ((ev.excerpt || ev.text) as string)?.substring(0, 300) || "",
    }));
  }

  // Normalize alternatives (max 3)
  let alternatives: Alternative[] = [];
  if (data.alternatives && Array.isArray(data.alternatives)) {
    alternatives = (data.alternatives as Record<string, unknown>[])
      .slice(0, 3)
      .map((alt) => ({
        code: (alt.code as string) || "",
        reason: (alt.reason as string) || "",
        confidence: Number(alt.confidence) || 0,
      }));
  }

  // Normalize next_question
  let nextQuestion: NextQuestion | null = null;
  if (data.next_question && typeof data.next_question === "object") {
    const q = data.next_question as Record<string, unknown>;
    nextQuestion = {
      id: (q.id as string) || `q_${Date.now()}`,
      label: ((q.label || q.text) as string) || "",
      type: (q.type as NextQuestion["type"]) || "text",
      options: Array.isArray(q.options) 
        ? (q.options as Record<string, unknown>[]).map((o) => ({
            value: typeof o === "string" ? o : (o.value as string) || "",
            label: typeof o === "string" ? o : (o.label as string) || "",
          }))
        : undefined,
      required: q.required !== false,
    };
  }

  // Normalize justification_detailed
  let justificationDetailed = null;
  if (data.justification_detailed && typeof data.justification_detailed === "object") {
    const jd = data.justification_detailed as Record<string, unknown>;
    justificationDetailed = {
      summary: (jd.summary as string) || "",
      reasoning_steps: Array.isArray(jd.reasoning_steps) ? (jd.reasoning_steps as string[]) : [],
      sources_cited: Array.isArray(jd.sources_cited) 
        ? (jd.sources_cited as Record<string, unknown>[]).map((s) => ({
            source: (s.source as string) || "",
            reference: (s.reference as string) || "",
            relevance: (s.relevance as string) || "",
          }))
        : [],
      key_factors: Array.isArray(jd.key_factors) ? (jd.key_factors as string[]) : [],
    };
  }

  return {
    status,
    recommended_code: status === "NEED_INFO" ? null : (data.recommended_code as string) || null,
    confidence: Number(data.confidence) || 0,
    confidence_level: (data.confidence_level as HSResult["confidence_level"]) || "low",
    justification_short: ((data.justification_short as string) || "").substring(0, 500),
    justification_detailed: justificationDetailed,
    alternatives,
    evidence,
    next_question: nextQuestion,
    error_message: (data.error_message as string) || null,
  };
}

/**
 * Check if a result can be displayed (has evidence)
 */
export function canDisplayResult(result: HSResult | null): boolean {
  if (!result) return false;
  if (result.status === "ERROR") return false;
  if (result.status === "NEED_INFO") return false;
  
  // CRITICAL: Never display code without evidence
  if (!result.evidence || result.evidence.length === 0) {
    logger.warn("[ANTI-HALLUCINATION] Tentative d'affichage sans preuves bloquée");
    return false;
  }
  
  if (!result.recommended_code) return false;
  
  return true;
}

/**
 * Format validation errors for logging
 */
export function formatValidationErrors(result: ValidationResult): string {
  const lines: string[] = [];
  
  if (result.errors.length > 0) {
    lines.push("❌ ERREURS:");
    result.errors.forEach((e) => lines.push(`  - ${e}`));
  }
  
  if (result.warnings.length > 0) {
    lines.push("⚠️ AVERTISSEMENTS:");
    result.warnings.forEach((w) => lines.push(`  - ${w}`));
  }
  
  return lines.join("\n");
}
