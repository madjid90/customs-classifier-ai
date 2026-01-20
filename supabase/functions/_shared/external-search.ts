/**
 * External Search Module for Customs Sources
 * 
 * Provides web search capabilities for external customs databases and official sources.
 * Uses Serper API (Google Search) when available, with graceful fallback.
 */

// Check if external search is enabled
function isExternalSearchEnabled(): boolean {
  const enabled = Deno.env.get("EXTERNAL_SEARCH_ENABLED");
  // Disabled only if explicitly set to 'false'
  if (enabled === "false") {
    return false;
  }
  // Enabled if SERPER_API_KEY is configured
  return !!Deno.env.get("SERPER_API_KEY");
}

// Types
export interface ExternalSearchResult {
  source: "adii" | "eu_taric" | "omd" | "other";
  source_url: string;
  title: string;
  excerpt: string;
  hs_codes_mentioned: string[];
  confidence: number;
  retrieved_at: string;
}

export interface SearchOptions {
  maxResults?: number;
  includeSnippets?: boolean;
  language?: "fr" | "en" | "ar";
  dateRestrict?: string; // e.g., "m1" for last month, "y1" for last year
}

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
}

interface SerperResponse {
  organic?: SerperResult[];
  knowledgeGraph?: {
    title?: string;
    description?: string;
  };
}

// Constants
const SERPER_API_URL = "https://google.serper.dev/search";
const HS_CODE_REGEX = /\b(\d{4}(?:\.\d{2})?(?:\.\d{2})?(?:\.\d{2})?)\b/g;
const HS_10_DIGIT_REGEX = /\b(\d{10})\b/g;
const HS_8_DIGIT_REGEX = /\b(\d{8})\b/g;
const HS_6_DIGIT_REGEX = /\b(\d{6})\b/g;
const HS_4_DIGIT_REGEX = /\b(\d{4})\b/g;

/**
 * Extract HS codes from text using multiple regex patterns
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
 * Validate if a code looks like a valid HS code
 */
