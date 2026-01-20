import { describe, it, expect } from "vitest";
import {
  extractHSCodesFromText,
  cleanText,
  isAllowedUrl,
  isValidHSCode,
  normalizeHSCode,
  formatHSCode,
} from "../lib/hs-code-utils";

// =============================================================================
// extractHSCodesFromText Tests
// =============================================================================

describe("extractHSCodesFromText", () => {
  it("should extract 10-digit HS codes", () => {
    const text = "Le code HS 8471300010 est utilisé pour les ordinateurs portables.";
    const codes = extractHSCodesFromText(text);
    expect(codes).toContain("8471300010");
  });

  it("should extract dotted format HS codes (8471.30.00.10)", () => {
    const text = "Code tarifaire: 8471.30.00.10 pour les laptops.";
    const codes = extractHSCodesFromText(text);
    expect(codes).toContain("8471300010");
  });

  it("should extract 6-digit HS codes and pad to 10 digits", () => {
    const text = "Position SH 847130 - Machines automatiques de traitement";
    const codes = extractHSCodesFromText(text);
    expect(codes).toContain("8471300000");
  });

  it("should extract 8-digit HS codes and pad to 10 digits", () => {
    const text = "Sous-position 84713000 ordinateurs";
    const codes = extractHSCodesFromText(text);
    expect(codes).toContain("8471300000");
  });

  it("should return empty array for empty or null input", () => {
    expect(extractHSCodesFromText("")).toEqual([]);
    expect(extractHSCodesFromText(null as unknown as string)).toEqual([]);
  });

  it("should extract multiple codes from text", () => {
    const text = "Comparer 8471300010 avec 8528720000 pour les écrans.";
    const codes = extractHSCodesFromText(text);
    expect(codes).toHaveLength(2);
    expect(codes).toContain("8471300010");
    expect(codes).toContain("8528720000");
  });

  it("should not extract invalid codes (years, etc.)", () => {
    const text = "En 2024, le tarif a changé. Téléphone: 0612345678.";
    const codes = extractHSCodesFromText(text);
    // Should not include 2024 or phone numbers
    expect(codes.some(c => c.startsWith("2024"))).toBe(false);
  });

  it("should handle real-world customs text", () => {
    const text = `
      Nomenclature douanière marocaine:
      - Position 8471.30.00.10: Ordinateurs portables
      - Position 8528.72.00.00: Écrans et moniteurs
      - Chapitre 84: Machines et appareils
    `;
    const codes = extractHSCodesFromText(text);
    expect(codes).toContain("8471300010");
    expect(codes).toContain("8528720000");
  });
});

// =============================================================================
// isValidHSCode Tests
// =============================================================================

describe("isValidHSCode", () => {
  it("should validate correct 10-digit HS codes", () => {
    expect(isValidHSCode("8471300010")).toBe(true);
    expect(isValidHSCode("0102901000")).toBe(true);
    expect(isValidHSCode("9999999999")).toBe(true);
  });

  it("should reject codes with invalid chapters (00 or >99)", () => {
    expect(isValidHSCode("0012345678")).toBe(false);
  });

  it("should reject non-numeric codes", () => {
    expect(isValidHSCode("8471a30010")).toBe(false);
    expect(isValidHSCode("ABCDEFGHIJ")).toBe(false);
  });

  it("should reject too short codes", () => {
    expect(isValidHSCode("123")).toBe(false);
    expect(isValidHSCode("")).toBe(false);
  });

  it("should reject year-like patterns", () => {
    expect(isValidHSCode("20240101")).toBe(false);
    expect(isValidHSCode("19900101")).toBe(false);
  });
});

// =============================================================================
// cleanText Tests
// =============================================================================

describe("cleanText", () => {
  it("should remove multiple spaces", () => {
    expect(cleanText("hello    world")).toBe("hello world");
  });

  it("should trim leading and trailing whitespace", () => {
    expect(cleanText("  hello world  ")).toBe("hello world");
  });

  it("should collapse multiple newlines", () => {
    expect(cleanText("hello\n\n\n\nworld")).toBe("hello\nworld");
  });

  it("should handle mixed whitespace", () => {
    const input = "  Code HS:   8471.30  \n\n  Description  ";
    const result = cleanText(input);
    expect(result).toBe("Code HS: 8471.30\nDescription");
  });

  it("should handle empty string", () => {
    expect(cleanText("")).toBe("");
  });

  it("should handle tabs and other whitespace", () => {
    expect(cleanText("hello\t\tworld")).toBe("hello world");
  });
});

// =============================================================================
// isAllowedUrl Tests
// =============================================================================

describe("isAllowedUrl", () => {
  const baseUrl = "https://douane.gov.ma";

  it("should allow URLs on the same domain", () => {
    expect(isAllowedUrl("https://douane.gov.ma/tarif/2024", baseUrl)).toBe(true);
    expect(isAllowedUrl("https://douane.gov.ma/nomenclature", baseUrl)).toBe(true);
  });

  it("should reject URLs on different domains", () => {
    expect(isAllowedUrl("https://google.com/search", baseUrl)).toBe(false);
    expect(isAllowedUrl("https://example.com", baseUrl)).toBe(false);
  });

  it("should reject empty or null URLs", () => {
    expect(isAllowedUrl("", baseUrl)).toBe(false);
  });

  it("should apply link pattern when provided", () => {
    const pattern = "/tarif/";
    expect(isAllowedUrl("https://douane.gov.ma/tarif/2024", baseUrl, pattern)).toBe(true);
    expect(isAllowedUrl("https://douane.gov.ma/contact", baseUrl, pattern)).toBe(false);
  });

  it("should handle subdomain variations", () => {
    expect(isAllowedUrl("https://www.douane.gov.ma/page", "https://douane.gov.ma")).toBe(false);
  });
});

// =============================================================================
// normalizeHSCode Tests
// =============================================================================

describe("normalizeHSCode", () => {
  it("should pad short codes to 10 digits", () => {
    expect(normalizeHSCode("8471")).toBe("8471000000");
    expect(normalizeHSCode("847130")).toBe("8471300000");
    expect(normalizeHSCode("84713000")).toBe("8471300000");
  });

  it("should remove dots from formatted codes", () => {
    expect(normalizeHSCode("8471.30.00.10")).toBe("8471300010");
    expect(normalizeHSCode("8471.30")).toBe("8471300000");
  });

  it("should handle already normalized codes", () => {
    expect(normalizeHSCode("8471300010")).toBe("8471300010");
  });

  it("should handle empty input", () => {
    expect(normalizeHSCode("")).toBe("");
  });
});

// =============================================================================
// formatHSCode Tests
// =============================================================================

describe("formatHSCode", () => {
  it("should format 10-digit codes with dots", () => {
    expect(formatHSCode("8471300010")).toBe("8471.30.00.10");
    expect(formatHSCode("0102901000")).toBe("0102.90.10.00");
  });

  it("should format 6-digit codes", () => {
    expect(formatHSCode("847130")).toBe("8471.30.00.00");
  });

  it("should handle already formatted codes", () => {
    expect(formatHSCode("8471.30.00.10")).toBe("8471.30.00.10");
  });

  it("should handle empty input", () => {
    expect(formatHSCode("")).toBe("");
  });
});
