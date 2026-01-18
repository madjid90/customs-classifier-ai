// User & Auth Types
export type UserRole = "admin" | "agent" | "manager";

export interface User {
  id: string;
  company_id: string;
  role: UserRole;
  phone: string;
}

export interface AuthSendOtpResponse {
  ok: boolean;
  expires_in: number;
}

export interface AuthVerifyOtpResponse {
  token: string;
  expires_at: string;
  user: User;
}

// Case Types
export type ImportExportType = "import" | "export";
export type CaseStatus = "IN_PROGRESS" | "RESULT_READY" | "VALIDATED" | "ERROR";

export interface Case {
  id: string;
  company_id: string;
  type_import_export: ImportExportType;
  origin_country: string;
  product_name: string;
  status: CaseStatus;
  created_by: string;
  validated_by: string | null;
  created_at: string;
  validated_at: string | null;
}

export interface CreateCaseResponse {
  id: string;
  status: CaseStatus;
  created_at: string;
}

export interface CasesListResponse {
  items: Case[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

// File Types
export type CaseFileType = 
  | "tech_sheet" 
  | "invoice" 
  | "packing_list" 
  | "certificate" 
  | "dum" 
  | "photo_product" 
  | "photo_label" 
  | "photo_plate" 
  | "other" 
  | "admin_ingestion";

export interface CaseFile {
  id: string;
  case_id: string;
  file_type: CaseFileType;
  file_url: string;
  filename: string;
  size_bytes: number;
  created_at: string;
}

export interface PresignResponse {
  upload_url: string;
  file_url: string;
  expires_at: string;
}

// Classification Types - STRICT ANTI-HALLUCINATION
export type ClassifyStatus = "NEED_INFO" | "DONE" | "ERROR" | "LOW_CONFIDENCE";
export type ConfidenceLevel = "high" | "medium" | "low";
export type EvidenceSource = "omd" | "maroc" | "lois" | "dum";
export type QuestionType = "yesno" | "select" | "text";

export interface Alternative {
  code: string;        // 10 digits EXACTLY (from candidates[])
  reason: string;      // Max 200 chars
  confidence: number;  // 0-1
}

export interface EvidenceItem {
  source: EvidenceSource;
  doc_id: string;
  ref: string;         // Max 100 chars
  excerpt: string;     // Max 300 chars - NEVER fabricated
}

export interface QuestionOption {
  value: string;       // Max 50 chars
  label: string;       // Max 200 chars
}

export interface NextQuestion {
  id: string;          // Format: q_xxx
  label: string;       // Max 300 chars
  type: QuestionType;
  options?: QuestionOption[];
  required: boolean;
}

/**
 * HSResult - ANTI-HALLUCINATION RULES:
 * 
 * status=DONE: 
 *   - recommended_code REQUIRED (10 digits)
 *   - evidence REQUIRED (non-empty)
 *   - justification_short based ONLY on evidence
 * 
 * status=NEED_INFO:
 *   - next_question REQUIRED
 *   - recommended_code should NOT be displayed
 * 
 * status=ERROR:
 *   - error_message REQUIRED
 * 
 * status=LOW_CONFIDENCE:
 *   - Same as DONE + warning display
 */
export interface HSResult {
  status: ClassifyStatus;
  recommended_code: string | null;  // 10 digits or null
  confidence: number;               // 0-1
  confidence_level: ConfidenceLevel;
  justification_short: string;      // Max 500 chars
  alternatives: Alternative[];      // Max 3 items
  evidence: EvidenceItem[];         // REQUIRED if status=DONE|LOW_CONFIDENCE
  next_question: NextQuestion | null;
  error_message: string | null;     // REQUIRED if status=ERROR
}

// Audit Types
export type AuditAction = 
  | "created" 
  | "file_uploaded" 
  | "classify_called" 
  | "question_answered" 
  | "result_ready" 
  | "validated" 
  | "exported";

export interface AuditEntry {
  id: string;
  case_id: string;
  action: AuditAction;
  user_id: string;
  user_phone: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface CaseDetailResponse {
  case: Case;
  files: CaseFile[];
  last_result: HSResult | null;
  audit: AuditEntry[];
}

// Admin/Ingestion Types
export type IngestionSource = "omd" | "maroc" | "lois" | "dum";
export type IngestionStatus = "NEW" | "EXTRACTING" | "PARSING" | "INDEXING" | "DONE" | "ERROR" | "DISABLED";
export type IngestionLogLevel = "info" | "warning" | "error";
export type IngestionStep = "extract" | "parse" | "index";

export interface IngestionFile {
  id: string;
  source: IngestionSource;
  version_label: string;
  file_url: string;
  filename: string;
  file_hash: string;
  status: IngestionStatus;
  error_message: string | null;
  progress_percent: number;
  created_at: string;
  updated_at: string;
}

export interface IngestionListResponse {
  items: IngestionFile[];
  total: number;
}

export interface IngestionLog {
  id: string;
  ingestion_id: string;
  step: IngestionStep;
  level: IngestionLogLevel;
  message: string;
  created_at: string;
}

export interface IngestionLogsResponse {
  items: IngestionLog[];
  total: number;
}

export interface KBChunk {
  id: string;
  source: IngestionSource;
  doc_id: string;
  ref: string;
  text: string;
  version_label: string;
  score: number;
}

export interface KBSearchResponse {
  chunks: KBChunk[];
  total: number;
}

// File type labels for UI
export const FILE_TYPE_LABELS: Record<CaseFileType, string> = {
  tech_sheet: "Fiche technique",
  invoice: "Facture",
  packing_list: "Liste de colisage",
  certificate: "Certificat",
  dum: "DUM",
  photo_product: "Photo produit",
  photo_label: "Photo etiquette",
  photo_plate: "Photo plaque",
  other: "Autre",
  admin_ingestion: "Ingestion admin",
};

export const INGESTION_SOURCE_LABELS: Record<IngestionSource, string> = {
  omd: "OMD/SH",
  maroc: "Nomenclature Maroc",
  lois: "Lois et reglements",
  dum: "DUM internes",
};

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  IN_PROGRESS: "En cours",
  RESULT_READY: "Resultat pret",
  VALIDATED: "Valide",
  ERROR: "Erreur",
};

export const INGESTION_STATUS_LABELS: Record<IngestionStatus, string> = {
  NEW: "Nouveau",
  EXTRACTING: "Extraction",
  PARSING: "Analyse",
  INDEXING: "Indexation",
  DONE: "Termine",
  ERROR: "Erreur",
  DISABLED: "Desactive",
};
