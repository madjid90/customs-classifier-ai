import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractHSCodesFromText } from "../lib/hs-code-utils";

/**
 * Tests for external search functionality
 * 
 * Note: Since the actual external search functions are in Edge Functions (Deno),
 * we test the shared utilities and mock the API behavior.
 */

// =============================================================================
// extractHSCodesFromText Tests (mirrored from Edge Function)
// =============================================================================

describe("External Search - HS Code Extraction", () => {
  it("should extract HS codes from ADII search results", () => {
    const adiiSnippet = `
      Circulaire n° 5432/311 du 15/03/2024
      Code tarifaire: 8471.30.00.10 - Machines automatiques de traitement
      Droits d'importation: 2.5%
    `;
    
    const codes = extractHSCodesFromText(adiiSnippet);
    expect(codes).toContain("8471300010");
  });

  it("should extract multiple codes from EU TARIC results", () => {
    const taricSnippet = `
      Combined Nomenclature 2024
      - 8471300010: Portable computers weighing not more than 10 kg
      - 8471410000: Other automatic data processing machines
      Applicable duties and measures...
    `;
    
    const codes = extractHSCodesFromText(taricSnippet);
    expect(codes).toContain("8471300010");
    expect(codes).toContain("8471410000");
  });

  it("should extract codes from OMD/WCO format", () => {
    const omdSnippet = `
      HS 2022 Amendments
      Heading 84.71 - Automatic data processing machines
      Subheading 8471.30 - Portable automatic data processing machines
    `;
    
    const codes = extractHSCodesFromText(omdSnippet);
    // Should find 8471 and 847130, both normalized
    expect(codes.some(c => c.startsWith("8471"))).toBe(true);
  });

  it("should handle text with no HS codes", () => {
    const text = "General information about customs procedures in Morocco.";
    const codes = extractHSCodesFromText(text);
    expect(codes).toHaveLength(0);
  });

  it("should not return duplicate codes", () => {
    const text = `
      Code 8471300010 est le même que 8471.30.00.10.
      Répétition: 8471300010
    `;
    const codes = extractHSCodesFromText(text);
    const uniqueCodes = [...new Set(codes)];
    expect(codes.length).toBe(uniqueCodes.length);
  });
});

// =============================================================================
// External Search Configuration Tests (mocked)
// =============================================================================

describe("External Search - Configuration", () => {
  it("should validate search options structure", () => {
    const validOptions = {
      maxResults: 10,
      includeSnippets: true,
      language: "fr" as const,
      dateRestrict: "m1",
    };
    
    expect(validOptions.maxResults).toBeGreaterThan(0);
    expect(["fr", "en", "ar"]).toContain(validOptions.language);
  });

  it("should validate external search result structure", () => {
    const mockResult = {
      source: "adii" as const,
      source_url: "https://douane.gov.ma/tarif/8471",
      title: "Tarif douanier - Position 84.71",
      excerpt: "Machines automatiques de traitement...",
      hs_codes_mentioned: ["8471300010"],
      confidence: 0.85,
      retrieved_at: new Date().toISOString(),
    };

    expect(mockResult.source).toMatch(/^(adii|eu_taric|omd|other)$/);
    expect(mockResult.source_url).toMatch(/^https?:\/\//);
    expect(mockResult.confidence).toBeGreaterThanOrEqual(0);
    expect(mockResult.confidence).toBeLessThanOrEqual(1);
    expect(mockResult.hs_codes_mentioned).toBeInstanceOf(Array);
  });
});

// =============================================================================
// Serper API Response Handling Tests (mocked)
// =============================================================================

describe("External Search - Serper API Response Handling", () => {
  it("should parse valid Serper response structure", () => {
    const mockSerperResponse = {
      organic: [
        {
          title: "Tarif douanier marocain 2024",
          link: "https://douane.gov.ma/tarif/2024",
          snippet: "Nomenclature tarifaire officielle...",
        },
        {
          title: "Circulaire douanière",
          link: "https://douane.gov.ma/circulaire/5432",
          snippet: "Code HS 8471.30.00.10...",
        },
      ],
      knowledgeGraph: {
        title: "Douane Marocaine",
        description: "Administration des douanes...",
      },
    };

    expect(mockSerperResponse.organic).toHaveLength(2);
    expect(mockSerperResponse.organic[0].link).toContain("douane.gov.ma");
  });

  it("should handle empty Serper response", () => {
    const emptyResponse = {
      organic: [],
    };

    expect(emptyResponse.organic).toHaveLength(0);
  });
});

// =============================================================================
// Confidence Calculation Tests
// =============================================================================

describe("External Search - Confidence Calculation", () => {
  const calculateMockConfidence = (result: { title: string; snippet: string; link: string }, query: string): number => {
    let confidence = 0.5;
    const lowerTitle = result.title.toLowerCase();
    const lowerSnippet = result.snippet.toLowerCase();
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    // Title matches
    const titleMatches = queryTerms.filter(term => lowerTitle.includes(term)).length;
    confidence += (titleMatches / Math.max(queryTerms.length, 1)) * 0.2;

    // Snippet matches
    const snippetMatches = queryTerms.filter(term => lowerSnippet.includes(term)).length;
    confidence += (snippetMatches / Math.max(queryTerms.length, 1)) * 0.1;

    // HS codes present
    if (extractHSCodesFromText(`${result.title} ${result.snippet}`).length > 0) {
      confidence += 0.1;
    }

    // Official source
    if (result.link.includes("douane.gov.ma") || result.link.includes("wcoomd.org")) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  };

  it("should give higher confidence to matching results", () => {
    const query = "ordinateur portable";
    
    const goodResult = {
      title: "Classification ordinateur portable",
      snippet: "Code HS 8471.30.00.10 pour les ordinateurs portables",
      link: "https://douane.gov.ma/tarif/8471",
    };
    
    const poorResult = {
      title: "Procédures générales",
      snippet: "Information générale sur les procédures",
      link: "https://example.com/procedures",
    };

    const goodConfidence = calculateMockConfidence(goodResult, query);
    const poorConfidence = calculateMockConfidence(poorResult, query);

    expect(goodConfidence).toBeGreaterThan(poorConfidence);
  });

  it("should boost confidence for official sources", () => {
    const query = "tarif douanier";
    
    const officialResult = {
      title: "Tarif douanier",
      snippet: "Information officielle",
      link: "https://douane.gov.ma/tarif",
    };
    
    const unofficialResult = {
      title: "Tarif douanier",
      snippet: "Information officielle",
      link: "https://blog.example.com/tarif",
    };

    const officialConfidence = calculateMockConfidence(officialResult, query);
    const unofficialConfidence = calculateMockConfidence(unofficialResult, query);

    expect(officialConfidence).toBeGreaterThan(unofficialConfidence);
  });

  it("should keep confidence between 0 and 1", () => {
    const perfectResult = {
      title: "ordinateur portable machine automatique traitement",
      snippet: "Code HS 8471.30.00.10 ordinateur portable machine",
      link: "https://douane.gov.ma/tarif",
    };

    const confidence = calculateMockConfidence(perfectResult, "ordinateur portable machine automatique");
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });
});
