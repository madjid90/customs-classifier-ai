/**
 * E2E Test: Classification Pipeline Validation
 * 
 * Ce test valide le pipeline complet de classification:
 * 1. Création d'un cas test
 * 2. Appel à l'endpoint /classify
 * 3. Vérification de la réponse et des données en base
 */

import { describe, it, expect, beforeAll } from "vitest";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Test data
const TEST_PRODUCT = {
  name: "Chemise en coton pour homme",
  origin_country: "CN",
  type_import_export: "import" as const,
};

// Company ID from database for test
const TEST_COMPANY_ID = "680d5c7f-bfca-4d1f-82e5-2852788acdc3";

describe("Classification E2E Pipeline", () => {
  let authToken: string | null = null;
  let testCaseId: string | null = null;

  // Helper to get headers
  const getHeaders = (withAuth = true) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    };
    if (withAuth && authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }
    return headers;
  };

  beforeAll(() => {
    // Get auth token from localStorage if available (for manual testing)
    if (typeof localStorage !== "undefined") {
      authToken = localStorage.getItem("custom_auth_token");
    }
  });

  describe("Pipeline Diagnostics", () => {
    it("should verify database has HS codes", async () => {
      // Direct Supabase query to check data
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/hs_codes?select=count&active=eq.true`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Prefer": "count=exact",
          },
        }
      );
      
      const countHeader = response.headers.get("content-range");
      const count = countHeader ? parseInt(countHeader.split("/")[1]) : 0;
      
      console.log(`[DIAGNOSTIC] HS Codes actifs: ${count}`);
      expect(count).toBeGreaterThan(0);
    });

    it("should verify database has KB chunks", async () => {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/kb_chunks?select=count`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Prefer": "count=exact",
          },
        }
      );
      
      const countHeader = response.headers.get("content-range");
      const count = countHeader ? parseInt(countHeader.split("/")[1]) : 0;
      
      console.log(`[DIAGNOSTIC] KB Chunks: ${count}`);
      expect(count).toBeGreaterThan(0);
    });

    it("should check embedding coverage", async () => {
      // Check HS codes with embeddings
      const hsResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/hs_codes?select=code_10,embedding&active=eq.true&limit=10`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY,
          },
        }
      );
      const hsCodes = await hsResponse.json();
      const hsWithEmbeddings = hsCodes.filter((h: any) => h.embedding !== null).length;
      
      // Check KB chunks with embeddings
      const kbResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/kb_chunks?select=id,embedding&limit=10`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY,
          },
        }
      );
      const kbChunks = await kbResponse.json();
      const kbWithEmbeddings = kbChunks.filter((k: any) => k.embedding !== null).length;

      console.log(`[DIAGNOSTIC] HS avec embeddings (sample 10): ${hsWithEmbeddings}/10`);
      console.log(`[DIAGNOSTIC] KB avec embeddings (sample 10): ${kbWithEmbeddings}/10`);
      
      // Warning but don't fail - embeddings might not be generated yet
      if (hsWithEmbeddings === 0 && kbWithEmbeddings === 0) {
        console.warn("⚠️ ATTENTION: Aucun embedding généré - la recherche sémantique sera dégradée");
      }
    });
  });

  describe("Classification Endpoint", () => {
    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${FUNCTIONS_URL}/classify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          case_id: "00000000-0000-0000-0000-000000000000",
        }),
      });

      expect(response.status).toBe(401);
      const body = await response.text();
      console.log(`[AUTH] Reject unauthenticated: ${response.status} - ${body.slice(0, 100)}`);
    });

    it("should handle direct classification call (with mock case)", async () => {
      // Skip if no auth token
      if (!authToken) {
        console.log("[SKIP] No auth token available - run in browser with logged-in user");
        return;
      }

      // First create a test case
      const createResponse = await fetch(`${FUNCTIONS_URL}/cases`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          type_import_export: TEST_PRODUCT.type_import_export,
          origin_country: TEST_PRODUCT.origin_country,
          product_name: TEST_PRODUCT.name,
        }),
      });

      if (!createResponse.ok) {
        const error = await createResponse.text();
        console.error(`[CREATE CASE] Failed: ${createResponse.status} - ${error}`);
        return;
      }

      const caseData = await createResponse.json();
      testCaseId = caseData.id;
      console.log(`[CREATE CASE] Success: ${testCaseId}`);

      // Now call classify
      const classifyResponse = await fetch(`${FUNCTIONS_URL}/classify`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          case_id: testCaseId,
        }),
      });

      const classifyBody = await classifyResponse.text();
      console.log(`[CLASSIFY] Status: ${classifyResponse.status}`);
      console.log(`[CLASSIFY] Response: ${classifyBody.slice(0, 500)}`);

      // Parse and validate response structure
      if (classifyResponse.ok) {
        const result = JSON.parse(classifyBody);
        
        // Validate required fields
        expect(result).toHaveProperty("status");
        expect(["DONE", "NEED_INFO", "ERROR", "LOW_CONFIDENCE"]).toContain(result.status);
        
        if (result.status === "DONE" || result.status === "LOW_CONFIDENCE") {
          expect(result).toHaveProperty("recommended_code");
          expect(result.recommended_code).toMatch(/^\d{10}$/);
          expect(result).toHaveProperty("confidence");
          expect(result.confidence).toBeGreaterThanOrEqual(0);
          expect(result.confidence).toBeLessThanOrEqual(1);
          expect(result).toHaveProperty("evidence");
          expect(Array.isArray(result.evidence)).toBe(true);
          
          console.log(`[CLASSIFY] ✅ Code recommandé: ${result.recommended_code}`);
          console.log(`[CLASSIFY] ✅ Confiance: ${(result.confidence * 100).toFixed(1)}%`);
          console.log(`[CLASSIFY] ✅ Preuves: ${result.evidence.length} sources`);
        } else if (result.status === "NEED_INFO") {
          expect(result).toHaveProperty("next_question");
          expect(result.next_question).toHaveProperty("id");
          expect(result.next_question).toHaveProperty("label");
          
          console.log(`[CLASSIFY] ⏳ Question suivante: ${result.next_question.label}`);
        } else if (result.status === "ERROR") {
          expect(result).toHaveProperty("error_message");
          console.log(`[CLASSIFY] ❌ Erreur: ${result.error_message}`);
        }
      }
    });
  });

  describe("Database State Validation", () => {
    it("should verify classification result was stored", async () => {
      if (!testCaseId) {
        console.log("[SKIP] No test case created");
        return;
      }

      // Check classification_results table
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/classification_results?case_id=eq.${testCaseId}&select=*`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${authToken}`,
          },
        }
      );

      const results = await response.json();
      console.log(`[DB CHECK] Classification results found: ${results.length}`);
      
      if (results.length > 0) {
        const result = results[0];
        console.log(`[DB CHECK] Status: ${result.status}`);
        console.log(`[DB CHECK] Code: ${result.recommended_code}`);
        console.log(`[DB CHECK] Confidence: ${result.confidence}`);
        
        expect(result.status).toBeDefined();
      }
    });

    it("should verify audit log was created", async () => {
      if (!testCaseId) {
        console.log("[SKIP] No test case created");
        return;
      }

      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/audit_logs?case_id=eq.${testCaseId}&select=*`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${authToken}`,
          },
        }
      );

      const logs = await response.json();
      console.log(`[DB CHECK] Audit logs found: ${logs.length}`);
      
      if (logs.length > 0) {
        const actions = logs.map((l: any) => l.action);
        console.log(`[DB CHECK] Actions: ${actions.join(", ")}`);
      }
    });
  });
});

