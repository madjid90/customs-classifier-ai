import { authenticateRequest, createServiceClient } from "../_shared/auth.ts";
import { logger } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

interface DUMRecord {
  dum_date: string;
  dum_number?: string;
  product_description: string;
  hs_code_10: string;
  origin_country: string;
  attachments?: unknown[];
  reliability_score?: number;
}

interface ColumnMapping {
  dum_date: string;
  dum_number?: string;
  product_description: string;
  hs_code_10: string;
  origin_country: string;
}

interface ImportResult {
  total_rows: number;
  imported: number;
  errors: number;
  warnings: string[];
  duplicates: number;
}

// Parse CSV content
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(/[;,\t]/).map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows: Record<string, string>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(/[;,\t]/).map(v => v.trim().replace(/^["']|["']$/g, ''));
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
  return cleaned.padEnd(10, '0').substring(0, 10);
}

// Parse date from various formats
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  
  // ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 10);
  }
  
  // European DD/MM/YYYY or DD-MM-YYYY
  const euroMatch = dateStr.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (euroMatch) {
    const [_, day, month, year] = euroMatch;
    return `${year}-${month}-${day}`;
  }
  
  // Try parsing with Date
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().substring(0, 10);
    }
  } catch {
    // ignore
  }
  
  return null;
}

// Auto-detect column mapping based on header names
function autoDetectMapping(headers: string[]): Partial<ColumnMapping> {
  const mapping: Partial<ColumnMapping> = {};
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
  
  // Date patterns
  const datePatterns = ['date', 'dum_date', 'date_dum', 'date_declaration', 'declaration_date'];
  for (const pattern of datePatterns) {
    const idx = normalizedHeaders.findIndex(h => h.includes(pattern));
    if (idx !== -1) {
      mapping.dum_date = headers[idx];
      break;
    }
  }
  
  // DUM number patterns
  const numPatterns = ['numero', 'number', 'dum_number', 'num_dum', 'reference', 'ref', 'n°'];
  for (const pattern of numPatterns) {
    const idx = normalizedHeaders.findIndex(h => h.includes(pattern) && !h.includes('date'));
    if (idx !== -1) {
      mapping.dum_number = headers[idx];
      break;
    }
  }
  
  // Product description patterns
  const descPatterns = ['description', 'produit', 'product', 'designation', 'libelle', 'marchandise', 'article'];
  for (const pattern of descPatterns) {
    const idx = normalizedHeaders.findIndex(h => h.includes(pattern));
    if (idx !== -1) {
      mapping.product_description = headers[idx];
      break;
    }
  }
  
  // HS code patterns
  const codePatterns = ['code', 'hs_code', 'code_sh', 'sh_code', 'nomenclature', 'nsh', 'position', 'tarif'];
  for (const pattern of codePatterns) {
    const idx = normalizedHeaders.findIndex(h => h.includes(pattern));
    if (idx !== -1) {
      mapping.hs_code_10 = headers[idx];
      break;
    }
  }
  
  // Origin country patterns
  const originPatterns = ['origin', 'origine', 'country', 'pays', 'provenance', 'pays_origine'];
  for (const pattern of originPatterns) {
    const idx = normalizedHeaders.findIndex(h => h.includes(pattern));
    if (idx !== -1) {
      mapping.origin_country = headers[idx];
      break;
    }
  }
  
  return mapping;
}