function isValidHSCode(code: string): boolean {
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
 * Search external customs sources using Serper API
 */
export async function searchExternalCustomsSources(
  query: string,
  options: SearchOptions = {}
): Promise<ExternalSearchResult[]> {
  // Check if external search is enabled
  if (!isExternalSearchEnabled()) {
    console.log("[external-search] External search disabled via EXTERNAL_SEARCH_ENABLED=false");
    return [];
  }

  const serperApiKey = Deno.env.get("SERPER_API_KEY");

  if (!serperApiKey) {
    console.warn(
      "[external-search] SERPER_API_KEY not configured. External search disabled."
    );
    return [];
  }

  const { maxResults = 10, language = "fr", dateRestrict } = options;

  try {
    const results: ExternalSearchResult[] = [];

    // Search ADII (Moroccan customs)
    const adiiResults = await searchWithSerper(
      serperApiKey,
      `site:douane.gov.ma ${query}`,
      { maxResults: Math.ceil(maxResults / 2), language, dateRestrict }
    );

    for (const result of adiiResults) {
      results.push({
        source: "adii",
        source_url: result.link,
        title: result.title,
        excerpt: result.snippet,
        hs_codes_mentioned: extractHSCodesFromText(
          `${result.title} ${result.snippet}`
        ),
        confidence: calculateConfidence(result, query),
        retrieved_at: new Date().toISOString(),
      });
    }

    // Search OMD/WCO
    const omdResults = await searchWithSerper(
      serperApiKey,
      `site:wcoomd.org ${query}`,
      { maxResults: Math.ceil(maxResults / 4), language: "en", dateRestrict }
    );

    for (const result of omdResults) {
      results.push({
        source: "omd",
        source_url: result.link,
        title: result.title,
        excerpt: result.snippet,
        hs_codes_mentioned: extractHSCodesFromText(
          `${result.title} ${result.snippet}`
        ),
        confidence: calculateConfidence(result, query),
        retrieved_at: new Date().toISOString(),
      });
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence);

    return results.slice(0, maxResults);
  } catch (error) {
    console.error("[external-search] Error searching external sources:", error);
    return [];
  }
}

/**
 * Search specifically on ADII (Moroccan Customs)
 */
export async function searchADII(
  query: string,
  options: SearchOptions = {}
): Promise<ExternalSearchResult[]> {
  // Check if external search is enabled
  if (!isExternalSearchEnabled()) {
    console.log("[external-search] ADII search disabled via EXTERNAL_SEARCH_ENABLED=false");
    return [];
  }

  const serperApiKey = Deno.env.get("SERPER_API_KEY");

  if (!serperApiKey) {
    console.warn(
      "[external-search] SERPER_API_KEY not configured. ADII search disabled."
    );
    return [];
  }

  const { maxResults = 10, language = "fr", dateRestrict } = options;

  try {
    // Multiple search queries for better coverage
    const queries = [
      `site:douane.gov.ma ${query}`,
      `site:douane.gov.ma tarif ${query}`,
      `site:douane.gov.ma circulaire ${query}`,
    ];

    const allResults: ExternalSearchResult[] = [];

    for (const searchQuery of queries) {
      const results = await searchWithSerper(serperApiKey, searchQuery, {
        maxResults: Math.ceil(maxResults / queries.length),
        language,
        dateRestrict,
      });

      for (const result of results) {
        // Avoid duplicates
        if (allResults.some((r) => r.source_url === result.link)) continue;

        allResults.push({
          source: "adii",
          source_url: result.link,
          title: result.title,
          excerpt: result.snippet,
          hs_codes_mentioned: extractHSCodesFromText(
            `${result.title} ${result.snippet}`
          ),
          confidence: calculateConfidence(result, query),
          retrieved_at: new Date().toISOString(),
        });
      }
    }

    // Sort by confidence and return top results
    allResults.sort((a, b) => b.confidence - a.confidence);
    return allResults.slice(0, maxResults);
  } catch (error) {
    console.error("[external-search] Error searching ADII:", error);
    return [];
  }
}

/**
 * Search EU TARIC database for HS code information
 */
export async function searchEUTaric(
  hsCode: string,
  options: SearchOptions = {}
): Promise<ExternalSearchResult[]> {
  // Check if external search is enabled
  if (!isExternalSearchEnabled()) {
    console.log("[external-search] EU TARIC search disabled via EXTERNAL_SEARCH_ENABLED=false");
    return [];
  }

  const serperApiKey = Deno.env.get("SERPER_API_KEY");

  if (!serperApiKey) {
    console.warn(
      "[external-search] SERPER_API_KEY not configured. EU TARIC search disabled."
    );
    return [];
  }

  // Normalize HS code
  const normalizedCode = hsCode.replace(/\./g, "").substring(0, 10);
  const chapter = normalizedCode.substring(0, 2);
  const heading = normalizedCode.substring(0, 4);
  const subheading = normalizedCode.substring(0, 6);

  const { maxResults = 5, language = "en" } = options;

  try {
    const results: ExternalSearchResult[] = [];

    // Search EU TARIC consultation
    const taricQuery = `site:ec.europa.eu TARIC ${subheading}`;
    const taricResults = await searchWithSerper(serperApiKey, taricQuery, {
      maxResults,
      language,
    });

    for (const result of taricResults) {
      results.push({
        source: "eu_taric",
        source_url: result.link,
        title: result.title,
        excerpt: result.snippet,
        hs_codes_mentioned: [normalizedCode],
        confidence: calculateTaricConfidence(result, normalizedCode),
        retrieved_at: new Date().toISOString(),
      });
    }

    // Also search EUR-Lex for regulations
    const eurLexQuery = `site:eur-lex.europa.eu tarif douanier ${heading}`;
    const eurLexResults = await searchWithSerper(serperApiKey, eurLexQuery, {
      maxResults: Math.ceil(maxResults / 2),
      language: "fr",
    });

    for (const result of eurLexResults) {
      results.push({
        source: "eu_taric",
        source_url: result.link,
        title: result.title,
        excerpt: result.snippet,
        hs_codes_mentioned: extractHSCodesFromText(
          `${result.title} ${result.snippet}`
        ),
        confidence: calculateTaricConfidence(result, normalizedCode),
        retrieved_at: new Date().toISOString(),
      });
    }

    results.sort((a, b) => b.confidence - a.confidence);
    return results.slice(0, maxResults);
  } catch (error) {
    console.error("[external-search] Error searching EU TARIC:", error);
    return [];
  }
}

/**
 * Internal: Make a search request to Serper API
 */
async function searchWithSerper(
  apiKey: string,
  query: string,
  options: { maxResults?: number; language?: string; dateRestrict?: string }
): Promise<SerperResult[]> {
  const { maxResults = 10, language = "fr", dateRestrict } = options;

  const body: Record<string, unknown> = {
    q: query,
    num: maxResults,
    gl: language === "fr" ? "ma" : language === "ar" ? "ma" : "us",
    hl: language,
  };

  if (dateRestrict) {
    body.tbs = `qdr:${dateRestrict}`;
  }

  const response = await fetch(SERPER_API_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Serper API error: ${response.status} - ${errorText}`);
  }

  const data: SerperResponse = await response.json();
  return data.organic || [];
}

/**
 * Calculate confidence score for a search result
 */
function calculateConfidence(result: SerperResult, query: string): number {
  let confidence = 0.5; // Base confidence

  const lowerTitle = result.title.toLowerCase();
  const lowerSnippet = result.snippet.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const queryTerms = lowerQuery.split(/\s+/).filter((t) => t.length > 2);

  // Title contains query terms
  const titleMatches = queryTerms.filter((term) =>
    lowerTitle.includes(term)
  ).length;
  confidence += (titleMatches / queryTerms.length) * 0.2;

  // Snippet contains query terms
  const snippetMatches = queryTerms.filter((term) =>
    lowerSnippet.includes(term)
  ).length;
  confidence += (snippetMatches / queryTerms.length) * 0.1;

  // Contains HS codes
  const hsCodes = extractHSCodesFromText(`${result.title} ${result.snippet}`);
  if (hsCodes.length > 0) {
    confidence += 0.1;
  }

  // Official source indicators
  if (
    result.link.includes("douane.gov.ma") ||
    result.link.includes("wcoomd.org") ||
    result.link.includes("ec.europa.eu")
  ) {
    confidence += 0.1;
  }

  // Keywords indicating official/relevant content
  const officialKeywords = [
    "tarif",
    "nomenclature",
    "douane",
    "customs",
    "circulaire",
    "note explicative",
  ];
  for (const keyword of officialKeywords) {
    if (lowerTitle.includes(keyword) || lowerSnippet.includes(keyword)) {
      confidence += 0.05;
    }
  }

  return Math.min(confidence, 1.0);
}

/**
 * Calculate confidence for TARIC-specific results
 */
function calculateTaricConfidence(result: SerperResult, hsCode: string): number {
  let confidence = 0.4;

  const content = `${result.title} ${result.snippet}`;

  // Check if the HS code appears in the result
  if (content.includes(hsCode)) {
    confidence += 0.3;
  } else if (content.includes(hsCode.substring(0, 6))) {
    confidence += 0.2;
  } else if (content.includes(hsCode.substring(0, 4))) {
    confidence += 0.1;
  }

  // TARIC-specific keywords
  const taricKeywords = ["TARIC", "Combined Nomenclature", "CN code", "duty"];
  for (const keyword of taricKeywords) {
    if (content.toLowerCase().includes(keyword.toLowerCase())) {
      confidence += 0.05;
    }
  }

  // Official EU sources get a boost
  if (result.link.includes("ec.europa.eu") || result.link.includes("eur-lex")) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1.0);
}