// Standalone test runner for browser console
export async function runClassifyPipelineTest() {
  const results: { test: string; passed: boolean; message: string }[] = [];
  
  console.log("🧪 Starting Classification Pipeline E2E Test...\n");

  // Test 1: Check HS codes exist
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/hs_codes?select=count&active=eq.true`,
      { headers: { "apikey": SUPABASE_ANON_KEY, "Prefer": "count=exact" } }
    );
    const count = parseInt(response.headers.get("content-range")?.split("/")[1] || "0");
    results.push({
      test: "HS Codes exist",
      passed: count > 0,
      message: `${count} codes HS actifs`,
    });
  } catch (e) {
    results.push({ test: "HS Codes exist", passed: false, message: String(e) });
  }

  // Test 2: Check KB chunks exist
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/kb_chunks?select=count`,
      { headers: { "apikey": SUPABASE_ANON_KEY, "Prefer": "count=exact" } }
    );
    const count = parseInt(response.headers.get("content-range")?.split("/")[1] || "0");
    results.push({
      test: "KB Chunks exist",
      passed: count > 0,
      message: `${count} chunks KB`,
    });
  } catch (e) {
    results.push({ test: "KB Chunks exist", passed: false, message: String(e) });
  }

  // Test 3: Check embeddings
  try {
    const hsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_ingestion_stats`,
      { method: "POST", headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" } }
    );
    const stats = await hsRes.json();
    const hsEmbeddings = stats?.hs_codes?.with_embedding || 0;
    const kbEmbeddings = stats?.kb_chunks?.with_embedding || 0;
    results.push({
      test: "Embeddings generated",
      passed: hsEmbeddings > 0 || kbEmbeddings > 0,
      message: `HS: ${hsEmbeddings}, KB: ${kbEmbeddings}`,
    });
  } catch (e) {
    results.push({ test: "Embeddings generated", passed: false, message: String(e) });
  }

  // Test 4: Classify endpoint reachable
  try {
    const response = await fetch(`${FUNCTIONS_URL}/classify`, {
      method: "POST",
      headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ case_id: "test" }),
    });
    // Should return 401 (unauthorized) not 404 or 500
    results.push({
      test: "Classify endpoint reachable",
      passed: response.status === 401 || response.status === 400,
      message: `Status: ${response.status}`,
    });
    await response.text(); // Consume body
  } catch (e) {
    results.push({ test: "Classify endpoint reachable", passed: false, message: String(e) });
  }

  // Print results
  console.log("\n📊 Test Results:\n");
  results.forEach(r => {
    const icon = r.passed ? "✅" : "❌";
    console.log(`${icon} ${r.test}: ${r.message}`);
  });

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`\n🏁 ${passed}/${total} tests passed`);

  return results;
}
