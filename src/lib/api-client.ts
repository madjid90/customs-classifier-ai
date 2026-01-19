import axios, { AxiosError, AxiosResponse } from "axios";
import { supabase } from "@/integrations/supabase/client";
import { 
  createValidationInterceptor, 
  configureValidator, 
  getValidatorConfig,
  OpenApiValidationError,
  type ValidatorConfig 
} from "./openapi-validator";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// ============================================================================
// API CLIENT SETUP
// ============================================================================

export const api = axios.create({
  baseURL: FUNCTIONS_URL,
  timeout: 120000,
  headers: { 
    "Content-Type": "application/json", 
    "Accept": "application/json", 
    "X-Client-Version": "1.0.0" 
  },
});

// Helper to get current session token
async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
  };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  return headers;
}

// Request interceptor - add auth token from Supabase session
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  config.headers.apikey = SUPABASE_ANON_KEY;
  return config;
});

// OpenAPI validation interceptor (dev mode only)
if (import.meta.env.DEV) {
  const validationInterceptor = createValidationInterceptor(FUNCTIONS_URL);
  api.interceptors.response.use(
    async (response: AxiosResponse) => {
      try {
        await validationInterceptor(response);
      } catch (error) {
        if (error instanceof OpenApiValidationError) {
          console.warn("[API] Response validation warning:", error.message);
        }
      }
      return response;
    },
    (error) => Promise.reject(error)
  );
}

// Error handling interceptor
api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<{ message?: string; error_message?: string; error?: string }>) => {
    const status = err.response?.status;
    
    // Skip auth redirect for auth endpoints
    const isAuthEndpoint = err.config?.url?.includes("/auth/") || 
                           err.config?.url?.includes("send-otp") || 
                           err.config?.url?.includes("verify-otp");
    
    if (status === 401 && !isAuthEndpoint) {
      await supabase.auth.signOut();
      window.location.href = "/login";
      return Promise.reject(new Error("Session expiree. Veuillez vous reconnecter."));
    }
    if (status === 403) return Promise.reject(new Error("Acces non autorise."));
    if (status === 429) return Promise.reject(new Error("Trop de requetes. Veuillez patienter."));
    if (status === 423) return Promise.reject(new Error("Compte temporairement verrouille."));
    if (status && status >= 500) return Promise.reject(new Error("Erreur serveur. Veuillez reessayer."));
    const msg = err.response?.data?.message || err.response?.data?.error_message || err.response?.data?.error || err.message;
    return Promise.reject(new Error(msg));
  }
);

// Export validator utilities for external configuration
export { configureValidator, getValidatorConfig, OpenApiValidationError };
export type { ValidatorConfig };

// ============================================================================
// CASES ENDPOINTS
// ============================================================================

export async function createCase(data: { 
  type_import_export: "import" | "export"; 
  origin_country: string; 
  product_name: string; 
}) {
  const headers = await getAuthHeaders();
  return axios.post(`${FUNCTIONS_URL}/cases`, data, { headers });
}

export async function getCases(params?: {
  limit?: number;
  offset?: number;
  status?: string;
  q?: string;
  created_by?: string;
  date_from?: string;
  date_to?: string;
}) {
  const headers = await getAuthHeaders();
  return axios.get(`${FUNCTIONS_URL}/cases`, { params, headers });
}

export async function getCaseDetail(caseId: string) {
  const headers = await getAuthHeaders();
  return axios.get(`${FUNCTIONS_URL}/cases/${caseId}`, { headers });
}

export async function validateCase(caseId: string) {
  const headers = await getAuthHeaders();
  return axios.post(`${FUNCTIONS_URL}/cases/${caseId}/validate`, {}, { headers });
}

// ============================================================================
// FILES ENDPOINTS
// ============================================================================

export async function presignFile(data: {
  case_id: string | null;
  file_type: string;
  filename: string;
  content_type: string;
}) {
  const headers = await getAuthHeaders();
  return axios.post(`${FUNCTIONS_URL}/files-presign`, data, { headers });
}

export async function attachFile(caseId: string, data: {
  file_type: string;
  file_url: string;
  filename: string;
  size_bytes: number;
  storage_path?: string;
}) {
  const headers = await getAuthHeaders();
  return axios.post(`${FUNCTIONS_URL}/files-attach/${caseId}`, data, { headers });
}

