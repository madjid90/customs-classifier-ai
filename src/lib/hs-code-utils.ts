/**
 * HS Code Utilities
 * 
 * Shared utilities for HS code extraction and validation.
 * These functions mirror the logic in Edge Functions for frontend use and testing.
 */

// Regex patterns for HS code extraction
const HS_CODE_REGEX = /\b(\d{4}(?:\.\d{2})?(?:\.\d{2})?(?:\.\d{2})?)\b/g;
const HS_10_DIGIT_REGEX = /\b(\d{10})\b/g;
const HS_8_DIGIT_REGEX = /\b(\d{8})\b/g;
const HS_6_DIGIT_REGEX = /\b(\d{6})\b/g;

/**
 * Validate if a code looks like a valid HS code
 */
export function isValidHSCode(code: string): boolean {
  if (!code || code.length < 4) return false;
  
  // Check if all digits
  if (!/^\d+$/.test(code)) return false;

  // Valid chapters are 01-99
  const chapter = parseInt(code.substring(0, 2), 10);
  if (chapter < 1 || chapter > 99) return false;

  // Exclude obvious non-HS codes (years, phone numbers, etc.)
  const asNumber = parseInt(code, 10);
  if (code.length >= 8) {
    // Exclude years (1900-2100)
    if (asNumber >= 19000000 && asNumber <= 21009999) return false;
  }

  return true;
}

/**
 * Extract HS codes from text using multiple regex patterns
 * Returns normalized 10-digit codes
 */
export function extractHSCodesFromText(text: string): string[] {
  if (!text) return [];

  const codes = new Set<string>();

  // Try dotted format first (e.g., 8471.30.00.10)
  const dottedMatches = text.match(HS_CODE_REGEX);
  if (dottedMatches) {
    for (const match of dottedMatches) {
      // Normalize to 10-digit format
      const normalized = match.replace(/\./g, "").padEnd(10, "0");
      if (isValidHSCode(normalized)) {
        codes.add(normalized);
      }
    }
  }

  // Try 10-digit format
  const tenDigitMatches = text.match(HS_10_DIGIT_REGEX);
  if (tenDigitMatches) {
    for (const match of tenDigitMatches) {
      if (isValidHSCode(match)) {
        codes.add(match);
      }
    }
  }

  // Try 8-digit format
  const eightDigitMatches = text.match(HS_8_DIGIT_REGEX);
  if (eightDigitMatches) {
    for (const match of eightDigitMatches) {
      // Only add if it looks like an HS code (starts with valid chapter)
      if (isValidHSCode(match.padEnd(10, "0"))) {
        codes.add(match.padEnd(10, "0"));
      }
    }
  }

  // Try 6-digit format (international HS)
  const sixDigitMatches = text.match(HS_6_DIGIT_REGEX);
  if (sixDigitMatches) {
    for (const match of sixDigitMatches) {
      if (isValidHSCode(match.padEnd(10, "0"))) {
        codes.add(match.padEnd(10, "0"));
      }
    }
  }

  return Array.from(codes);
}

/**
 * Clean text by removing multiple whitespaces and trimming
 */
export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

/**
 * Check if URL is allowed (on the same domain)
 * Used for web scraping to prevent crawling external sites
 */
export function isAllowedUrl(url: string, baseUrl: string, linkPattern?: string): boolean {
  if (!url) return false;
  
  // Must start with the base URL
  if (!url.startsWith(baseUrl)) {
    return false;
  }

  // Check against link pattern if provided
  if (linkPattern) {
    try {
      const pattern = new RegExp(linkPattern);
      if (!pattern.test(url)) {
        return false;
      }
    } catch {
      console.warn(`Invalid link_pattern: ${linkPattern}`);
    }
  }

  return true;
}

/**
 * Normalize an HS code to 10-digit format
 */
export function normalizeHSCode(code: string): string {
  if (!code) return "";
  
  // Remove dots and spaces
  const cleaned = code.replace(/[\.\s]/g, "");
  
  // Pad to 10 digits
  return cleaned.padEnd(10, "0");
}

/**
 * Format HS code for display (with dots)
 */
export function formatHSCode(code: string): string {
  if (!code) return "";
  
  const normalized = normalizeHSCode(code);
  
  if (normalized.length >= 10) {
    return `${normalized.slice(0, 4)}.${normalized.slice(4, 6)}.${normalized.slice(6, 8)}.${normalized.slice(8, 10)}`;
  } else if (normalized.length >= 6) {
    return `${normalized.slice(0, 4)}.${normalized.slice(4, 6)}`;
  } else if (normalized.length >= 4) {
    return normalized.slice(0, 4);
  }
  
  return normalized;
}
