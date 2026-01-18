import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logger } from "../_shared/logger.ts";
import { corsHeaders, getCorsHeaders } from "../_shared/cors.ts";

interface HSCodeRow {
  code_10: string;
  code_6: string;
  chapter_2: string;
  label_fr: string;
  label_ar?: string;
  unit?: string;
  taxes?: Record<string, unknown>;
  restrictions?: string[];
}

interface ImportResult {
  total_rows: number;
  imported: number;
  updated: number;
  errors: number;
  warnings: string[];
  embeddings_triggered?: boolean;
  enrichment_triggered?: boolean;
}

// Parse CSV content
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(/[;,\t]/).map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
  const rows: Record<string, string>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(/[;,\t]/).map(v => v.trim().replace(/^["']|["']$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  
  return rows;
}

// Normalize HS code to 10 digits
function normalizeCode(code: string): string | null {
  const cleaned = code.replace(/\D/g, '');
  if (cleaned.length < 6) return null;
  // Pad to 10 digits
  return cleaned.padEnd(10, '0').substring(0, 10);
}

// Map CSV row to HS code structure
function mapRowToHSCode(row: Record<string, string>, versionLabel: string): HSCodeRow | null {
  // Try different column name variations
  const codeRaw = row['code'] || row['code_10'] || row['hs_code'] || row['code_sh'] || row['nomenclature'] || '';
  const code10 = normalizeCode(codeRaw);
  
  if (!code10) return null;
  
  const labelFr = row['label_fr'] || row['libelle'] || row['libelle_fr'] || row['designation'] || row['description'] || '';
  if (!labelFr) return null;
  
  return {
    code_10: code10,
    code_6: code10.substring(0, 6),
    chapter_2: code10.substring(0, 2),
    label_fr: labelFr.substring(0, 1000), // Limit length
    label_ar: row['label_ar'] || row['libelle_ar'] || undefined,
    unit: row['unit'] || row['unite'] || undefined,
    taxes: undefined,
    restrictions: undefined,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ message: "Non authentifie" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ message: "Token invalide" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!roleData) {
      return new Response(
        JSON.stringify({ message: "Acces reserve aux administrateurs" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/admin-import-hs\/?/, "");

    if (req.method === "POST" && (path === "" || path === "/")) {
      // Import HS codes
      const { content, format, version_label, mode = "upsert" } = await req.json();
      
      if (!content || !version_label) {
        return new Response(
          JSON.stringify({ message: "Contenu et version requis" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logger.info(`[import-hs] Starting import, format: ${format}, version: ${version_label}, mode: ${mode}`);
      
      let rows: Record<string, string>[] = [];
      
      if (format === "csv") {
        rows = parseCSV(content);
      } else if (format === "json") {
        try {
          const parsed = JSON.parse(content);
          rows = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return new Response(
            JSON.stringify({ message: "Format JSON invalide" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        return new Response(
          JSON.stringify({ message: "Format non supporte. Utilisez csv ou json." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logger.debug(`[import-hs] Parsed ${rows.length} rows`);

      const result: ImportResult = {
        total_rows: rows.length,
        imported: 0,
        updated: 0,
        errors: 0,
        warnings: [],
      };

      // Process in batches
      const batchSize = 100;
      const hsCodes: (HSCodeRow & { active_version_label: string })[] = [];

      for (const row of rows) {
        const hsCode = mapRowToHSCode(row, version_label);
        if (hsCode) {
          hsCodes.push({ ...hsCode, active_version_label: version_label });
        } else {
          result.errors++;
          if (result.warnings.length < 10) {
            result.warnings.push(`Ligne invalide: ${JSON.stringify(row).substring(0, 100)}`);
          }
        }
      }

      // Upsert in batches
      for (let i = 0; i < hsCodes.length; i += batchSize) {
        const batch = hsCodes.slice(i, i + batchSize);
        
        if (mode === "upsert") {
          const { error: upsertError } = await supabase
            .from("hs_codes")
            .upsert(batch, { onConflict: "code_10" });
          
          if (upsertError) {
            logger.error(`[import-hs] Batch error:`, upsertError);
            result.errors += batch.length;
            result.warnings.push(`Erreur batch ${i}: ${upsertError.message}`);
          } else {
            result.imported += batch.length;
          }
        } else if (mode === "insert") {
          const { error: insertError } = await supabase
            .from("hs_codes")
            .insert(batch);
          
          if (insertError) {
            logger.error(`[import-hs] Insert error:`, insertError);
            result.errors += batch.length;
            if (insertError.message.includes("duplicate")) {
              result.warnings.push(`Codes dupliques ignores dans batch ${i}`);
            } else {
              result.warnings.push(`Erreur batch ${i}: ${insertError.message}`);
            }
          } else {
            result.imported += batch.length;
          }
        }
      }

      logger.info(`[import-hs] Import complete:`, result);

      // ========================================================================
      // BACKGROUND TASKS: Auto-trigger embeddings and enrichment after import
      // ========================================================================
      
      const runBackgroundTask = (task: () => Promise<void>) => {
        // @ts-ignore - EdgeRuntime disponible dans Deno Deploy
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
          // @ts-ignore
          EdgeRuntime.waitUntil(task());
        } else {
          task();
        }
      };

      if (result.imported > 0) {
        result.embeddings_triggered = true;
        result.enrichment_triggered = true;

        // 1. Auto-generate embeddings for new HS codes
        console.log(`[import-hs] Triggering background HS embeddings generation`);
        
        const embeddingsTask = async () => {
          try {
            // Small delay to ensure codes are committed
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const embResponse = await fetch(`${supabaseUrl}/functions/v1/generate-embeddings`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                mode: "batch",
                target: "hs",
                batch_size: Math.min(result.imported, 50),
              }),
            });
            
            if (embResponse.ok) {
              const embResult = await embResponse.json();
              console.log(`[import-hs] HS embeddings generated: ${embResult.processed} processed, ${embResult.remaining} remaining`);
            } else {
              console.error(`[import-hs] HS embeddings failed: ${embResponse.status}`);
            }
          } catch (e) {
            console.error("[import-hs] HS embeddings error:", e);
          }
        };
        
        runBackgroundTask(embeddingsTask);

        // 2. Auto-enrich HS codes
        console.log(`[import-hs] Triggering background HS enrichment`);
        
        const enrichTask = async () => {
          try {
            // Wait for embeddings to start first
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const enrichResponse = await fetch(`${supabaseUrl}/functions/v1/enrich-hs-codes`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                batch_size: Math.min(result.imported, 20),
              }),
            });
            
            if (enrichResponse.ok) {
              const enrichResult = await enrichResponse.json();
              console.log(`[import-hs] HS enrichment complete: ${enrichResult.processed} processed, ${enrichResult.remaining} remaining`);
            } else {
              console.error(`[import-hs] HS enrichment failed: ${enrichResponse.status}`);
            }
          } catch (e) {
            console.error("[import-hs] HS enrichment error:", e);
          }
        };
        
        runBackgroundTask(enrichTask);
      }

      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (req.method === "GET" && path === "stats") {
      // Get stats about hs_codes table
      const { count: totalCodes } = await supabase
        .from("hs_codes")
        .select("*", { count: "exact", head: true });

      const { data: chapters } = await supabase
        .from("hs_codes")
        .select("chapter_2")
        .limit(1000);

      const uniqueChapters = new Set(chapters?.map(c => c.chapter_2) || []);

      const { data: versions } = await supabase
        .from("hs_codes")
        .select("active_version_label")
        .limit(1);

      return new Response(
        JSON.stringify({
          total_codes: totalCodes || 0,
          chapters_count: uniqueChapters.size,
          current_version: versions?.[0]?.active_version_label || null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (req.method === "GET" && path === "search") {
      // Search HS codes
      const query = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit") || "20");

      if (query.length < 2) {
        return new Response(
          JSON.stringify({ codes: [], total: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Search by code or label
      const isCodeSearch = /^\d+$/.test(query);
      
      let queryBuilder = supabase.from("hs_codes").select("*", { count: "exact" });
      
      if (isCodeSearch) {
        queryBuilder = queryBuilder.like("code_10", `${query}%`);
      } else {
        queryBuilder = queryBuilder.ilike("label_fr", `%${query}%`);
      }

      const { data: codes, count, error } = await queryBuilder.limit(limit);

      if (error) {
        logger.error("[import-hs] Search error:", error);
        return new Response(
          JSON.stringify({ message: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ codes: codes || [], total: count || 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (req.method === "DELETE" && path === "clear") {
      // Clear all HS codes (dangerous, requires confirmation)
      const { confirm } = await req.json();
      
      if (confirm !== "DELETE_ALL_HS_CODES") {
        return new Response(
          JSON.stringify({ message: "Confirmation requise" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error } = await supabase
        .from("hs_codes")
        .delete()
        .neq("code_10", "");

      if (error) {
        return new Response(
          JSON.stringify({ message: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ message: "Tous les codes ont ete supprimes" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ message: "Route non trouvee" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    logger.error("[import-hs] Error:", error);
    return new Response(
      JSON.stringify({ message: error instanceof Error ? error.message : "Erreur serveur" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
