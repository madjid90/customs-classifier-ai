// API functions for DUM import management
import axios from "axios";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

const getHeaders = () => {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": token ? `Bearer ${token}` : "",
  };
};

export interface ColumnMapping {
  dum_date: string;
  dum_number?: string;
  product_description: string;
  hs_code_10: string;
  origin_country: string;
}

export interface ImportResult {
  total_rows: number;
  imported: number;
  errors: number;
  warnings: string[];
  duplicates: number;
}

export interface DUMStats {
  total_records: number;
  unique_codes: number;
  date_range: {
    from: string | null;
    to: string | null;
  };
}

export interface DUMRecord {
  id: string;
  dum_date: string;
  dum_number?: string;
  product_description: string;
  hs_code_10: string;
  origin_country: string;
  reliability_score: number;
  created_at: string;
}

export interface DUMSearchResult {
  records: DUMRecord[];
  total: number;
}

// Auto-detect column mapping from headers
export async function detectColumnMapping(headers: string[]): Promise<{ mapping: Partial<ColumnMapping>; headers: string[] }> {
  const response = await axios.post(
    `${FUNCTIONS_URL}/import-dum/detect`,
    { headers },
    { headers: getHeaders() }
  );
  return response.data;
}

// Import DUM records
export async function importDUMRecords(
  content: string,
  format: "csv" | "json",
  mapping: ColumnMapping,
  skipDuplicates = true
): Promise<ImportResult> {
  const response = await axios.post(
    `${FUNCTIONS_URL}/import-dum`,
    { content, format, mapping, skip_duplicates: skipDuplicates },
    { headers: getHeaders() }
  );
  return response.data;
}

// Get DUM stats for company
export async function getDUMStats(): Promise<DUMStats> {
  const response = await axios.get(
    `${FUNCTIONS_URL}/import-dum/stats`,
    { headers: getHeaders() }
  );
  return response.data;
}

// Search DUM records
export async function searchDUMRecords(query: string, limit = 20): Promise<DUMSearchResult> {
  const response = await axios.get(
    `${FUNCTIONS_URL}/import-dum/search`,
    { 
      params: { q: query, limit },
      headers: getHeaders() 
    }
  );
  return response.data;
}

// Clear all company DUM records
export async function clearAllDUMRecords(): Promise<{ message: string }> {
  const response = await axios.delete(
    `${FUNCTIONS_URL}/import-dum/clear`,
    { 
      data: { confirm: "DELETE_ALL_DUM_RECORDS" },
      headers: getHeaders() 
    }
  );
  return response.data;
}

// Parse CSV headers for preview
export function parseCSVHeaders(content: string): string[] {
  const firstLine = content.trim().split(/\r?\n/)[0] || "";
  return firstLine.split(/[;,\t]/).map(h => h.trim().replace(/^["']|["']$/g, ''));
}

// Parse CSV preview rows
export function parseCSVPreview(content: string, maxRows = 5): { headers: string[]; rows: string[][] } {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 1) return { headers: [], rows: [] };
  
  const headers = lines[0].split(/[;,\t]/).map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows: string[][] = [];
  
  for (let i = 1; i < Math.min(lines.length, maxRows + 1); i++) {
    const values = lines[i].split(/[;,\t]/).map(v => v.trim().replace(/^["']|["']$/g, ''));
    rows.push(values);
  }
  
  return { headers, rows };
}