// Map row to DUM record using column mapping
function mapRowToDUM(row: Record<string, string>, mapping: ColumnMapping): DUMRecord | null {
  const dateStr = row[mapping.dum_date];
  const parsedDate = parseDate(dateStr);
  
  if (!parsedDate) return null;
  
  const description = row[mapping.product_description];
  if (!description || description.length < 3) return null;
  
  const codeRaw = row[mapping.hs_code_10];
  const code10 = normalizeCode(codeRaw);
  if (!code10) return null;
  
  const origin = row[mapping.origin_country];
  if (!origin) return null;
  
  return {
    dum_date: parsedDate,
    dum_number: mapping.dum_number ? row[mapping.dum_number] : undefined,
    product_description: description.substring(0, 2000),
    hs_code_10: code10,
    origin_country: origin.substring(0, 100),
    reliability_score: 0,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate with custom JWT
    const authResult = await authenticateRequest(req, { requireRole: ["admin", "manager"] });
    if (!authResult.success) {
      return authResult.error;
    }
    
    const { profile } = authResult.data;
    const supabase = createServiceClient();

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/import-dum\/?/, "");

    // Auto-detect column mapping
    if (req.method === "POST" && path === "detect") {
      const { headers } = await req.json();
      
      if (!headers || !Array.isArray(headers)) {
        return new Response(
          JSON.stringify({ message: "Headers requis" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const mapping = autoDetectMapping(headers);
      
      return new Response(
        JSON.stringify({ mapping, headers }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Import DUM records
    if (req.method === "POST" && (path === "" || path === "/")) {
      const { content, format, mapping, skip_duplicates = true } = await req.json();
      
      if (!content || !mapping) {
        return new Response(
          JSON.stringify({ message: "Contenu et mapping requis" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate mapping
      if (!mapping.dum_date || !mapping.product_description || !mapping.hs_code_10 || !mapping.origin_country) {
        return new Response(
          JSON.stringify({ message: "Mapping incomplet: date, description, code et origine requis" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logger.info(`[import-dum] Starting import for company ${profile.company_id}`);
      
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
          JSON.stringify({ message: "Format non supporte" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logger.debug(`[import-dum] Parsed ${rows.length} rows`);

      const result: ImportResult = {
        total_rows: rows.length,
        imported: 0,
        errors: 0,
        warnings: [],
        duplicates: 0,
      };

      // Get existing DUM records for duplicate detection
      const existingDums = new Set<string>();
      if (skip_duplicates) {
        const { data: existing } = await supabase
          .from("dum_records")
          .select("dum_number, hs_code_10, dum_date")
          .eq("company_id", profile.company_id);
        
        existing?.forEach(d => {
          if (d.dum_number) {
            existingDums.add(`${d.dum_number}-${d.hs_code_10}-${d.dum_date}`);
          }
        });
      }

      // Process records
      const dumRecords: (DUMRecord & { company_id: string })[] = [];

      for (const row of rows) {
        const dumRecord = mapRowToDUM(row, mapping as ColumnMapping);
        if (dumRecord) {
          // Check for duplicates
          if (skip_duplicates && dumRecord.dum_number) {
            const key = `${dumRecord.dum_number}-${dumRecord.hs_code_10}-${dumRecord.dum_date}`;
            if (existingDums.has(key)) {
              result.duplicates++;
              continue;
            }
            existingDums.add(key);
          }
          
          dumRecords.push({
            ...dumRecord,
            company_id: profile.company_id,
          });
        } else {
          result.errors++;
          if (result.warnings.length < 10) {
            result.warnings.push(`Ligne invalide: ${JSON.stringify(row).substring(0, 100)}`);
          }
        }
      }

      // Insert in batches
      const batchSize = 100;
      for (let i = 0; i < dumRecords.length; i += batchSize) {
        const batch = dumRecords.slice(i, i + batchSize);
        
        const { error: insertError } = await supabase
          .from("dum_records")
          .insert(batch);
        
        if (insertError) {
          logger.error(`[import-dum] Batch error:`, insertError);
          result.errors += batch.length;
          result.warnings.push(`Erreur batch ${i}: ${insertError.message}`);
        } else {
          result.imported += batch.length;
        }
      }

      logger.info(`[import-dum] Import complete:`, result);

      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get stats
    if (req.method === "GET" && path === "stats") {
      const { count: totalRecords } = await supabase
        .from("dum_records")
        .select("*", { count: "exact", head: true })
        .eq("company_id", profile.company_id);

      const { data: codeStats } = await supabase
        .from("dum_records")
        .select("hs_code_10")
        .eq("company_id", profile.company_id)
        .limit(10000);

      const uniqueCodes = new Set(codeStats?.map(c => c.hs_code_10) || []);

      const { data: dateRange } = await supabase
        .from("dum_records")
        .select("dum_date")
        .eq("company_id", profile.company_id)
        .order("dum_date", { ascending: true })
        .limit(1);

      const { data: latestDate } = await supabase
        .from("dum_records")
        .select("dum_date")
        .eq("company_id", profile.company_id)
        .order("dum_date", { ascending: false })
        .limit(1);

      return new Response(
        JSON.stringify({
          total_records: totalRecords || 0,
          unique_codes: uniqueCodes.size,
          date_range: {
            from: dateRange?.[0]?.dum_date || null,
            to: latestDate?.[0]?.dum_date || null,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Search DUM records
    if (req.method === "GET" && path === "search") {
      const query = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit") || "20");

      let queryBuilder = supabase
        .from("dum_records")
        .select("*", { count: "exact" })
        .eq("company_id", profile.company_id);
      
      if (query) {
        if (/^\d+$/.test(query)) {
          queryBuilder = queryBuilder.like("hs_code_10", `${query}%`);
        } else {
          queryBuilder = queryBuilder.ilike("product_description", `%${query}%`);
        }
      }

      const { data: records, count, error } = await queryBuilder
        .order("dum_date", { ascending: false })
        .limit(limit);

      if (error) {
        return new Response(
          JSON.stringify({ message: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ records: records || [], total: count || 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clear company DUM records
    if (req.method === "DELETE" && path === "clear") {
      const { confirm } = await req.json();
      
      if (confirm !== "DELETE_ALL_DUM_RECORDS") {
        return new Response(
          JSON.stringify({ message: "Confirmation requise" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error } = await supabase
        .from("dum_records")
        .delete()
        .eq("company_id", profile.company_id);

      if (error) {
        return new Response(
          JSON.stringify({ message: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ message: "Tous les DUM ont ete supprimes" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ message: "Route non trouvee" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    logger.error("[import-dum] Error:", error);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ message: error instanceof Error ? error.message : "Erreur serveur" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
