// API functions for AI-powered data extraction
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

export type ExtractionType = "hs_codes" | "dum_records" | "kb_chunks";

export interface ExtractedHSCode {
  code_10: string;
  code_6: string;
  chapter_2: string;
  label_fr: string;
  label_ar?: string;
  unit?: string;
  active_version_label: string;
}

export interface ExtractedDUM {
  dum_date: string;
  dum_number?: string;
  product_description: string;
  hs_code_10: string;
  origin_country: string;
  company_id: string;
  reliability_score: number;
}

export interface ExtractedKBChunk {
  source: string;
  doc_id: string;
  ref: string;
  text: string;
  version_label: string;
}

export interface ExtractionResult<T> {
  success: boolean;
  type: ExtractionType;
  extracted: T[];
  stats: {
    total_extracted: number;
    valid: number;
    invalid: number;
    chunks_processed: number;
  };
  errors?: string[];
}

export interface ExtractionOptions {
  version_label?: string;
  chunk_size?: number;
  language?: string;
}

// Extract data using AI
export async function extractWithAI<T>(
  type: ExtractionType,
  content: string,
  options?: ExtractionOptions
): Promise<ExtractionResult<T>> {
  const response = await axios.post(
    `${FUNCTIONS_URL}/extract-data`,
    { type, content, options },
    { headers: getHeaders(), timeout: 120000 } // 2 min timeout for large files
  );
  return response.data;
}

// Extract HS codes from text
export async function extractHSCodes(
  content: string,
  versionLabel?: string
): Promise<ExtractionResult<ExtractedHSCode>> {
  return extractWithAI<ExtractedHSCode>("hs_codes", content, { version_label: versionLabel });
}

// Extract DUM records from text
export async function extractDUMRecords(
  content: string
): Promise<ExtractionResult<ExtractedDUM>> {
  return extractWithAI<ExtractedDUM>("dum_records", content);
}

// Extract KB chunks from text
export async function extractKBChunks(
  content: string,
  versionLabel?: string
): Promise<ExtractionResult<ExtractedKBChunk>> {
  return extractWithAI<ExtractedKBChunk>("kb_chunks", content, { version_label: versionLabel });
}

// Read file as text
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = (e) => reject(new Error("Erreur de lecture du fichier"));
    reader.readAsText(file);
  });
}
