import axios, { AxiosError } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Use Supabase functions URL for auth endpoints
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

export const api = axios.create({
  baseURL: API_BASE_URL || FUNCTIONS_URL,
  timeout: 10000,
  headers: { 
    "Content-Type": "application/json", 
    "Accept": "application/json", 
    "X-Client-Version": "1.0.0" 
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Add Supabase anon key for edge functions
  if (config.url?.startsWith(FUNCTIONS_URL) || !API_BASE_URL) {
    config.headers.apikey = SUPABASE_ANON_KEY;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err: AxiosError<{ message?: string; error_message?: string }>) => {
    const status = err.response?.status;
    
    // Skip auth redirect for auth endpoints
    const isAuthEndpoint = err.config?.url?.includes("/auth/") || 
                           err.config?.url?.includes("send-otp") || 
                           err.config?.url?.includes("verify-otp");
    
    if (status === 401 && !isAuthEndpoint) {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      localStorage.removeItem("auth_expires");
      window.location.href = "/login";
      return Promise.reject(new Error("Session expiree. Veuillez vous reconnecter."));
    }
    if (status === 403) return Promise.reject(new Error("Acces non autorise."));
    if (status === 429) return Promise.reject(new Error("Trop de requetes. Veuillez patienter."));
    if (status === 423) return Promise.reject(new Error("Compte temporairement verrouille."));
    if (status && status >= 500) return Promise.reject(new Error("Erreur serveur. Veuillez reessayer."));
    const msg = err.response?.data?.message || err.response?.data?.error_message || err.message;
    return Promise.reject(new Error(msg));
  }
);

// Auth endpoints - call edge functions directly
export async function sendOtp(phone: string) {
  return axios.post(`${FUNCTIONS_URL}/send-otp`, { phone }, {
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
  });
}

export async function verifyOtp(phone: string, otp: string) {
  return axios.post(`${FUNCTIONS_URL}/verify-otp`, { phone, otp }, {
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
  });
}

// Cases endpoints - call edge function directly
export async function createCase(data: { 
  type_import_export: "import" | "export"; 
  origin_country: string; 
  product_name: string; 
}) {
  const token = localStorage.getItem("auth_token");
  return axios.post(`${FUNCTIONS_URL}/cases`, data, {
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": token ? `Bearer ${token}` : "",
    },
  });
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
  const token = localStorage.getItem("auth_token");
  return axios.get(`${FUNCTIONS_URL}/cases`, {
    params,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": token ? `Bearer ${token}` : "",
    },
  });
}

export async function getCaseDetail(caseId: string) {
  const token = localStorage.getItem("auth_token");
  return axios.get(`${FUNCTIONS_URL}/cases/${caseId}`, {
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": token ? `Bearer ${token}` : "",
    },
  });
}

export async function validateCase(caseId: string) {
  const token = localStorage.getItem("auth_token");
  return axios.post(`${FUNCTIONS_URL}/cases/${caseId}/validate`, {}, {
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": token ? `Bearer ${token}` : "",
    },
  });
}

// Files endpoints - call edge function directly
export async function presignFile(data: {
  case_id: string | null;
  file_type: string;
  filename: string;
  content_type: string;
}) {
  const token = localStorage.getItem("auth_token");
  return axios.post(`${FUNCTIONS_URL}/files-presign`, data, {
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": token ? `Bearer ${token}` : "",
    },
  });
}

// Attach file to case - call edge function directly
export async function attachFile(caseId: string, data: {
  file_type: string;
  file_url: string;
  filename: string;
  size_bytes: number;
}) {
  const token = localStorage.getItem("auth_token");
  return axios.post(`${FUNCTIONS_URL}/files-attach/${caseId}`, data, {
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": token ? `Bearer ${token}` : "",
    },
  });
}

export async function uploadAndAttachFile(caseId: string, file: File, fileType: string) {
  const presignRes = await presignFile({
    case_id: caseId,
    file_type: fileType,
    filename: file.name,
    content_type: file.type,
  });

  const { upload_url, file_url } = presignRes.data;

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
  });

  return { file_url, attach_id: attachRes.data.id };
}

// Classification endpoint - call edge function directly
export async function classify(payload: {
  case_id: string;
  file_urls: string[];
  answers: Record<string, string>;
  context: {
    type_import_export: "import" | "export";
    origin_country: string;
  };
}) {
  return axios.post(`${FUNCTIONS_URL}/classify`, payload, {
    timeout: 120000,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
  });
}

// Export endpoint - call edge function directly
export async function exportPdf(caseId: string) {
  const token = localStorage.getItem("auth_token");
  return axios.post(`${FUNCTIONS_URL}/export-pdf`, { case_id: caseId }, {
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": token ? `Bearer ${token}` : "",
    },
  });
}

// Admin endpoints
export async function getIngestionList() {
  return api.get("/admin/ingestion/list");
}

export async function registerIngestion(data: {
  source: string;
  version_label: string;
  file_url: string;
}) {
  return api.post("/admin/ingestion/register", data);
}

export async function runEtl(ingestionId: string) {
  return api.post("/admin/etl/run", { ingestion_id: ingestionId });
}

export async function getIngestionLogs(ingestionId: string) {
  return api.get(`/admin/ingestion/${ingestionId}/logs`);
}

export async function retryIngestion(ingestionId: string) {
  return api.post(`/admin/ingestion/${ingestionId}/retry`);
}

export async function disableIngestion(ingestionId: string) {
  return api.post(`/admin/ingestion/${ingestionId}/disable`);
}

export async function searchKB(q: string) {
  return api.get("/admin/kb/search", { params: { q } });
}
