// API functions for HS code import management
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

export interface ImportResult {
  total_rows: number;
  imported: number;
  updated: number;
  errors: number;
  warnings: string[];
  embeddings_triggered?: boolean;
  enrichment_triggered?: boolean;
}

export interface HSCodeStats {
  total_codes: number;
  chapters_count: number;
  current_version: string | null;
}

export interface HSCode {
  code_10: string;
  code_6: string;
  chapter_2: string;
  label_fr: string;
  label_ar?: string;
  unit?: string;
  active_version_label: string;
}

export interface HSCodeSearchResult {
  codes: HSCode[];
  total: number;
}

// Import HS codes from CSV or JSON content
export async function importHSCodes(
  content: string,
  format: "csv" | "json",
  versionLabel: string,
  mode: "upsert" | "insert" = "upsert"
): Promise<ImportResult> {
  const response = await axios.post(
    `${FUNCTIONS_URL}/admin-import-hs`,
    { content, format, version_label: versionLabel, mode },
    { headers: getHeaders() }
  );
  return response.data;
}

// Get stats about HS codes table
export async function getHSCodeStats(): Promise<HSCodeStats> {
  const response = await axios.get(
    `${FUNCTIONS_URL}/admin-import-hs/stats`,
    { headers: getHeaders() }
  );
  return response.data;
}

// Search HS codes
export async function searchHSCodes(query: string, limit = 20): Promise<HSCodeSearchResult> {
  const response = await axios.get(
    `${FUNCTIONS_URL}/admin-import-hs/search`,
    { 
      params: { q: query, limit },
      headers: getHeaders() 
    }
  );
  return response.data;
}

// Clear all HS codes (requires confirmation)
export async function clearAllHSCodes(): Promise<{ message: string }> {
  const response = await axios.delete(
    `${FUNCTIONS_URL}/admin-import-hs/clear`,
    { 
      data: { confirm: "DELETE_ALL_HS_CODES" },
      headers: getHeaders() 
    }
  );
  return response.data;
}

// Parse CSV file to preview data
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