export async function uploadAndAttachFile(caseId: string, file: File, fileType: string) {
  const presignRes = await presignFile({
    case_id: caseId,
    file_type: fileType,
    filename: file.name,
    content_type: file.type,
  });

  const { upload_url, file_url, file_path } = presignRes.data;

  await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  const attachRes = await attachFile(caseId, {
    file_type: fileType,
    file_url,
    filename: file.name,
    size_bytes: file.size,
    storage_path: file_path,
  });

  return { file_url, attach_id: attachRes.data.id };
}

// Get fresh signed URL for reading a file
export async function getFileReadUrl(caseId: string, fileId: string): Promise<string> {
  const headers = await getAuthHeaders();
  const response = await axios.post(`${FUNCTIONS_URL}/files-read-url`, { case_id: caseId, file_id: fileId }, { headers });
  return response.data.url;
}

// ============================================================================
// CLASSIFICATION ENDPOINT
// ============================================================================

import { validateClassifyResponse, formatValidationErrors, canDisplayResult } from "./classify-validator";
import type { HSResult } from "./types";

export async function classify(payload: {
  case_id: string;
  file_urls: string[];
  answers: Record<string, string>;
  context: {
    type_import_export: "import" | "export";
    origin_country: string;
  };
}): Promise<{ data: HSResult }> {
  const headers = await getAuthHeaders();
  
  const response = await axios.post(`${FUNCTIONS_URL}/classify`, payload, {
    timeout: 120000,
    headers,
  });

  // ===== ANTI-HALLUCINATION VALIDATION =====
  const validation = validateClassifyResponse(response.data);
  
  if (!validation.valid) {
    console.error("[ANTI-HALLUCINATION] Classification response validation FAILED:");
    console.error(formatValidationErrors(validation));
    
    const errorResult: HSResult = {
      status: "ERROR",
      recommended_code: null,
      confidence: 0,
      confidence_level: "low",
      justification_short: "",
      justification_detailed: null,
      alternatives: [],
      evidence: [],
      next_question: null,
      error_message: `Validation échouée: ${validation.errors[0] || "Réponse non conforme"}`,
    };
    
    return { data: errorResult };
  }

  if (validation.warnings.length > 0) {
    console.warn("[ANTI-HALLUCINATION] Classification response warnings:");
    console.warn(formatValidationErrors(validation));
  }

  return { data: validation.sanitizedResult! };
}

export { canDisplayResult };

// ============================================================================
// EXPORT ENDPOINT
// ============================================================================

export async function exportPdf(caseId: string) {
  const headers = await getAuthHeaders();
  return axios.post(`${FUNCTIONS_URL}/export-pdf`, { case_id: caseId }, { headers });
}

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

export async function getIngestionList(params?: { limit?: number; offset?: number; status?: string; source?: string }) {
  const headers = await getAuthHeaders();
  return axios.get(`${FUNCTIONS_URL}/admin/ingestion/list`, { params, headers });
}

export async function registerIngestion(data: {
  source: string;
  version_label: string;
  file_url: string;
  filename?: string;
}) {
  const headers = await getAuthHeaders();
  return axios.post(`${FUNCTIONS_URL}/admin/ingestion/register`, data, { headers });
}

export async function runEtl(ingestionId: string) {
  const headers = await getAuthHeaders();
  return axios.post(`${FUNCTIONS_URL}/admin/etl/run`, { ingestion_id: ingestionId }, { headers });
}

export async function getIngestionLogs(ingestionId: string) {
  const headers = await getAuthHeaders();
  return axios.get(`${FUNCTIONS_URL}/admin/ingestion/${ingestionId}/logs`, { headers });
}

export async function retryIngestion(ingestionId: string) {
  const headers = await getAuthHeaders();
  return axios.post(`${FUNCTIONS_URL}/admin/ingestion/${ingestionId}/retry`, {}, { headers });
}

export async function disableIngestion(ingestionId: string) {
  const headers = await getAuthHeaders();
  return axios.post(`${FUNCTIONS_URL}/admin/ingestion/${ingestionId}/disable`, {}, { headers });
}

export async function searchKB(q: string, params?: { limit?: number; source?: string }) {
  const headers = await getAuthHeaders();
  return axios.get(`${FUNCTIONS_URL}/admin/kb/search`, { params: { q, ...params }, headers });
}
