import axios, { AxiosError } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://api.example.com/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
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
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err: AxiosError<{ message?: string; error_message?: string }>) => {
    const status = err.response?.status;
    if (status === 401) {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      localStorage.removeItem("auth_expires");
      window.location.href = "/login";
      return Promise.reject(new Error("Session expirée. Veuillez vous reconnecter."));
    }
    if (status === 403) return Promise.reject(new Error("Accès non autorisé."));
    if (status === 429) return Promise.reject(new Error("Trop de requêtes. Veuillez patienter."));
    if (status === 423) return Promise.reject(new Error("Compte temporairement verrouillé."));
    if (status && status >= 500) return Promise.reject(new Error("Erreur serveur. Veuillez réessayer."));
    const msg = err.response?.data?.message || err.response?.data?.error_message || err.message;
    return Promise.reject(new Error(msg));
  }
);

// Auth endpoints
export async function sendOtp(phone: string) {
  return api.post("/auth/send_otp", { phone });
}

export async function verifyOtp(phone: string, otp: string) {
  return api.post("/auth/verify_otp", { phone, otp });
}

// Cases endpoints
export async function createCase(data: { 
  type_import_export: "import" | "export"; 
  origin_country: string; 
  product_name: string; 
}) {
  return api.post("/cases", data);
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
  return api.get("/cases", { params });
}

export async function getCaseDetail(caseId: string) {
  return api.get(`/cases/${caseId}`);
}

export async function validateCase(caseId: string) {
  return api.post(`/cases/${caseId}/validate`);
}

// Files endpoints
export async function presignFile(data: {
  case_id: string | null;
  file_type: string;
  filename: string;
  content_type: string;
}) {
  return api.post("/files/presign", data);
}

export async function attachFile(caseId: string, data: {
  file_type: string;
  file_url: string;
  filename: string;
  size_bytes: number;
}) {
  return api.post(`/cases/${caseId}/files`, data);
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

// Classification endpoint
export async function classify(payload: {
  case_id: string;
  file_urls: string[];
  answers: Record<string, string>;
  context: {
    type_import_export: "import" | "export";
    origin_country: string;
  };
}) {
  return api.post("/classify", payload, { timeout: 120000 });
}

// Export endpoint
export async function exportPdf(caseId: string) {
  return api.post(`/cases/${caseId}/export/pdf`);
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
